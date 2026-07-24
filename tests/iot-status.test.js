const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { attachLiveStationContext, buildLiveStationStatusReply } = require('../routes/chat.routes');
const { dedupeStationRows, toPostgresRow, uploadStationRows } = require('../scripts/sync-iot-stations-to-postgres');
const {
  buildStationSearchTerms,
  createIotStatusService,
  isIotMysqlConfigured,
  sanitizeConnectionError,
  shouldUseLiveStationContext,
} = require('../services/iot-status.service');

test('IoT MySQL config is optional', async () => {
  const service = createIotStatusService({
    env: {
      ECOCO_IOT_STATION_SNAPSHOT_PATH: path.join(__dirname, '.missing-iot-snapshot.json'),
    },
  });
  const result = await service.retrieveLiveStationContext('台南崇學站現在能不能投', {
    classification: { category: 'station_machine' },
  });

  assert.equal(isIotMysqlConfigured({}), false);
  assert.equal(service.isConfigured(), false);
  assert.equal(result.retrievalMode, 'iot_snapshot_miss');
  assert.equal(result.context, '');
});

test('station questions extract useful MySQL search terms', () => {
  const terms = buildStationSearchTerms('台南崇學站現在能不能投？');

  assert.ok(terms.includes('台南崇學站'));
  assert.ok(terms.includes('崇學站'));
  assert.ok(terms.includes('崇學'));
});

test('station code questions extract useful terms before English words', () => {
  const question = 'es0140 current machine status and bin capacity';
  const terms = buildStationSearchTerms(question);

  assert.ok(terms.includes('es0140'));
  assert.equal(shouldUseLiveStationContext(question), true);
});

test('live station lookup formats readonly MySQL context', async () => {
  const queries = [];
  const fakePool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      return [[{
        station_id: 1,
        station_code: 'es0140',
        station_name: '小北百貨台南西門店站',
        address: '臺南市北區西門路四段5號',
        area_name: '臺南',
        district_name: '北區',
        place_name: '小北百貨',
        service_hours: '24H',
        station_status: 'up',
        station_status_updated_at: new Date('2026-07-24T01:00:00Z'),
        asset_id: ['809005', '909710', '0101942'].join(''),
        machine_type: 'ai',
        machine_kind: 'AI-4',
        machine_status: 'up',
        machine_status_at: new Date('2026-07-24T02:00:00Z'),
        last_conn_status: 'online',
        last_conn_status_at: new Date('2026-07-24T03:00:00Z'),
        last_heartbeat_at: new Date('2026-07-24T03:05:00Z'),
        alarm_code: null,
        alarm_description: null,
        bin1_count: 100,
        bin1_max_capacity: 1500,
        bin1_remain_capacity: 1400,
        bin1_full_at: null,
        bin2_count: 200,
        bin2_max_capacity: 1500,
        bin2_remain_capacity: 1300,
        bin2_full_at: null,
      }]];
    },
    async end() {},
  };
  const mysqlFactory = { createPool: () => fakePool };
  const service = createIotStatusService({
    env: {
      ECOCO_IOT_MYSQL_HOST: 'example.invalid',
      ECOCO_IOT_MYSQL_USER: 'readonly',
      ECOCO_IOT_MYSQL_PASSWORD: 'secret',
      ECOCO_IOT_MYSQL_DATABASE: 'ecoco',
    },
    mysqlFactory,
  });

  const result = await service.retrieveLiveStationContext('台南西門店站狀態', {
    classification: { category: 'station_machine' },
  });

  assert.equal(result.retrievalMode, 'mysql_iot');
  assert.equal(result.rows.length, 1);
  assert.match(result.context, /Station \/ machine status/);
  assert.match(result.context, /Source: live MySQL/);
  assert.match(result.context, /小北百貨台南西門店站/);
  assert.match(result.context, /last_heartbeat_at/);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /FROM stations s/);
});

