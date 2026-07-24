require('dotenv').config();

const fs = require('fs');
const mysql = require('mysql2/promise');
const { Pool } = require('pg');

const { SCHEMA } = require('../db/schema');

const TABLE_NAME = 'iot_station_statuses';
const BATCH_SIZE = 200;
const UPLOAD_BATCH_SIZE = 100;

function readMcpMysqlEnv(filePath) {
  if (!filePath) return {};
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return payload?.mcpServers?.ecoco_iot?.env || {};
}

function getMysqlConfig() {
  const mcpEnv = readMcpMysqlEnv(process.env.MCP_CONFIG_PATH);
  return {
    host: process.env.ECOCO_IOT_MYSQL_HOST || mcpEnv.MYSQL_HOST,
    port: Number(process.env.ECOCO_IOT_MYSQL_PORT || mcpEnv.MYSQL_PORT || 3306),
    user: process.env.ECOCO_IOT_MYSQL_USER || mcpEnv.MYSQL_USER,
    password: process.env.ECOCO_IOT_MYSQL_PASSWORD || mcpEnv.MYSQL_PASS,
    database: process.env.ECOCO_IOT_MYSQL_DATABASE || mcpEnv.MYSQL_DB,
    sslRejectUnauthorized: String(process.env.ECOCO_IOT_MYSQL_SSL_REJECT_UNAUTHORIZED || 'false').toLowerCase() === 'true',
  };
}

function getPostgresConfig() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Missing DATABASE_URL. Set it to the Neon/PostgreSQL connection string before syncing IoT stations.');
  }

  return {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  };
}

function getUploadConfig() {
  const url = process.env.ECOCO_IOT_SYNC_URL || '';
  const adminKey = process.env.ADMIN_KEY || process.env.ECOCO_IOT_SYNC_ADMIN_KEY || '';
  if (!url || !adminKey) return null;
  return { url, adminKey };
}

