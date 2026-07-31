const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  getRequestCoords,
} = require('../routes/chat.routes');
const {
  attachLiveStationContext,
  buildLiveStationStatusReply,
  formatDistance,
  shouldUseDeterministicStationReply,
} = require('../services/station-response.service');
const { dedupeStationRows, toPostgresRow, uploadStationRows } = require('../scripts/sync-iot-stations-to-postgres');
const { classifyQuestion } = require('../services/question-classifier.service');
const stationQueryIntent = require('../services/station-query-intent.service');
const {
  buildStationSearchTerms,
  createIotStatusService,
  isStationCountQuestion,
  isIotMysqlConfigured,
  normalizeCoords,
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

test('nearby landmark questions extract searchable location aliases', () => {
  const terms = buildStationSearchTerms('成大附近有機台嗎');

  assert.ok(terms.includes('成大'));
  assert.ok(terms.includes('成功大學'));
  assert.ok(terms.includes('大學路'));
  assert.ok(terms.includes('東區'));
  assert.equal(terms.includes('成大附近有'), false);
});

test('bare east district queries are not forced into Tainan', () => {
  const bareTerms = buildStationSearchTerms('東區附近有機台嗎');
  const tainanTerms = buildStationSearchTerms('台南東區附近有機台嗎');

  assert.ok(bareTerms.includes('東區'));
  assert.equal(bareTerms.includes('台南東區'), false);
  assert.ok(tainanTerms.includes('台南東區'));
});

test('district location questions produce clean searchable terms', () => {
  const question = '\u6211\u5728\u53f0\u5317\u5e02\u5927\u5b89\u5340\uff0c\u9019\u88e1\u6709\u6a5f\u53f0\u55ce\uff1f';
  const classification = classifyQuestion(question);
  const terms = buildStationSearchTerms(question);

  assert.equal(classification.category, 'station_machine');
  assert.equal(shouldUseLiveStationContext(question, classification), true);
  assert.ok(terms.includes('\u53f0\u5317\u5e02\u5927\u5b89\u5340'));
  assert.ok(terms.includes('\u81fa\u5317\u5e02\u5927\u5b89\u5340'));
  assert.ok(terms.includes('\u5927\u5b89\u5340'));
  assert.equal(terms.includes('\u6211\u5728\u53f0\u5317\u5e02\u5927\u5b89\u5340'), false);
  assert.equal(terms.includes('\u9019\u88e1'), false);
});

test('city shorthand and station count questions use normalized location terms', () => {
  const cases = [
    ['\u53f0\u4e2d\u6709\u5e7e\u500b\u7ad9', ['\u53f0\u4e2d\u5e02', '\u81fa\u4e2d\u5e02'], true],
    ['\u53f0\u5317\u6709\u5e7e\u7ad9', ['\u53f0\u5317\u5e02', '\u81fa\u5317\u5e02'], true],
    ['\u9ad8\u96c4\u7ad9\u9ede\u6578\u91cf', ['\u9ad8\u96c4\u5e02'], true],
    ['\u65b0\u5317\u5e02\u6709\u591a\u5c11\u500b\u7ad9\u9ede', ['\u65b0\u5317\u5e02'], true],
    ['\u53f0\u4e2d\u54ea\u88e1\u6709\u6a5f\u53f0', ['\u53f0\u4e2d\u5e02', '\u81fa\u4e2d\u5e02'], false],
  ];

  for (const [question, expectedTerms, asksCount] of cases) {
    const classification = classifyQuestion(question);
    const terms = buildStationSearchTerms(question);

    assert.equal(classification.category, 'station_machine', question);
    assert.equal(shouldUseLiveStationContext(question, classification), true, question);
    assert.equal(isStationCountQuestion(question), asksCount, question);
    expectedTerms.forEach(term => assert.ok(terms.includes(term), `${question}: ${term}`));
  }
});

test('district plus store name queries route to live station lookup with a specific store term', () => {
  const question = '\u53f0\u5357\u6771\u5340 \u5d07\u5b78\u5e97';
  const classification = classifyQuestion(question);
  const terms = buildStationSearchTerms(question);

  assert.equal(classification.category, 'station_machine');
  assert.equal(shouldUseLiveStationContext(question, classification), true);
  assert.equal(terms[0], '\u5d07\u5b78');
  assert.ok(terms.includes('\u5d07\u5b78\u5e97'));
  assert.ok(terms.includes('\u6771\u5340'));
});

test('nearby recycling questions are routed to live station lookup', () => {
  for (const question of ['成大附近哪裡可以回收', '成功大學附近有 ECOCO 嗎']) {
    const classification = classifyQuestion(question);
    const terms = buildStationSearchTerms(question);

    assert.equal(classification.category, 'station_machine');
    assert.equal(shouldUseLiveStationContext(question, classification), true);
    assert.ok(terms.includes('成大'));
    assert.ok(terms.includes('成功大學'));
  }
});

test('station name status questions use live lookup and clean search terms', () => {
  for (const question of ['小北百貨台南西門店目前狀態', '小北百貨台南西門店容量']) {
    const classification = classifyQuestion(question);
    const terms = buildStationSearchTerms(question);

    assert.equal(classification.category, 'station_machine');
    assert.equal(shouldUseLiveStationContext(question, classification), true);
    assert.ok(terms.includes('小北百貨台南西門店'));
    assert.equal(terms.some(term => /狀態|容量/.test(term)), false);
  }
});

test('general recycling rule questions do not trigger live station lookup', () => {
  const question = '寶特瓶可以回收嗎';
  const classification = classifyQuestion(question);

  assert.notEqual(classification.category, 'station_machine');
  assert.equal(shouldUseLiveStationContext(question, classification), false);
});

test('partner policy questions mentioning machines do not trigger live station lookup', () => {
  const question = '\u5168\u5bb6\u6709\u6a5f\u53f0\u9700\u8981\u64a4\u96e2\u55ce\uff1f';
  const classification = classifyQuestion(question);

  assert.equal(classification.category, 'station_machine');
  assert.equal(shouldUseLiveStationContext(question, classification), false);
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
    now: () => new Date('2026-07-24T03:20:00Z').getTime(),
  });

  const result = await service.retrieveLiveStationContext('es0140 status', {
    classification: { category: 'station_machine' },
  });

  assert.equal(result.retrievalMode, 'postgres_iot');
  assert.equal(result.isStale, false);
  assert.equal(result.rows[0].stationCode, 'es0140');
  assert.match(result.context, /Source: Neon PostgreSQL station sync/);
  assert.match(result.context, /source_synced_at/);
  assert.equal(pgQueries.length, 1);
  assert.match(pgQueries[0].sql, /FROM iot_station_statuses/);
});

