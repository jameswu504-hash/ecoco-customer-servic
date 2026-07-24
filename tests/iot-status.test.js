const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { attachLiveStationContext } = require('../routes/chat.routes');
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
  assert.match(result.context, /Live MySQL station/);
  assert.match(result.context, /小北百貨台南西門店站/);
  assert.match(result.context, /last_heartbeat_at/);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /FROM stations s/);
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