test('station lookup prefers PostgreSQL sync rows before MySQL fallback', async () => {
  const pgQueries = [];
  const pgPool = {
    async query(sql, params = []) {
      pgQueries.push({ sql, params });
      return {
        rows: [{
          station_code: 'es0140',
          station_name: 'Synced Station',
          address: 'Synced Address',
          area_name: 'Tainan',
          district_name: 'West Central',
          place_name: 'Synced Place',
          longitude: '120.197',
          latitude: '22.991',
          service_hours: '24H',
          station_status: 'up',
          station_status_updated_at: new Date('2026-07-24T01:00:00Z'),
          asset_id: 'asset-1',
          machine_type: 'ai',
          machine_kind: 'AI-4',
          machine_status: 'up',
          machine_status_at: new Date('2026-07-24T02:00:00Z'),
          last_conn_status: 'online',
          last_conn_status_at: new Date('2026-07-24T03:00:00Z'),
          last_heartbeat_at: new Date('2026-07-24T03:05:00Z'),
          bin1_count: 100,
          bin1_max_capacity: 1500,
          bin1_remain_capacity: 1400,
          bin2_count: 200,
          bin2_max_capacity: 1500,
          bin2_remain_capacity: 1300,
          source_synced_at: new Date('2026-07-24T03:10:00Z'),
        }],
      };
    },
  };
  const mysqlFactory = {
    createPool() {
      throw new Error('MySQL should not be created when PostgreSQL has a hit');
    },
  };
  const service = createIotStatusService({
    env: {
      ECOCO_IOT_MYSQL_HOST: 'example.invalid',
      ECOCO_IOT_MYSQL_USER: 'readonly',
      ECOCO_IOT_MYSQL_PASSWORD: 'secret',
      ECOCO_IOT_MYSQL_DATABASE: 'ecoco',
    },
    mysqlFactory,
    pgPool,
  });

  const result = await service.retrieveLiveStationContext('es0140 status', {
    classification: { category: 'station_machine' },
  });

  assert.equal(result.retrievalMode, 'postgres_iot');
  assert.equal(result.rows[0].stationCode, 'es0140');
  assert.match(result.context, /Source: Neon PostgreSQL station sync/);
  assert.match(result.context, /source_synced_at/);
  assert.equal(pgQueries.length, 1);
  assert.match(pgQueries[0].sql, /FROM iot_station_statuses/);
});

test('IoT sync script normalizes MySQL station rows for PostgreSQL upsert', () => {
  const syncedAt = new Date('2026-07-24T03:10:00Z');
  const row = toPostgresRow({
    station_code: ' es0140 ',
    station_name: 'Synced Station',
    longitude: 120.197,
    latitude: 22.991,
    machine_status: 'up',
    station_status_updated_at: '2026-07-24T01:00:00Z',
    bin1_count: '100',
    bin1_max_capacity: '1500',
    bin1_remain_capacity: '1400',
    bin2_count: '',
  }, syncedAt);

  assert.equal(row.station_code, 'es0140');
  assert.equal(row.longitude, '120.197');
  assert.equal(row.latitude, '22.991');
  assert.equal(row.machine_status, 'up');
  assert.equal(row.bin1_count, 100);
  assert.equal(row.bin1_max_capacity, 1500);
  assert.equal(row.bin1_remain_capacity, 1400);
  assert.equal(row.bin2_count, null);
  assert.equal(row.station_status_updated_at.toISOString(), '2026-07-24T01:00:00.000Z');
  assert.equal(row.source_synced_at, syncedAt);
});

test('IoT sync script dedupes station rows by station code and asset id', () => {
  const rows = dedupeStationRows([
    {
      station_code: 'es0002',
      asset_id: 'asset-a',
      machine_status: 'down',
      last_heartbeat_at: new Date('2026-07-24T01:00:00Z'),
    },
    {
      station_code: 'es0002',
      asset_id: 'asset-a',
      machine_status: 'up',
      last_heartbeat_at: new Date('2026-07-24T02:00:00Z'),
    },
    {
      station_code: 'es0002',
      asset_id: 'asset-b',
      machine_status: 'up',
      last_heartbeat_at: new Date('2026-07-24T01:30:00Z'),
    },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.asset_id === 'asset-a').machine_status, 'up');
  assert.equal(rows.find(row => row.asset_id === 'asset-b').machine_status, 'up');
});

test('IoT sync script uploads station rows in admin-protected batches', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    const payload = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          ok: true,
          received: payload.stations.length,
          written: payload.stations.length,
          syncedAt: payload.syncedAt,
        });
      },
    };
  };

  try {
    const rows = Array.from({ length: 41 }, (_, index) => ({
      station_code: `es${String(index).padStart(4, '0')}`,
    }));
    const result = await uploadStationRows({
      url: 'https://example.invalid/api/iot/station-statuses/sync',
      adminKey: 'admin-secret',
      stationRows: rows,
      syncedAt: new Date('2026-07-24T03:10:00Z'),
    });

    assert.equal(calls.length, 3);
    assert.equal(JSON.parse(calls[0].options.body).stations.length, 20);
    assert.equal(JSON.parse(calls[1].options.body).stations.length, 20);
    assert.equal(JSON.parse(calls[2].options.body).stations.length, 1);
    assert.equal(JSON.parse(calls[0].options.body).pruneOlderThanSyncedAt, false);
    assert.equal(JSON.parse(calls[1].options.body).pruneOlderThanSyncedAt, false);
    assert.equal(JSON.parse(calls[2].options.body).pruneOlderThanSyncedAt, true);
    assert.equal(calls[0].options.headers['x-admin-key'], 'admin-secret');
    assert.equal(result.written, 41);
  } finally {
    global.fetch = originalFetch;
  }
});