test('nearby landmark lookup can match PostgreSQL address and district fields', async () => {
  const pgQueries = [];
  const pgPool = {
    async query(sql, params = []) {
      pgQueries.push({ sql, params });
      return {
        rows: [{
          station_code: 'es0200',
          station_name: 'Nearby Station',
          address: '台南市東區大學路1號',
          area_name: '台南',
          district_name: '東區',
          place_name: '成功大學',
          station_status: 'up',
          machine_status: 'up',
          last_conn_status: 'online',
          bin1_count: 20,
          bin1_max_capacity: 450,
          bin1_remain_capacity: 430,
          source_synced_at: new Date('2026-07-24T03:10:00Z'),
        }],
      };
    },
  };
  const service = createIotStatusService({
    env: {},
    pgPool,
    now: () => new Date('2026-07-24T03:20:00Z').getTime(),
  });

  const result = await service.retrieveLiveStationContext('成大附近有機台嗎', {
    classification: { category: 'station_machine' },
  });

  assert.equal(result.retrievalMode, 'postgres_iot');
  assert.equal(result.rows[0].stationCode, 'es0200');
  assert.ok(pgQueries[0].params.some(param => String(param).includes('成功大學')));
  assert.ok(pgQueries[0].params.some(param => String(param).includes('大學路')));
});

