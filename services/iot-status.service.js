const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 8;
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
const DEFAULT_SNAPSHOT_PATH = path.join(__dirname, '..', 'data', 'iot-station-snapshot.json');

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, '')
    .trim();
}

function getBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'require'].includes(String(value).trim().toLowerCase());
}

function getIotMysqlConfig(env = process.env) {
  return {
    host: env.ECOCO_IOT_MYSQL_HOST || '',
    port: Number(env.ECOCO_IOT_MYSQL_PORT || 3306),
    user: env.ECOCO_IOT_MYSQL_USER || '',
    password: env.ECOCO_IOT_MYSQL_PASSWORD || '',
    database: env.ECOCO_IOT_MYSQL_DATABASE || '',
    ssl: getBooleanEnv(env.ECOCO_IOT_MYSQL_SSL, true),
    rejectUnauthorized: getBooleanEnv(env.ECOCO_IOT_MYSQL_SSL_REJECT_UNAUTHORIZED, true),
    connectionLimit: Number(env.ECOCO_IOT_MYSQL_CONNECTION_LIMIT || 4),
    connectTimeoutMs: Number(env.ECOCO_IOT_MYSQL_CONNECT_TIMEOUT_MS || DEFAULT_CONNECT_TIMEOUT_MS),
    snapshotPath: env.ECOCO_IOT_STATION_SNAPSHOT_PATH || DEFAULT_SNAPSHOT_PATH,
  };
}

function isIotMysqlConfigured(env = process.env) {
  const config = getIotMysqlConfig(env);
  return Boolean(config.host && config.user && config.password && config.database);
}

function getMysqlSslOption(config) {
  if (!config.ssl) return undefined;
  return { rejectUnauthorized: config.rejectUnauthorized };
}

function sanitizeConnectionError(err) {
  return {
    configured: true,
    ok: false,
    errorCode: err?.code || err?.name || 'UNKNOWN',
    message: String(err?.message || 'Unknown MySQL connection error').slice(0, 300),
  };
}

function escapePostgresLike(value) {
  return String(value || '').replace(/[\\%_]/g, '\\$&');
}

function shouldUseLiveStationContext(question, classification = null) {
  if (classification?.category === 'station_machine') return true;
  const text = normalizeText(question).toLowerCase();
  const hasNearbyWord = /(附近|周邊|周遭|鄰近|最近|哪裡|哪裏|哪邊)/.test(text);
  const hasKnownLocation = /(成大|成功大學|國立成功大學|臺南東區|台南東區|東區)/.test(text);
  const hasRecyclePlaceIntent = /(ecoco|回收|投瓶|投遞|站點|機台|機器)/i.test(text);
  if (hasNearbyWord && hasKnownLocation && hasRecyclePlaceIntent) return true;
  if (/(站點|站点|站名|機台|机台|容量|滿袋|满袋|狀態|状态|小北百貨|小北百货|es\d+)/i.test(text)) return true;
  return /(站點|站|機台|機器|滿倉|故障|維修|地址|營業時間|能不能投|可以投|回收機|offline|online|asset|es\d+)/i.test(text);
}

function stripCommonStationWords(value) {
  return String(value || '')
    .replace(/請問|想問|查詢|現在|目前|可以|可不可以|能不能|是否|怎麼|如何|哪裡|在哪|地址|位置|營業時間|狀態|機台|機器|回收機|回收|投遞|投瓶|滿倉|故障|維修|正常|使用|附近|周邊|周遭|鄰近|最近|推薦|路線|地圖|ECOCO|ecoco|嗎|呢|的|有沒有|有嗎|有/g, '')
    .trim();
}

function addTerm(terms, value) {
  const term = stripCommonStationWords(normalizeText(value));
  if (term.length >= 2 && term.length <= 40) terms.add(term);
}

function addLocationAliasTerms(terms, text) {
  if (/成大|成功大學|國立成功大學/.test(text)) {
    ['成大', '成功大學', '國立成功大學', '大學路', '勝利路', '東區'].forEach(term => addTerm(terms, term));
  }

  if (/臺南東區|台南東區|東區/.test(text)) {
    ['臺南東區', '台南東區', '東區'].forEach(term => addTerm(terms, term));
  }
}