test('IoT MySQL connection diagnostics return sanitized errors', async () => {
  const fakePool = {
    async query() {
      const err = new Error('connect ETIMEDOUT');
      err.code = 'ETIMEDOUT';
      throw err;
    },
    async end() {},
  };
  const service = createIotStatusService({
    env: {
      ECOCO_IOT_MYSQL_HOST: 'example.invalid',
      ECOCO_IOT_MYSQL_USER: 'readonly',
      ECOCO_IOT_MYSQL_PASSWORD: 'secret',
      ECOCO_IOT_MYSQL_DATABASE: 'ecoco',
      ECOCO_IOT_MYSQL_CONNECT_TIMEOUT_MS: '5000',
    },
    mysqlFactory: {
      createPool(options) {
        assert.equal(options.connectTimeout, 5000);
        return fakePool;
      },
    },
  });

  assert.deepEqual(await service.testConnection(), {
    configured: true,
    ok: false,
    errorCode: 'ETIMEDOUT',
    message: 'connect ETIMEDOUT',
  });
  assert.deepEqual(sanitizeConnectionError(new Error('bad')), {
    configured: true,
    ok: false,
    errorCode: 'Error',
    message: 'bad',
  });
});

test('IoT snapshot is used when live MySQL is unreachable', async () => {
  const tempPath = path.join(__dirname, `.tmp-iot-snapshot-${Date.now()}.json`);
  fs.writeFileSync(tempPath, JSON.stringify({
    generatedAt: '2026-07-24T00:00:00.000Z',
    stations: [{
      stationCode: 'es0140',
      stationName: '小北百貨台南西門店站',
      address: '臺南市北區西門路四段5號',
      areaName: '臺南',
      districtName: '北區',
      placeName: '小北百貨',
      serviceHours: '24H',
      stationStatus: 'up',
      machineStatus: 'up',
      lastConnectionStatus: 'online',
      bin1RemainCapacity: 56,
      bin2RemainCapacity: 0,
    }],
  }), 'utf8');

  const fakePool = {
    async query() {
      const err = new Error('connect ETIMEDOUT');
      err.code = 'ETIMEDOUT';
      throw err;
    },
    async end() {},
  };
  const service = createIotStatusService({
    env: {
      ECOCO_IOT_MYSQL_HOST: 'example.invalid',
      ECOCO_IOT_MYSQL_USER: 'readonly',
      ECOCO_IOT_MYSQL_PASSWORD: 'secret',
      ECOCO_IOT_MYSQL_DATABASE: 'ecoco',
      ECOCO_IOT_STATION_SNAPSHOT_PATH: tempPath,
    },
    mysqlFactory: { createPool: () => fakePool },
  });

  try {
    const result = await service.retrieveLiveStationContext('小北百貨台南西門店站現在正常嗎', {
      classification: { category: 'station_machine' },
    });

    assert.equal(result.retrievalMode, 'iot_snapshot');
    assert.equal(result.fallbackReason, 'ETIMEDOUT');
    assert.equal(result.rows[0].stationCode, 'es0140');
    assert.match(result.context, /Source: snapshot/);
    assert.match(result.context, /小北百貨台南西門店站/);
  } finally {
    fs.unlinkSync(tempPath);
  }
});

test('live station context is attached to the RAG prompt only for station questions', async () => {
  const originalRag = {
    retrievalMode: 'keyword',
    context: 'RAG FAQ context',
    chunks: [],
  };

  const merged = await attachLiveStationContext({
    rag: originalRag,
    question: 'es0140 現在正常嗎',
    classification: { category: 'station_machine' },
    retrieveLiveStationContext: async () => ({
      retrievalMode: 'mysql_iot',
      context: 'Live station context',
      rows: [{ stationCode: 'es0140' }],
    }),
  });

  assert.equal(shouldUseLiveStationContext('es0140 現在正常嗎'), true);
  assert.equal(merged.retrievalMode, 'keyword+mysql_iot');
  assert.match(merged.context, /RAG FAQ context/);
  assert.match(merged.context, /Live station context/);
});

test('station status reply is deterministic when live station rows are found', () => {
  const reply = buildLiveStationStatusReply({
    rows: [{
      stationCode: 'es0140',
      stationName: '小北百貨台南西門店站',
      address: '臺南市北區西門路四段5號',
      machineStatus: 'up',
      lastConnectionStatus: 'online',
      bin1Count: 199,
      bin1MaxCapacity: 450,
      bin1RemainCapacity: 56,
      bin2Count: 1500,
      bin2MaxCapacity: 1500,
      bin2RemainCapacity: 0,
      sourceSyncedAt: '2026-07-24T08:30:17.872Z',
    }],
  });

  assert.match(reply, /小北百貨台南西門店站/);
  assert.match(reply, /幫你查到這個站點目前的狀況/);
  assert.match(reply, /目前狀態\n機台：正常\n連線：正常/);
  assert.match(reply, /回收槽容量\n第 1 槽：剩餘 56，目前 199\/450/);
  assert.match(reply, /第 2 槽：剩餘 0，目前 1500\/1500（目前看起來已滿）/);
  assert.doesNotMatch(reply, /資料同步時間/);
  assert.doesNotMatch(reply, /2026-07-24T08:30:17.872Z/);
});