test('successful PostgreSQL station miss does not fall through to direct MySQL', async () => {
  let pgQueryCount = 0;
  let mysqlPoolCreated = false;
  const pgPool = {
    async query(sql) {
      pgQueryCount += 1;
      if (/MAX\(source_synced_at\)/.test(sql)) {
        return { rows: [{ last_synced_at: new Date('2026-07-24T03:10:00Z') }] };
      }
      return { rows: [] };
    },
  };
  const service = createIotStatusService({
    env: {
      ECOCO_IOT_MYSQL_HOST: 'mysql.example.invalid',
      ECOCO_IOT_MYSQL_USER: 'readonly',
      ECOCO_IOT_MYSQL_PASSWORD: 'secret',
      ECOCO_IOT_MYSQL_DATABASE: 'ecoco',
    },
    mysqlFactory: {
      createPool() {
        mysqlPoolCreated = true;
        throw new Error('direct MySQL should not be used after a successful PostgreSQL miss');
      },
    },
    pgPool,
    now: () => new Date('2026-07-27T03:20:00Z').getTime(),
  });

  const result = await service.retrieveLiveStationContext(
    '\u6211\u5728\u53f0\u5317\u5e02\u5927\u5b89\u5340\uff0c\u9019\u88e1\u6709\u6a5f\u53f0\u55ce\uff1f',
    { classification: { category: 'station_machine' } }
  );

  assert.equal(result.retrievalMode, 'postgres_iot_miss');
  assert.equal(result.rows.length, 0);
  assert.equal(result.isStale, true);
  assert.equal(mysqlPoolCreated, false);
  assert.equal(pgQueryCount, 2);
});

test('PostgreSQL station count queries return distinct station totals', async () => {
  const queries = [];
  const pgPool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/COUNT\(DISTINCT station_code\)/.test(sql)) {
        return { rows: [{ station_count: '42' }] };
      }
      return {
        rows: [{
          station_code: 'es1000',
          station_name: 'Taichung Station',
          address: '\u81fa\u4e2d\u5e02\u897f\u5c6f\u5340\u6e2c\u8a66\u8def1\u865f',
          machine_status: 'up',
          source_synced_at: new Date('2026-07-27T03:10:00Z'),
        }],
      };
    },
  };
  const service = createIotStatusService({
    env: {},
    pgPool,
    now: () => new Date('2026-07-27T03:20:00Z').getTime(),
  });

  const result = await service.retrieveLiveStationContext('\u53f0\u4e2d\u6709\u5e7e\u500b\u7ad9', {
    classification: { category: 'station_machine' },
  });

  assert.equal(result.retrievalMode, 'postgres_iot');
  assert.equal(result.queryIntent.asksCount, true);
  assert.equal(result.matchedStationCount, 42);
  assert.ok(result.terms.includes('\u81fa\u4e2d\u5e02'));
  assert.equal(queries.length, 2);
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
    assert.equal(calls[0].options.headers['x-iot-sync-key'], 'admin-secret');
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
    assert.equal(result.isStale, true);
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

test('successful station miss returns an explicit customer-service reply', async () => {
  const question = '\u6211\u5728\u53f0\u5317\u5e02\u5927\u5b89\u5340\uff0c\u9019\u88e1\u6709\u6a5f\u53f0\u55ce\uff1f';
  const classification = { category: 'station_machine' };
  const merged = await attachLiveStationContext({
    rag: { retrievalMode: 'keyword', context: 'RAG FAQ context', chunks: [] },
    question,
    classification,
    retrieveLiveStationContext: async () => ({
      retrievalMode: 'postgres_iot_miss',
      terms: ['\u53f0\u5317\u5e02\u5927\u5b89\u5340', '\u81fa\u5317\u5e02\u5927\u5b89\u5340', '\u5927\u5b89\u5340'],
      rows: [],
      isStale: true,
      context: '',
      queryIntent: { asksCount: false, isHowTo: false, hasLocationTerms: true },
    }),
  });

  assert.equal(merged.liveStationContext.retrievalMode, 'postgres_iot_miss');
  assert.equal(
    shouldUseDeterministicStationReply(question, classification, merged.liveStationContext),
    true
  );
  const reply = buildLiveStationStatusReply(merged.liveStationContext);
  assert.match(reply, /\u53f0\u5317\u5e02\u5927\u5b89\u5340/);
  assert.match(reply, /\u6c92\u6709\u67e5\u5230\u7ad9\u9ede/);
  assert.doesNotMatch(reply, /\d{4}-\d{2}-\d{2}T/);
});