function assertMysqlConfig(config) {
  const missing = ['host', 'user', 'password', 'database'].filter(key => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Missing MySQL config: ${missing.join(', ')}`);
  }
}

function toDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIntOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function toText(value) {
  return value === null || value === undefined ? '' : String(value);
}

async function fetchMysqlStationRows(config) {
  const conn = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: { rejectUnauthorized: config.sslRejectUnauthorized },
    connectTimeout: 15000,
  });

  try {
    const [rows] = await conn.query(
      `SELECT
         s.code AS station_code,
         s.name AS station_name,
         s.address,
         a.name AS area_name,
         d.name AS district_name,
         p.name AS place_name,
         s.longitude,
         s.latitude,
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
       ORDER BY s.id ASC`
    );
    return rows;
  } finally {
    await conn.end();
  }
}

function toPostgresRow(row, syncedAt) {
  return {
    station_code: toText(row.station_code).trim(),
    station_name: toText(row.station_name),
    address: toText(row.address),
    area_name: toText(row.area_name),
    district_name: toText(row.district_name),
    place_name: toText(row.place_name),
    longitude: toText(row.longitude),
    latitude: toText(row.latitude),
    service_hours: toText(row.service_hours),
    station_status: toText(row.station_status),
    station_status_updated_at: toDateOrNull(row.station_status_updated_at),
    asset_id: toText(row.asset_id),
    machine_type: toText(row.machine_type),
    machine_kind: toText(row.machine_kind),
    machine_status: toText(row.machine_status),
    machine_status_at: toDateOrNull(row.machine_status_at),
    last_conn_status: toText(row.last_conn_status),
    last_conn_status_at: toDateOrNull(row.last_conn_status_at),
    last_heartbeat_at: toDateOrNull(row.last_heartbeat_at),
    alarm_code: toText(row.alarm_code),
    alarm_description: toText(row.alarm_description),
    bin1_count: toIntOrNull(row.bin1_count),
    bin1_max_capacity: toIntOrNull(row.bin1_max_capacity),
    bin1_remain_capacity: toIntOrNull(row.bin1_remain_capacity),
    bin1_full_at: toDateOrNull(row.bin1_full_at),
    bin2_count: toIntOrNull(row.bin2_count),
    bin2_max_capacity: toIntOrNull(row.bin2_max_capacity),
    bin2_remain_capacity: toIntOrNull(row.bin2_remain_capacity),
    bin2_full_at: toDateOrNull(row.bin2_full_at),
    source_synced_at: syncedAt,
  };
}

async function ensureIotStationTable(pool) {
  for (const stmt of SCHEMA.filter(sql => sql.includes(TABLE_NAME))) {
    await pool.query(stmt);
  }
}

async function upsertStationRows(pool, rows) {
  if (rows.length === 0) return 0;

  const columns = [
    'station_code',
    'station_name',
    'address',
    'area_name',
    'district_name',
    'place_name',
    'longitude',
    'latitude',
    'service_hours',
    'station_status',
    'station_status_updated_at',
    'asset_id',
    'machine_type',
    'machine_kind',
    'machine_status',
    'machine_status_at',
    'last_conn_status',
    'last_conn_status_at',
    'last_heartbeat_at',
    'alarm_code',
    'alarm_description',
    'bin1_count',
    'bin1_max_capacity',
    'bin1_remain_capacity',
    'bin1_full_at',
    'bin2_count',
    'bin2_max_capacity',
    'bin2_remain_capacity',
    'bin2_full_at',
    'source_synced_at',
  ];
  const updateColumns = columns.filter(column => column !== 'station_code');

  let written = 0;
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const batch = rows.slice(offset, offset + BATCH_SIZE);
      const values = [];
      const placeholders = batch.map(row => {
        const start = values.length;
        for (const column of columns) values.push(row[column]);
        return `(${columns.map((_, index) => `$${start + index + 1}`).join(', ')})`;
      });

      await db.query(
        `INSERT INTO ${TABLE_NAME} (${columns.join(', ')})
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (station_code) DO UPDATE SET
           ${updateColumns.map(column => `${column} = EXCLUDED.${column}`).join(', ')},
           updated_at = NOW()`,
        values
      );
      written += batch.length;
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
  }

  return written;
}

async function uploadStationRows({ url, adminKey, stationRows, syncedAt }) {
  let written = 0;
  let received = 0;
  let lastPayload = {};

  for (let offset = 0; offset < stationRows.length; offset += UPLOAD_BATCH_SIZE) {
    const batch = stationRows.slice(offset, offset + UPLOAD_BATCH_SIZE);
    const isFinalBatch = offset + UPLOAD_BATCH_SIZE >= stationRows.length;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-key': adminKey,
      },
      body: JSON.stringify({
        syncedAt: syncedAt.toISOString(),
        stations: batch,
        pruneOlderThanSyncedAt: isFinalBatch,
      }),
    });

    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      throw new Error(`IoT sync upload failed: HTTP ${response.status} ${JSON.stringify(payload).slice(0, 300)}`);
    }

    written += Number(payload.written || 0);
    received += Number(payload.received || batch.length);
    lastPayload = payload;
    console.log(`Uploaded IoT station batch ${Math.floor(offset / UPLOAD_BATCH_SIZE) + 1}: ${batch.length} rows`);
  }

  return {
    ...lastPayload,
    received,
    written,
  };
}

async function syncIotStations() {
  const mysqlConfig = getMysqlConfig();
  assertMysqlConfig(mysqlConfig);

  const syncedAt = new Date();
  const uploadConfig = getUploadConfig();

  const mysqlRows = await fetchMysqlStationRows(mysqlConfig);
  const stationRows = mysqlRows
    .map(row => toPostgresRow(row, syncedAt))
    .filter(row => row.station_code);

  if (uploadConfig) {
    const uploadResult = await uploadStationRows({
      ...uploadConfig,
      stationRows,
      syncedAt,
    });
    return {
      fetched: mysqlRows.length,
      written: Number(uploadResult.written || 0),
      syncedAt: uploadResult.syncedAt || syncedAt.toISOString(),
      mode: 'upload',
    };
  }

  const pgPool = new Pool(getPostgresConfig());
  try {
    await ensureIotStationTable(pgPool);
    const written = await upsertStationRows(pgPool, stationRows);

    return {
      fetched: mysqlRows.length,
      written,
      syncedAt: syncedAt.toISOString(),
      mode: 'postgres',
    };
  } finally {
    await pgPool.end();
  }
}

if (require.main === module) {
  syncIotStations()
    .then(result => {
      console.log(`Synced ${result.written}/${result.fetched} IoT station rows via ${result.mode} at ${result.syncedAt}`);
    })
    .catch(err => {
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = {
  assertMysqlConfig,
  fetchMysqlStationRows,
  getMysqlConfig,
  getPostgresConfig,
  getUploadConfig,
  syncIotStations,
  toPostgresRow,
  uploadStationRows,
  upsertStationRows,
};