function buildStationSearchTerms(question) {
  const text = normalizeText(question);
  const terms = new Set();
  const cityPrefixes = [
    '臺北', '台北', '新北', '桃園', '臺中', '台中', '臺南', '台南', '高雄',
    '基隆', '新竹', '苗栗', '彰化', '南投', '雲林', '嘉義', '屏東', '宜蘭',
    '花蓮', '臺東', '台東', '澎湖', '金門', '連江',
  ];

  for (const match of text.matchAll(/es\d{3,6}(?:_[a-z0-9]+)?/gi)) addTerm(terms, match[0]);
  for (const match of text.matchAll(/\b\d{8,22}\b/g)) addTerm(terms, match[0]);
  addLocationAliasTerms(terms, text);
  for (const match of text.matchAll(/[\u4e00-\u9fffA-Za-z0-9]{2,40}站/g)) {
    const stationName = match[0];
    addTerm(terms, stationName);
    if (stationName.length > 2) addTerm(terms, stationName.slice(0, -1));
    for (const city of cityPrefixes) {
      if (stationName.startsWith(city) && stationName.length > city.length + 1) {
        const withoutCity = stationName.slice(city.length);
        addTerm(terms, withoutCity);
        if (withoutCity.endsWith('站')) addTerm(terms, withoutCity.slice(0, -1));
      }
    }
  }

  text
    .split(/[^0-9A-Za-z\u4e00-\u9fff]+/g)
    .map(stripCommonStationWords)
    .filter(term => term.length >= 2 && term.length <= 24)
    .forEach(term => addTerm(terms, term));

  return [...terms].slice(0, 8);
}

function sanitizeRow(row = {}) {
  return {
    stationId: row.station_id,
    stationCode: row.station_code || '',
    stationName: row.station_name || '',
    address: row.address || '',
    areaName: row.area_name || '',
    districtName: row.district_name || '',
    placeName: row.place_name || '',
    longitude: row.longitude || '',
    latitude: row.latitude || '',
    serviceHours: row.service_hours || '',
    stationStatus: row.station_status || '',
    stationStatusUpdatedAt: row.station_status_updated_at || '',
    assetId: row.asset_id || '',
    machineType: row.machine_type || '',
    machineKind: row.machine_kind || '',
    machineStatus: row.machine_status || '',
    machineStatusAt: row.machine_status_at || '',
    lastConnectionStatus: row.last_conn_status || '',
    lastConnectionStatusAt: row.last_conn_status_at || '',
    lastHeartbeatAt: row.last_heartbeat_at || '',
    alarmCode: row.alarm_code || '',
    alarmDescription: row.alarm_description || '',
    bin1Count: row.bin1_count,
    bin1MaxCapacity: row.bin1_max_capacity,
    bin1RemainCapacity: row.bin1_remain_capacity,
    bin1FullAt: row.bin1_full_at || '',
    bin2Count: row.bin2_count,
    bin2MaxCapacity: row.bin2_max_capacity,
    bin2RemainCapacity: row.bin2_remain_capacity,
    bin2FullAt: row.bin2_full_at || '',
    sourceSyncedAt: row.source_synced_at || '',
  };
}