test('how-to station questions fall through to RAG instead of the miss reply', () => {
  // \u300c\u600e\u9ebc\u67e5\u8a62\u9644\u8fd1\u7684 ECOCO \u7ad9\u9ede\uff1f\u300d\u662f\u4f7f\u7528\u6559\u5b78\u554f\u984c\uff0c
  // \u77e5\u8b58\u5eab\u6709\u7b54\u6848\uff0c\u4e0d\u61c9\u88ab\u56fa\u5b9a miss \u56de\u8986\u651b\u622a\u3002
  const question = '\u600e\u9ebc\u67e5\u8a62\u9644\u8fd1\u7684 ECOCO \u7ad9\u9ede\uff1f';
  const classification = { category: 'station_machine' };
  const missContext = {
    retrievalMode: 'postgres_iot_miss',
    terms: ['\u7ad9\u9ede'],
    rows: [],
    context: '',
    queryIntent: {
      asksCount: stationQueryIntent.isStationCountQuestion(question),
      isHowTo: stationQueryIntent.isStationHowToQuestion(question),
      hasLocationTerms: stationQueryIntent.hasMeaningfulLocationTerms(question),
    },
  };
  assert.equal(missContext.queryIntent.isHowTo, true);
  assert.equal(
    shouldUseDeterministicStationReply(question, classification, missContext),
    false
  );
});

test('generic station terms without a concrete location never trigger the miss reply', () => {
  // terms \u53ea\u5269\u300c\u7ad9\u9ede\u300d\u9019\u985e\u901a\u7a31\u6642\uff0c
  // \u4ee3\u8868\u554f\u984c\u88e1\u6c92\u6709\u53ef\u67e5\u7684\u5730\u9ede\uff0c\u4e0d\u5f97\u56de\u7b54\u300c\u6c92\u6709\u67e5\u5230\u7ad9\u9ede\u300d\u3002
  const question = '\u7ad9\u9ede\u7e3d\u5171\u6709\u591a\u5c11\u500b';
  const classification = { category: 'station_machine' };
  const missContext = {
    retrievalMode: 'postgres_iot_miss',
    terms: ['\u7ad9\u9ede'],
    rows: [],
    context: '',
    queryIntent: {
      asksCount: stationQueryIntent.isStationCountQuestion(question),
      isHowTo: stationQueryIntent.isStationHowToQuestion(question),
      hasLocationTerms: stationQueryIntent.hasMeaningfulLocationTerms(question),
    },
  };
  assert.equal(missContext.queryIntent.hasLocationTerms, false);
  assert.equal(
    shouldUseDeterministicStationReply(question, classification, missContext),
    false
  );
});

test('concrete location misses still use the deterministic miss reply', () => {
  const question = '\u5f70\u5316\u5e02\u6709\u7ad9\u9ede\u55ce';
  const classification = { category: 'station_machine' };
  const missContext = {
    retrievalMode: 'postgres_iot_miss',
    terms: ['\u5f70\u5316\u5e02'],
    rows: [],
    context: '',
    queryIntent: {
      asksCount: false,
      isHowTo: stationQueryIntent.isStationHowToQuestion(question),
      hasLocationTerms: stationQueryIntent.hasMeaningfulLocationTerms(question),
    },
  };
  assert.equal(missContext.queryIntent.hasLocationTerms, true);
  assert.equal(
    shouldUseDeterministicStationReply(question, classification, missContext),
    true
  );
});

