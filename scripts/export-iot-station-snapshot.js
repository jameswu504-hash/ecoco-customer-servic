const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DEFAULT_OUTPUT_PATH = path.join(__dirname, '..', 'data', 'iot-station-snapshot.json');

function readMcpMysqlEnv(filePath) {
  if (!filePath) return {};
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return payload?.mcpServers?.ecoco_iot?.env || {};
}

function getConfig() {
  const mcpEnv = readMcpMysqlEnv(process.env.MCP_CONFIG_PATH);
  return {
    host: process.env.ECOCO_IOT_MYSQL_HOST || mcpEnv.MYSQL_HOST,
    port: Number(process.env.ECOCO_IOT_MYSQL_PORT || mcpEnv.MYSQL_PORT || 3306),
    user: process.env.ECOCO_IOT_MYSQL_USER || mcpEnv.MYSQL_USER,
    password: process.env.ECOCO_IOT_MYSQL_PASSWORD || mcpEnv.MYSQL_PASS,
    database: process.env.ECOCO_IOT_MYSQL_DATABASE || mcpEnv.MYSQL_DB,
    outputPath: process.env.IOT_STATION_SNAPSHOT_OUTPUT || DEFAULT_OUTPUT_PATH,
  };
}

function assertConfig(config) {
  const missing = ['host', 'user', 'password', 'database'].filter(key => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Missing MySQL config: ${missing.join(', ')}`);
  }
}

function toIso(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toSnapshotRow(row) {
  return {
    stationCode: row.station_code || '',
    stationName: row.station_name || '',
    address: row.address || '',
    areaName: row.area_name || '',
    districtName: row.district_name || '',
    placeName: row.place_name || '',
    serviceHours: row.service_hours || '',
    stationStatus: row.station_status || '',
    stationStatusUpdatedAt: toIso(row.station_status_updated_at),
    machineType: row.machine_type || '',
    machineKind: row.machine_kind || '',
    machineStatus: row.machine_status || '',
    machineStatusAt: toIso(row.machine_status_at),
    lastConnectionStatus: row.last_conn_status || '',
    lastConnectionStatusAt: toIso(row.last_conn_status_at),
    lastHeartbeatAt: toIso(row.last_heartbeat_at),
    alarmCode: row.alarm_code ? 'present' : '',
    alarmDescription: row.alarm_description || '',
    bin1Count: safeNumber(row.bin1_count),
    bin1MaxCapacity: safeNumber(row.bin1_max_capacity),
    bin1RemainCapacity: safeNumber(row.bin1_remain_capacity),
    bin1FullAt: toIso(row.bin1_full_at),
    bin2Count: safeNumber(row.bin2_count),
    bin2MaxCapacity: safeNumber(row.bin2_max_capacity),
    bin2RemainCapacity: safeNumber(row.bin2_remain_capacity),
    bin2FullAt: toIso(row.bin2_full_at),
  };
}

async function main() {
  const config = getConfig();
  assertConfig(config);

  const conn = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: { rejectUnauthorized: false },
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
         s.service_hours,
         s.status AS station_status,
         s.status_updated_at AS station_status_updated_at,
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

    const payload = {
      generatedAt: new Date().toISOString(),
      source: 'readonly MySQL station/machine snapshot',
      notes: 'Fallback data for Render when live Azure MySQL is unreachable. Does not include member fields, phone, email, or long machine asset ids.',
      stationCount: rows.length,
      stations: rows.map(toSnapshotRow),
    };

    fs.mkdirSync(path.dirname(config.outputPath), { recursive: true });
    fs.writeFileSync(config.outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`IoT station snapshot exported: ${rows.length} stations -> ${config.outputPath}`);
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  getConfig,
  toSnapshotRow,
};