function normalizeSnapshotRow(row = {}) {
  return sanitizeRow({
    station_id: row.stationId,
    station_code: row.stationCode,
    station_name: row.stationName,
    address: row.address,
    area_name: row.areaName,
    district_name: row.districtName,
    place_name: row.placeName,
    longitude: row.longitude,
    latitude: row.latitude,
    service_hours: row.serviceHours,
    station_status: row.stationStatus,
    station_status_updated_at: row.stationStatusUpdatedAt,
    asset_id: row.assetId,
    machine_type: row.machineType,
    machine_kind: row.machineKind,
    machine_status: row.machineStatus,
    machine_status_at: row.machineStatusAt,
    last_conn_status: row.lastConnectionStatus,
    last_conn_status_at: row.lastConnectionStatusAt,
    last_heartbeat_at: row.lastHeartbeatAt,
    alarm_code: row.alarmCode,
    alarm_description: row.alarmDescription,
    bin1_count: row.bin1Count,
    bin1_max_capacity: row.bin1MaxCapacity,
    bin1_remain_capacity: row.bin1RemainCapacity,
    bin1_full_at: row.bin1FullAt,
    bin2_count: row.bin2Count,
    bin2_max_capacity: row.bin2MaxCapacity,
    bin2_remain_capacity: row.bin2RemainCapacity,
    bin2_full_at: row.bin2FullAt,
    source_synced_at: row.sourceSyncedAt,
  });
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function formatCapacity(count, max, remain, fullAt) {
  const parts = [];
  if (count !== null && count !== undefined) parts.push(`count=${count}`);
  if (max !== null && max !== undefined) parts.push(`max=${max}`);
  if (remain !== null && remain !== undefined) parts.push(`remain=${remain}`);
  if (fullAt) parts.push(`full_at=${formatDate(fullAt)}`);
  return parts.length ? parts.join(', ') : 'no capacity data';
}

function formatLiveStationContext(rows, checkedAt = new Date(), source = 'live MySQL') {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const isSnapshot = source === 'snapshot';
  const isPostgresSync = /postgres|neon/i.test(source);
  const lines = [
    '## Station / machine status',
    `Checked at: ${checkedAt.toISOString()}`,
    `Source: ${source}`,
    isSnapshot
      ? 'This is a committed station snapshot. Use it when live MySQL is unreachable, and avoid saying it is real-time.'
      : isPostgresSync
        ? 'This context comes from the cloud PostgreSQL station table refreshed by the local MySQL sync job. Use source_synced_at to judge freshness, and do not call it real-time if the sync is stale.'
        : 'Use this live read-only MySQL context for station location, opening hours, machine status, bin capacity, alarms, and heartbeat. Prefer it over older RAG content when there is a conflict.',
  ];

  rows.forEach((row, index) => {
    lines.push(
      '',
      `[IOT-${index + 1}] ${row.stationName || '(unnamed station)'} (${row.stationCode || 'no code'})`,
      `- Address: ${row.address || 'unknown'}`,
      `- Coordinates: ${[row.latitude, row.longitude].filter(Boolean).join(', ') || 'unknown'}`,
      `- Area: ${[row.areaName, row.districtName].filter(Boolean).join(' / ') || 'unknown'}`,
      `- Place: ${row.placeName || 'unknown'}`,
      `- Service hours: ${row.serviceHours || 'unknown'}`,
      `- Station status: ${row.stationStatus || 'unknown'}; updated_at=${formatDate(row.stationStatusUpdatedAt) || 'unknown'}`,
      `- Machine: asset_id=${row.assetId || 'unknown'}; type=${row.machineType || 'unknown'}; kind=${row.machineKind || 'unknown'}`,
      `- Machine status: ${row.machineStatus || 'unknown'}; status_at=${formatDate(row.machineStatusAt) || 'unknown'}`,
      `- Connection: ${row.lastConnectionStatus || 'unknown'}; last_connection_at=${formatDate(row.lastConnectionStatusAt) || 'unknown'}; last_heartbeat_at=${formatDate(row.lastHeartbeatAt) || 'unknown'}`,
      `- Alarm: ${row.alarmCode || 'none'}${row.alarmDescription ? ` (${row.alarmDescription})` : ''}`,
      `- Bin 1: ${formatCapacity(row.bin1Count, row.bin1MaxCapacity, row.bin1RemainCapacity, row.bin1FullAt)}`,
      `- Bin 2: ${formatCapacity(row.bin2Count, row.bin2MaxCapacity, row.bin2RemainCapacity, row.bin2FullAt)}`,
      `- Source synced at: ${formatDate(row.sourceSyncedAt) || 'unknown'}`,
    );
  });

  return lines.join('\n');
}

function loadStationSnapshot(snapshotPath = DEFAULT_SNAPSHOT_PATH) {
  if (!fs.existsSync(snapshotPath)) {
    return { generatedAt: '', rows: [] };
  }

  try {
    const payload = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    const rows = Array.isArray(payload.stations)
      ? payload.stations.map(normalizeSnapshotRow)
      : [];
    return {
      generatedAt: payload.generatedAt || payload.generated_at || '',
      rows,
    };
  } catch (err) {
    console.warn(`IoT station snapshot read failed: ${err.message}`);
    return { generatedAt: '', rows: [] };
  }
}

function scoreSnapshotRow(row, terms) {
  const code = normalizeText(row.stationCode).toLowerCase();
  const name = normalizeText(row.stationName).toLowerCase();
  const haystack = normalizeText([
    row.stationCode,
    row.stationName,
    row.address,
    row.areaName,
    row.districtName,
    row.placeName,
  ].filter(Boolean).join(' ')).toLowerCase();
  let score = 0;

  for (const rawTerm of terms) {
    const term = normalizeText(rawTerm).toLowerCase();
    if (!term) continue;
    if (code === term) score += 100;
    if (name === term) score += 90;
    if (name.includes(term)) score += 40;
    if (code.includes(term)) score += 30;
    if (haystack.includes(term)) score += 10;
  }

  return score;
}

function searchStationSnapshot(snapshot, terms, limit = DEFAULT_LIMIT) {
  if (!Array.isArray(snapshot?.rows) || snapshot.rows.length === 0 || terms.length === 0) {
    return [];
  }

  const cappedLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  return snapshot.rows
    .map(row => ({ row, score: scoreSnapshotRow(row, terms) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.row.stationCode).localeCompare(String(b.row.stationCode)))
    .slice(0, cappedLimit)
    .map(item => item.row);
}

function createIotStatusService({ env = process.env, mysqlFactory = mysql, pgPool = null } = {}) {
  const config = getIotMysqlConfig(env);
  let pool = null;
  let snapshot = null;

  function getPool() {
    if (!isIotMysqlConfigured(env)) return null;
    if (!pool) {
      pool = mysqlFactory.createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        ssl: getMysqlSslOption(config),
        waitForConnections: true,
        connectionLimit: Number.isFinite(config.connectionLimit) && config.connectionLimit > 0 ? config.connectionLimit : 4,
        connectTimeout: Number.isFinite(config.connectTimeoutMs) && config.connectTimeoutMs > 0
          ? config.connectTimeoutMs
          : DEFAULT_CONNECT_TIMEOUT_MS,
        enableKeepAlive: true,
      });
    }
    return pool;
  }

  async function testConnection() {
    const currentPool = getPool();
    if (!currentPool) {
      return {
        configured: false,
        ok: false,
        errorCode: 'NOT_CONFIGURED',
        message: 'ECOCO_IOT_MYSQL_* environment variables are incomplete.',
      };
    }

    try {
      await currentPool.query('SELECT 1');
      return { configured: true, ok: true };
    } catch (err) {
      return sanitizeConnectionError(err);
    }
  }

  function getSnapshot() {
    if (!snapshot) snapshot = loadStationSnapshot(config.snapshotPath);
    return snapshot;
  }

  function retrieveSnapshotStationContext(terms, { limit = DEFAULT_LIMIT, fallbackReason = '' } = {}) {
    const currentSnapshot = getSnapshot();
    const rows = searchStationSnapshot(currentSnapshot, terms, limit);
    return {
      retrievalMode: rows.length > 0 ? 'iot_snapshot' : 'iot_snapshot_miss',
      terms,
      rows,
      snapshotGeneratedAt: currentSnapshot.generatedAt || '',
      fallbackReason,
      context: rows.length > 0
        ? formatLiveStationContext(
          rows,
          currentSnapshot.generatedAt ? new Date(currentSnapshot.generatedAt) : new Date(),
          'snapshot'
        )
        : '',
    };
  }

  async function retrievePostgresStationContext(terms, { limit = DEFAULT_LIMIT } = {}) {
    if (!pgPool || !Array.isArray(terms) || terms.length === 0) {
      return { retrievalMode: 'postgres_iot_disabled', terms, rows: [], context: '' };
    }

    const cappedLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const searchableFields = [
      'station_code',
      'station_name',
      'address',
      'area_name',
      'district_name',
      'place_name',
      'asset_id',
    ];
    const clauses = [];
    const values = [];

    for (const term of terms) {
      for (const field of searchableFields) {
        values.push(`%${escapePostgresLike(term)}%`);
        clauses.push(`COALESCE(${field}, '') ILIKE $${values.length} ESCAPE '\\'`);
      }
    }

    values.push(terms.map(term => String(term)));
    const exactTermsIndex = values.length;
    values.push(`%${escapePostgresLike(terms[0])}%`);
    const firstTermIndex = values.length;
    values.push(cappedLimit);
    const limitIndex = values.length;

    const { rows } = await pgPool.query(
      `SELECT
         station_code,
         station_name,
         address,
         area_name,
         district_name,
         place_name,
         longitude,
         latitude,
         service_hours,
         station_status,
         station_status_updated_at,
         asset_id,
         machine_type,
         machine_kind,
         machine_status,
         machine_status_at,
         last_conn_status,
         last_conn_status_at,
         last_heartbeat_at,
         alarm_code,
         alarm_description,
         bin1_count,
         bin1_max_capacity,
         bin1_remain_capacity,
         bin1_full_at,
         bin2_count,
         bin2_max_capacity,
         bin2_remain_capacity,
         bin2_full_at,
         source_synced_at
       FROM iot_station_statuses
       WHERE ${clauses.join(' OR ')}
       ORDER BY
         CASE
           WHEN station_code = ANY($${exactTermsIndex}::text[]) THEN 0
           WHEN station_name = ANY($${exactTermsIndex}::text[]) THEN 1
           WHEN station_name ILIKE $${firstTermIndex} ESCAPE '\\' THEN 2
           ELSE 3
         END,
         machine_status = 'up' DESC,
         station_code ASC
       LIMIT $${limitIndex}`,
      values
    );

    const safeRows = rows.map(sanitizeRow);
    const syncedDates = safeRows
      .map(row => new Date(row.sourceSyncedAt))
      .filter(date => !Number.isNaN(date.getTime()));
    const checkedAt = syncedDates.length > 0
      ? new Date(Math.max(...syncedDates.map(date => date.getTime())))
      : new Date();

    return {
      retrievalMode: safeRows.length > 0 ? 'postgres_iot' : 'postgres_iot_miss',
      terms,
      rows: safeRows,
      context: formatLiveStationContext(safeRows, checkedAt, 'Neon PostgreSQL station sync'),
    };
  }

  async function retrieveLiveStationContext(question, { classification = null, limit = DEFAULT_LIMIT } = {}) {
    if (!shouldUseLiveStationContext(question, classification)) {
      return { retrievalMode: 'none', terms: [], rows: [], context: '' };
    }

    const terms = buildStationSearchTerms(question);
    if (terms.length === 0) {
      return { retrievalMode: 'mysql_iot_no_terms', terms, rows: [], context: '' };
    }

    if (pgPool) {
      try {
        const postgresResult = await retrievePostgresStationContext(terms, { limit });
        if (postgresResult.rows.length > 0) return postgresResult;
      } catch (err) {
        console.warn(`PostgreSQL IoT station lookup error: ${err.message}`);
      }
    }

    const currentPool = getPool();
    if (!currentPool) {
      return retrieveSnapshotStationContext(terms, {
        limit,
        fallbackReason: 'mysql_iot_disabled',
      });
    }

    const cappedLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const searchableFields = ['s.code', 's.name', 's.address', 's.asset_id', 'a.name', 'd.name', 'p.name', 'm.asset_id'];
    const clauses = [];
    const values = [];
    for (const term of terms) {
      for (const field of searchableFields) {
        clauses.push(`${field} LIKE ?`);
        values.push(`%${term}%`);
      }
    }

    let rows = [];
    try {
      [rows] = await currentPool.query(
        `SELECT
           s.id AS station_id,
           s.code AS station_code,
           s.name AS station_name,
           s.address,
           a.name AS area_name,
           d.name AS district_name,
           p.name AS place_name,
           s.service_hours,
           s.status AS station_status,
           s.status_updated_at AS station_status_updated_at,
           s.asset_id,
           m.type AS machine_type,
           m.kind AS machine_kind,
           m.status AS machine_status,
           m.status_at AS machine_status_at,
           m.last_conn_status,
           m.last_conn_status_at,
           m.last_heartbeat_at,
           m.alarm_code,
           m.alarm_description,
           m.bin1_count,
           m.bin1_max_capacity,
           m.bin1_remain_capacity,
           m.bin1_full_at,
           m.bin2_count,
           m.bin2_max_capacity,
           m.bin2_remain_capacity,
           m.bin2_full_at
         FROM stations s
         LEFT JOIN machines m ON m.asset_id = s.asset_id
         LEFT JOIN areas a ON a.id = s.area_id
         LEFT JOIN districts d ON d.id = s.district_id
         LEFT JOIN places p ON p.id = s.place_id
         WHERE COALESCE(s.is_delete, 0) = 0
           AND (${clauses.join(' OR ')})
         ORDER BY
           CASE
             WHEN s.code IN (${terms.map(() => '?').join(',')}) THEN 0
             WHEN s.name IN (${terms.map(() => '?').join(',')}) THEN 1
             WHEN s.name LIKE ? THEN 2
             ELSE 3
           END,
           s.status = 'up' DESC,
           s.id ASC
         LIMIT ?`,
        [
          ...values,
          ...terms,
          ...terms,
          `%${terms[0]}%`,
          cappedLimit,
        ]
      );
    } catch (err) {
      const fallback = retrieveSnapshotStationContext(terms, {
        limit,
        fallbackReason: err?.code || err?.message || 'mysql_iot_error',
      });
      if (fallback.context) return fallback;
      throw err;
    }

    const safeRows = rows.map(sanitizeRow);
    return {
      retrievalMode: safeRows.length > 0 ? 'mysql_iot' : 'mysql_iot_miss',
      terms,
      rows: safeRows,
      context: formatLiveStationContext(safeRows),
    };
  }

  async function end() {
    if (pool) await pool.end();
    pool = null;
  }

  return {
    end,
    isConfigured: () => isIotMysqlConfigured(env),
    retrieveLiveStationContext,
    retrieveSnapshotStationContext,
    testConnection,
  };
}

module.exports = {
  buildStationSearchTerms,
  createIotStatusService,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_SNAPSHOT_PATH,
  formatLiveStationContext,
  getIotMysqlConfig,
  isIotMysqlConfigured,
  loadStationSnapshot,
  sanitizeConnectionError,
  scoreSnapshotRow,
  searchStationSnapshot,
  shouldUseLiveStationContext,
};