test('station count reply reports the database total in customer-service format', () => {
  const reply = buildLiveStationStatusReply({
    retrievalMode: 'postgres_iot',
    terms: ['\u53f0\u4e2d\u5e02', '\u81fa\u4e2d\u5e02'],
    queryIntent: { asksCount: true },
    matchedStationCount: 42,
    rows: [{
      stationCode: 'es1000',
      stationName: '\u6e2c\u8a66\u7ad9\u9ede',
      address: '\u81fa\u4e2d\u5e02\u897f\u5c6f\u5340\u6e2c\u8a66\u8def1\u865f',
      machineStatus: 'up',
    }],
  });

  assert.match(reply, /\u53f0\u4e2d\u5e02/);
  assert.match(reply, /42 \u500b ECOCO \u7ad9\u9ede/);
  assert.match(reply, /\u6e2c\u8a66\u7ad9\u9ede/);
  assert.doesNotMatch(reply, /\u56de\u6536\u69fd 1/);
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

test('closed station status overrides an online machine in customer replies', () => {
  const reply = buildLiveStationStatusReply({
    rows: [{
      stationCode: 'es-closed',
      stationName: '\u6e2c\u8a66\u95dc\u9589\u7ad9',
      address: '\u81fa\u5357\u5e02\u6e2c\u8a66\u8def 1 \u865f',
      stationStatus: 'closed',
      machineStatus: 'up',
      lastConnectionStatus: 'online',
    }],
  });

  assert.match(reply, /\u76ee\u524d\u95dc\u9589/);
  assert.doesNotMatch(reply, /\u6a5f\u53f0\uff1a\u6b63\u5e38/);
});

test('off-hour station status is shown as outside service hours', () => {
  const reply = buildLiveStationStatusReply({
    rows: [{
      stationCode: 'es-off-hour',
      stationName: '\u6e2c\u8a66\u975e\u71df\u696d\u6642\u9593\u7ad9',
      address: '\u81fa\u5357\u5e02\u6e2c\u8a66\u8def 2 \u865f',
      stationStatus: 'off-hour',
      machineStatus: 'up',
      lastConnectionStatus: 'online',
    }],
  });

  assert.match(reply, /\u6a5f\u53f0\uff1a\u975e\u71df\u696d\u6642\u9593/);
  assert.doesNotMatch(reply, /\u6a5f\u53f0\uff1a\u6b63\u5e38/);
});

test('down station status is shown as unavailable instead of offline', () => {
  const reply = buildLiveStationStatusReply({
    rows: [{
      stationCode: 'es-down',
      stationName: '\u6e2c\u8a66\u7121\u6cd5\u670d\u52d9\u7ad9',
      address: '\u81fa\u5357\u5e02\u6e2c\u8a66\u8def 3 \u865f',
      stationStatus: 'down',
      machineStatus: 'up',
      lastConnectionStatus: 'online',
    }],
  });

  assert.match(reply, /\u6a5f\u53f0\uff1a\u76ee\u524d\u7121\u6cd5\u670d\u52d9/);
  assert.doesNotMatch(reply, /\u6a5f\u53f0\uff1a\u96e2\u7dda/);
});

test('offline station status overrides a machine that still reports up', () => {
  const reply = buildLiveStationStatusReply({
    rows: [{
      stationCode: 'es-offline',
      stationName: '\u6e2c\u8a66\u96e2\u7dda\u7ad9',
      address: '\u81fa\u5357\u5e02\u6e2c\u8a66\u8def 4 \u865f',
      stationStatus: 'offline',
      machineStatus: 'up',
      lastConnectionStatus: 'offline',
    }],
  });

  assert.match(reply, /\u6a5f\u53f0\uff1a\u96e2\u7dda/);
  assert.match(reply, /\u9023\u7dda\uff1a\u96e2\u7dda/);
});

test('deterministic station reply only short-circuits status questions', () => {
  const liveStationContext = {
    rows: [{
      stationCode: 'es0140',
      stationName: '\u5c0f\u5317\u767e\u8ca8\u53f0\u5357\u897f\u9580\u5e97\u7ad9',
      address: '\u81fa\u5357\u5e02\u5317\u5340\u897f\u9580\u8def\u56db\u6bb55\u865f',
    }],
  };
  const classification = { category: 'station_machine' };

  assert.equal(
    shouldUseDeterministicStationReply('\u5c0f\u5317\u767e\u8ca8\u53f0\u5357\u897f\u9580\u5e97\u76ee\u524d\u72c0\u614b', classification, liveStationContext),
    true
  );
  assert.equal(
    shouldUseDeterministicStationReply('\u5c0f\u5317\u767e\u8ca8\u7684\u6a5f\u53f0\u53ef\u4ee5\u6295\u725b\u5976\u74f6\u55ce', classification, liveStationContext),
    false
  );
  assert.equal(
    shouldUseDeterministicStationReply('\u5c0f\u5317\u767e\u8ca8\u53ef\u4ee5\u56de\u6536\u55ce', { category: 'recycling_rules' }, liveStationContext),
    false
  );
});

test('station status reply uses nearby wording when multiple stations are found', () => {
  const reply = buildLiveStationStatusReply({
    rows: [
      {
        stationCode: 'es0200',
        stationName: '成大附近站點 A',
        address: '台南市東區大學路1號',
        machineStatus: 'up',
        lastConnectionStatus: 'online',
      },
      {
        stationCode: 'es0201',
        stationName: '成大附近站點 B',
        address: '台南市東區勝利路1號',
        machineStatus: 'up',
        lastConnectionStatus: 'online',
      },
      {
        stationCode: 'es0201',
        stationName: '成大附近站點 B',
        address: '台南市東區勝利路1號',
        machineStatus: 'up',
        lastConnectionStatus: 'online',
        assetId: 'second-machine',
      },
    ],
  });

  assert.match(reply, /幾個可能適合/);
  assert.match(reply, /1\. 成大附近站點 A/);
  assert.match(reply, /2\. 成大附近站點 B/);
  assert.doesNotMatch(reply, /3\. 成大附近站點 B/);
  assert.doesNotMatch(reply, /資料同步時間/);
});

test('station status reply does not mark unknown capacity as full', () => {
  const reply = buildLiveStationStatusReply({
    rows: [{
      stationCode: 'es0300',
      stationName: '容量未知站',
      address: '台南市東區',
      machineStatus: 'up',
      lastConnectionStatus: 'online',
      bin1Count: '',
      bin1MaxCapacity: '',
      bin1RemainCapacity: '',
    }],
  });

  assert.match(reply, /第 1 槽：目前還沒有容量數字/);
  assert.doesNotMatch(reply, /第 1 槽：.*已滿/);
});

test('stale station data never exposes status or capacity as current', () => {
  const reply = buildLiveStationStatusReply({
    isStale: true,
    rows: [{
      stationCode: 'es0400',
      stationName: '過期資料測試站',
      address: '台南市測試區',
      machineStatus: 'up',
      lastConnectionStatus: 'online',
      bin1RemainCapacity: 0,
    }],
  });

  assert.match(reply, /不能確認最新的機台狀態或回收槽容量/);
  assert.match(reply, /過期資料測試站/);
  assert.match(reply, /台南市測試區/);
  assert.doesNotMatch(reply, /機台：正常|連線：正常|剩餘 0|已滿|資料同步時間/);
});

// --- 座標定位查詢 ---

test('normalizeCoords accepts Taiwan coordinates and rejects out-of-range or invalid input', () => {
  // 台中市區
  const ok = normalizeCoords({ lat: 24.1372, lng: 120.6866, label: '  中興大學  ' });
  assert.equal(ok.lat, 24.1372);
  assert.equal(ok.lng, 120.6866);
  assert.equal(ok.label, '中興大學');

  // 超出台灣範圍（東京）
  assert.equal(normalizeCoords({ lat: 35.6762, lng: 139.6503 }), null);
  // 經緯度顛倒
  assert.equal(normalizeCoords({ lat: 120.68, lng: 24.13 }), null);
  // 非數值
  assert.equal(normalizeCoords({ lat: 'abc', lng: 120.68 }), null);
  assert.equal(normalizeCoords(null), null);
  assert.equal(normalizeCoords({}), null);
  // label 超長截斷
  const long = normalizeCoords({ lat: 24.1, lng: 120.6, label: 'x'.repeat(200) });
  assert.equal(long.label.length, 80);
});

test('getRequestCoords parses body coords and drops invalid values', () => {
  const ok = getRequestCoords({ coords: { lat: '25.033', lng: '121.5654', label: '台北101' } });
  assert.equal(ok.lat, 25.033);
  assert.equal(ok.lng, 121.5654);
  assert.equal(ok.label, '台北101');

  assert.equal(getRequestCoords({}), null);
  assert.equal(getRequestCoords({ coords: 'not-an-object' }), null);
  assert.equal(getRequestCoords({ coords: { lat: NaN, lng: 121 } }), null);
  assert.equal(getRequestCoords({ coords: { lat: 35.6762, lng: 139.6503 } }), null);
});

test('formatDistance renders meters under 1 km and kilometers above', () => {
  assert.equal(formatDistance(0.42), '（約 420 公尺）');
  assert.equal(formatDistance(0.004), '（約 10 公尺）');
  assert.equal(formatDistance(1.26), '（約 1.3 公里）');
  assert.equal(formatDistance(12), '（約 12 公里）');
  assert.equal(formatDistance(null), '');
  assert.equal(formatDistance(-1), '');
});

function buildNearestRow(overrides = {}) {
  return {
    station_code: 'es9001',
    station_name: '測試最近站',
    address: '臺中市南區興大路100號',
    area_name: '台中',
    district_name: '南區',
    place_name: '測試據點',
    longitude: '120.6748',
    latitude: '24.1219',
    machine_status: 'up',
    last_conn_status: 'online',
    source_synced_at: new Date().toISOString(),
    distance_km: 0.42,
    ...overrides,
  };
}

test('retrieveNearestStations queries a bounding box then widens once on miss', async () => {
  const calls = [];
  const pgPool = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      // 第一輪（0.15 度）回空，第二輪（0.5 度）回一筆
      if (sql.includes('distance_km') && values[3] === 0.15) return { rows: [] };
      if (sql.includes('distance_km') && values[3] === 0.5) {
        return { rows: [buildNearestRow()] };
      }
      return { rows: [{ last_synced_at: new Date().toISOString() }] };
    },
  };
  const service = createIotStatusService({ env: {}, pgPool });
  const result = await service.retrieveNearestStations({ lat: 24.1219, lng: 120.6748, label: '中興大學' });

  const boxes = calls.filter(c => c.sql.includes('distance_km')).map(c => c.values[3]);
  assert.deepEqual(boxes, [0.15, 0.5]);
  const nearestSql = calls.find(c => c.sql.includes('distance_km')).sql;
  assert.match(nearestSql, /FROM \(\s*SELECT DISTINCT ON \(station_code\)/);
  assert.match(nearestSql, /\)\s+nearest_stations\s+ORDER BY distance_km ASC\s+LIMIT \$3/);
  assert.equal(result.retrievalMode, 'postgres_iot_nearest');
  assert.equal(result.rows[0].distanceKm, 0.42);
  assert.equal(result.coords.label, '中興大學');
  assert.equal(result.isStale, false);
});

