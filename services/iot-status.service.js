const mysql = require('mysql2/promise');

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 8;
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;

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

function shouldUseLiveStationContext(question, classification = null) {
  if (classification?.category === 'station_machine') return true;
  const text = normalizeText(question).toLowerCase();
  return /(站點|站|機台|機器|滿倉|故障|維修|地址|營業時間|能不能投|可以投|回收機|offline|online|asset|es\d+)/i.test(text);
}

function stripCommonStationWords(value) {
  return String(value || '')
    .replace(/請問|想問|查詢|現在|目前|可以|可不可以|能不能|是否|怎麼|如何|哪裡|在哪|地址|位置|營業時間|狀態|機台|機器|回收機|回收|投遞|投瓶|滿倉|故障|維修|正常|使用|嗎|呢|的|有沒有/g, '')
    .trim();
}

function addTerm(terms, value) {
  const term = stripCommonStationWords(normalizeText(value));
  if (term.length >= 2 && term.length <= 40) terms.add(term);
}

function buildStationSearchTerms(question) {
  const text = normalizeText(question);
  const terms = new Set();
  const cityPrefixes = [
    '臺北', '台北', '新北', '桃園', '臺中', '台中', '臺南', '台南', '高雄',
    '基隆', '新竹', '苗栗', '彰化', '南投', '雲林', '嘉義', '屏東', '宜蘭',
    '花蓮', '臺東', '台東', '澎湖', '金門', '連江',
  ];

  for (const match of text.matchAll(/\bes\d{3,6}\b/gi)) addTerm(terms, match[0]);
  for (const match of text.matchAll(/\b\d{8,22}\b/g)) addTerm(terms, match[0]);
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
  };
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

function formatLiveStationContext(rows, checkedAt = new Date()) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const lines = [
    '## Live MySQL station / machine status',
    `Checked at: ${checkedAt.toISOString()}`,
    'Use this live read-only MySQL context for station location, opening hours, machine status, bin capacity, alarms, and heartbeat. Prefer it over older RAG content when there is a conflict.',
  ];

  rows.forEach((row, index) => {
    lines.push(
      '',
      `[IOT-${index + 1}] ${row.stationName || '(unnamed station)'} (${row.stationCode || 'no code'})`,
      `- Address: ${row.address || 'unknown'}`,
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
    );
  });

  return lines.join('\n');
}

function createIotStatusService({ env = process.env, mysqlFactory = mysql } = {}) {
  const config = getIotMysqlConfig(env);
  let pool = null;

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

  async function retrieveLiveStationContext(question, { classification = null, limit = DEFAULT_LIMIT } = {}) {
    if (!shouldUseLiveStationContext(question, classification)) {
      return { retrievalMode: 'none', terms: [], rows: [], context: '' };
    }

    const currentPool = getPool();
    if (!currentPool) {
      return { retrievalMode: 'mysql_iot_disabled', terms: [], rows: [], context: '' };
    }

    const terms = buildStationSearchTerms(question);
    if (terms.length === 0) {
      return { retrievalMode: 'mysql_iot_no_terms', terms, rows: [], context: '' };
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

    const [rows] = await currentPool.query(
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
    testConnection,
  };
}

module.exports = {
  buildStationSearchTerms,
  createIotStatusService,
  DEFAULT_CONNECT_TIMEOUT_MS,
  formatLiveStationContext,
  getIotMysqlConfig,
  isIotMysqlConfigured,
  sanitizeConnectionError,
  shouldUseLiveStationContext,
};
