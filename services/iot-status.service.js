const mysql = require('mysql2/promise');
const stationQueryIntent = require('./station-query-intent.service');

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 8;
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
const DEFAULT_STATION_DATA_MAX_AGE_MS = 30 * 60 * 1000;
// 台灣本島與離島的座標合理範圍；超出者視為無效輸入。
const TAIWAN_BOUNDS = { minLat: 21.5, maxLat: 26.5, minLng: 118.0, maxLng: 122.5 };
// 最近站點查詢的矩形粗篩範圍（度）。0.15 度在台灣緯度約 16 km；
// 第一輪查無時放寬到 0.5 度（約 55 km）再試一次。
const NEAREST_BOUNDING_DEGREES = [0.15, 0.5];

function normalizeCoords(coords) {
  const lat = Number(coords?.lat);
  const lng = Number(coords?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < TAIWAN_BOUNDS.minLat || lat > TAIWAN_BOUNDS.maxLat) return null;
  if (lng < TAIWAN_BOUNDS.minLng || lng > TAIWAN_BOUNDS.maxLng) return null;
  return {
    lat,
    lng,
    label: String(coords?.label || '').trim().slice(0, 80),
  };
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

function getStationDataMaxAgeMs(env = process.env) {
  const value = Number(env.STATION_DATA_MAX_AGE_MS || DEFAULT_STATION_DATA_MAX_AGE_MS);
  if (!Number.isFinite(value) || value < 60 * 1000) return DEFAULT_STATION_DATA_MAX_AGE_MS;
  return Math.floor(value);
}

function getStationDataFreshness(value, env = process.env, now = Date.now()) {
  const syncedAt = new Date(value);
  const maxAgeMs = getStationDataMaxAgeMs(env);
  if (Number.isNaN(syncedAt.getTime())) {
    return {
      checkedAt: null,
      dataAgeMs: null,
      maxAgeMs,
      isStale: true,
    };
  }

  const dataAgeMs = Math.max(0, Number(now) - syncedAt.getTime());
  return {
    checkedAt: syncedAt.toISOString(),
    dataAgeMs,
    maxAgeMs,
    isStale: dataAgeMs > maxAgeMs,
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

function shouldUseLiveStationContext(question, _classification = null) {
  return stationQueryIntent.isStationDataQuestion(question);
}

function buildStationSearchTerms(question) {
  return stationQueryIntent.buildStationSearchTerms(question);
}

function isStationCountQuestion(question) {
  return stationQueryIntent.isStationCountQuestion(question);
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

function formatLiveStationContext(rows, checkedAt = new Date(), source = 'live MySQL', freshness = null) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const isPostgresSync = /postgres|neon/i.test(source);
  const lines = [
    '## Station / machine status',
    `Checked at: ${checkedAt.toISOString()}`,
    `Source: ${source}`,
    isPostgresSync
      ? 'This context comes from the cloud PostgreSQL station table refreshed by the local MySQL sync job. Use source_synced_at to judge freshness, and do not call it real-time if the sync is stale.'
      : 'Use this live read-only MySQL context for station location, opening hours, machine status, bin capacity, alarms, and heartbeat. Prefer it over older RAG content when there is a conflict.',
    freshness?.isStale
      ? 'STALE DATA: You may use station names and addresses, but must not present machine status, connection status, alarms, or bin capacity as current.'
      : '',
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

function createIotStatusService({
  env = process.env,
  mysqlFactory = mysql,
  pgPool = null,
  now = () => Date.now(),
} = {}) {
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

  // 依經緯度找最近站點。先用矩形粗篩讓索引生效，查無時放寬範圍重試一次。
  // Haversine 純 SQL 實作；752 筆規模不需要 PostGIS。
  async function retrieveNearestStations(coords, { limit = DEFAULT_LIMIT } = {}) {
    const safeCoords = normalizeCoords(coords);
    if (!pgPool || !safeCoords) {
      return { retrievalMode: 'postgres_iot_disabled', terms: [], rows: [], context: '' };
    }

    const cappedLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    let rows = [];
    for (const boundingDegrees of NEAREST_BOUNDING_DEGREES) {
      const result = await pgPool.query(
        `SELECT *
         FROM (
           SELECT DISTINCT ON (station_code)
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
             source_synced_at,
             6371 * 2 * ASIN(SQRT(
               POWER(SIN(RADIANS(lat_num - $1) / 2), 2) +
               COS(RADIANS($1)) * COS(RADIANS(lat_num)) *
               POWER(SIN(RADIANS(lng_num - $2) / 2), 2)
             )) AS distance_km
           FROM iot_station_statuses
           WHERE lat_num IS NOT NULL AND lng_num IS NOT NULL
             AND lat_num BETWEEN $1 - $4 AND $1 + $4
             AND lng_num BETWEEN $2 - $4 AND $2 + $4
           ORDER BY station_code, distance_km, source_synced_at DESC
         ) nearest_stations
         ORDER BY distance_km ASC
         LIMIT $3`,
        [safeCoords.lat, safeCoords.lng, cappedLimit, boundingDegrees]
      );
      rows = result.rows;
      if (rows.length > 0) break;
    }

    // DISTINCT ON 需以 station_code 排序，這裡再依距離排序取前 N 筆。
    rows.sort((a, b) => Number(a.distance_km) - Number(b.distance_km));
    rows = rows.slice(0, cappedLimit);

    const safeRows = rows.map(row => ({
      ...sanitizeRow(row),
      distanceKm: Number.isFinite(Number(row.distance_km))
        ? Math.round(Number(row.distance_km) * 100) / 100
        : null,
    }));

    const syncedDates = safeRows
      .map(row => new Date(row.sourceSyncedAt))
      .filter(date => !Number.isNaN(date.getTime()));
    let checkedAt = syncedDates.length > 0
      ? new Date(Math.max(...syncedDates.map(date => date.getTime())))
      : null;
    if (!checkedAt) {
      const syncStatus = await pgPool.query(
        'SELECT MAX(source_synced_at) AS last_synced_at FROM iot_station_statuses'
      );
      const lastSyncedAt = syncStatus.rows[0]?.last_synced_at;
      const parsed = lastSyncedAt ? new Date(lastSyncedAt) : null;
      checkedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
    }
    const freshness = getStationDataFreshness(checkedAt, env, now());

    return {
      retrievalMode: safeRows.length > 0 ? 'postgres_iot_nearest' : 'postgres_iot_nearest_miss',
      terms: safeCoords.label ? [safeCoords.label] : [],
      coords: { lat: safeCoords.lat, lng: safeCoords.lng, label: safeCoords.label },
      rows: safeRows,
      ...freshness,
      context: formatLiveStationContext(
        safeRows,
        checkedAt || new Date(now()),
        'Neon PostgreSQL station sync',
        freshness
      ),
    };
  }

  async function retrievePostgresStationContext(terms, { limit = DEFAULT_LIMIT, includeCount = false } = {}) {
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

    let matchedStationCount = null;
    if (includeCount) {
      const countResult = await pgPool.query(
        `SELECT COUNT(DISTINCT station_code) AS station_count
         FROM iot_station_statuses
         WHERE ${clauses.join(' OR ')}`,
        values
      );
      matchedStationCount = Number(countResult.rows[0]?.station_count || 0);
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
    let checkedAt = syncedDates.length > 0
      ? new Date(Math.max(...syncedDates.map(date => date.getTime())))
      : null;
    if (!checkedAt) {
      const syncStatus = await pgPool.query(
        'SELECT MAX(source_synced_at) AS last_synced_at FROM iot_station_statuses'
      );
      const lastSyncedAt = syncStatus.rows[0]?.last_synced_at;
      const parsed = lastSyncedAt ? new Date(lastSyncedAt) : null;
      checkedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
    }
    const freshness = getStationDataFreshness(checkedAt, env, now());

    return {
      retrievalMode: safeRows.length > 0 ? 'postgres_iot' : 'postgres_iot_miss',
      terms,
      rows: safeRows,
      matchedStationCount,
      ...freshness,
      context: formatLiveStationContext(
        safeRows,
        checkedAt || new Date(now()),
        'Neon PostgreSQL station sync',
        freshness
      ),
    };
  }

  async function retrieveLiveStationContext(question, { classification = null, limit = DEFAULT_LIMIT, coords = null } = {}) {
    const safeCoords = normalizeCoords(coords);
    const queryIntent = {
      asksCount: isStationCountQuestion(question),
      isHowTo: stationQueryIntent.isStationHowToQuestion(question),
      hasLocationTerms: stationQueryIntent.hasMeaningfulLocationTerms(question),
      hasCoords: Boolean(safeCoords),
    };
    const withQueryIntent = result => ({ ...result, queryIntent });

    // 有真實座標時直接走距離查詢，不需要文字地點解析。
    if (safeCoords && pgPool) {
      try {
        return withQueryIntent(await retrieveNearestStations(safeCoords, { limit }));
      } catch (err) {
        console.warn(`PostgreSQL nearest station lookup error: ${err.message}`);
      }
    }

    if (!shouldUseLiveStationContext(question, classification)) {
      return withQueryIntent({ retrievalMode: 'none', terms: [], rows: [], context: '' });
    }

    const terms = buildStationSearchTerms(question);
    if (terms.length === 0) {
      return withQueryIntent({ retrievalMode: 'postgres_iot_no_terms', terms, rows: [], context: '' });
    }

    if (pgPool) {
      try {
        const postgresResult = await retrievePostgresStationContext(terms, {
          limit,
          includeCount: queryIntent.asksCount,
        });
        return withQueryIntent(postgresResult);
      } catch (err) {
        console.warn(`PostgreSQL IoT station lookup error: ${err.message}`);
        return withQueryIntent({
          retrievalMode: 'iot_unavailable',
          terms,
          rows: [],
          context: '',
          fallbackReason: 'postgres_iot_error',
        });
      }
    }

    return withQueryIntent({
      retrievalMode: 'iot_unavailable',
      terms,
      rows: [],
      context: '',
      fallbackReason: 'postgres_iot_disabled',
    });

  }

  async function end() {
    if (pool) await pool.end();
    pool = null;
  }

  return {
    end,
    getFreshness: value => getStationDataFreshness(value, env, now()),
    isConfigured: () => isIotMysqlConfigured(env),
    retrieveLiveStationContext,
    retrieveNearestStations,
    testConnection,
  };
}

module.exports = {
  buildStationSearchTerms,
  createIotStatusService,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_STATION_DATA_MAX_AGE_MS,
  formatLiveStationContext,
  getIotMysqlConfig,
  getStationDataFreshness,
  normalizeCoords,
  TAIWAN_BOUNDS,
  getStationDataMaxAgeMs,
  isStationCountQuestion,
  isIotMysqlConfigured,
  sanitizeConnectionError,
  shouldUseLiveStationContext,
};