test('retrieveNearestStations sorts by distance, trims to limit, and reports miss', async () => {
  const rows = [
    buildNearestRow({ station_code: 'far', distance_km: 3.2 }),
    buildNearestRow({ station_code: 'near', distance_km: 0.3 }),
    buildNearestRow({ station_code: 'mid', distance_km: 1.1 }),
  ];
  const pgPool = {
    query: async sql => (sql.includes('distance_km') ? { rows } : { rows: [{ last_synced_at: new Date().toISOString() }] }),
  };
  const service = createIotStatusService({ env: {}, pgPool });
  const result = await service.retrieveNearestStations({ lat: 24.12, lng: 120.67 }, { limit: 2 });
  assert.deepEqual(result.rows.map(r => r.stationCode), ['near', 'mid']);

  const emptyPool = {
    query: async sql => (sql.includes('distance_km') ? { rows: [] } : { rows: [{ last_synced_at: null }] }),
  };
  const missService = createIotStatusService({ env: {}, pgPool: emptyPool });
  const miss = await missService.retrieveNearestStations({ lat: 24.12, lng: 120.67 });
  assert.equal(miss.retrievalMode, 'postgres_iot_nearest_miss');
  assert.equal(miss.rows.length, 0);
});

test('retrieveLiveStationContext prefers real coordinates over text parsing', async () => {
  const pgPool = {
    query: async sql => (sql.includes('distance_km')
      ? { rows: [buildNearestRow()] }
      : { rows: [{ last_synced_at: new Date().toISOString() }] }),
  };
  const service = createIotStatusService({ env: {}, pgPool });
  // 問題文字完全沒有地點，但座標存在 → 仍應走 nearest 查詢
  const result = await service.retrieveLiveStationContext('查詢我附近的 ECOCO 站點', {
    coords: { lat: 24.1219, lng: 120.6748, label: '中興大學' },
  });
  assert.equal(result.retrievalMode, 'postgres_iot_nearest');
  assert.equal(result.queryIntent.hasCoords, true);
});

test('coordinate lookup misses stay attached and return an explicit reply', async () => {
  const coords = { lat: 24.1219, lng: 120.6748, label: '中興大學' };
  const merged = await attachLiveStationContext({
    rag: { context: '', chunks: [], retrievalMode: 'none' },
    question: '查詢我附近的 ECOCO 站點',
    classification: null,
    coords,
    retrieveLiveStationContext: async () => ({
      retrievalMode: 'postgres_iot_nearest_miss',
      terms: ['中興大學'],
      coords,
      rows: [],
      context: '',
      queryIntent: { hasCoords: true },
    }),
  });

  assert.equal(merged.liveStationContext.retrievalMode, 'postgres_iot_nearest_miss');
  assert.equal(
    shouldUseDeterministicStationReply(
      '查詢我附近的 ECOCO 站點',
      null,
      merged.liveStationContext
    ),
    true
  );
  assert.match(buildLiveStationStatusReply(merged.liveStationContext), /附近沒有查到 ECOCO 站點/);
});

test('nearest-station reply shows distance and hides status when data is stale', () => {
  const base = {
    retrievalMode: 'postgres_iot_nearest',
    coords: { lat: 24.1219, lng: 120.6748, label: '中興大學' },
    rows: [{
      stationCode: 'es9001',
      stationName: '測試最近站',
      address: '臺中市南區興大路100號',
      machineStatus: 'up',
      lastConnectionStatus: 'online',
      distanceKm: 0.42,
    }],
  };

  // 資料新鮮：顯示距離與狀態
  const fresh = buildLiveStationStatusReply({ ...base, isStale: false });
  assert.match(fresh, /離「中興大學」最近/);
  assert.match(fresh, /約 420 公尺/);
  assert.match(fresh, /機台正常/);

  // 資料過期：距離與地址保留（站點不會移動），狀態不得揭露
  const stale = buildLiveStationStatusReply({ ...base, isStale: true });
  assert.match(stale, /約 420 公尺/);
  assert.match(stale, /臺中市南區興大路100號/);
  assert.doesNotMatch(stale, /機台正常|連線正常/);
  assert.match(stale, /不能確認最新的機台狀態/);

  // 有座標結果時，不需分類器同意即走固定回覆
  assert.equal(shouldUseDeterministicStationReply('隨便的問題', null, { ...base, isStale: false }), true);
});

test('LINE-style location payload normalizes into query coords', () => {
  // 模擬 LINE location message 欄位
  const message = { latitude: 24.1219, longitude: 120.6748, title: '國立中興大學', address: '402台中市南區興大路145號' };
  const coords = normalizeCoords({ lat: message.latitude, lng: message.longitude, label: message.title || message.address });
  assert.equal(coords.lat, 24.1219);
  assert.equal(coords.label, '國立中興大學');
});
