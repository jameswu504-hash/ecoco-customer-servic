const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  LEGACY_STATION_CATEGORY_PREFIX,
  LIVE_STATION_GUIDANCE_CATEGORY,
  LIVE_STATION_GUIDANCE_CONTENT,
  purgeLegacyStationKnowledge,
} = require('../services/knowledge-maintenance.service');
const {
  buildB2CQuickReplyItems,
  buildLineTextMessage,
} = require('../services/line-shared.service');
const { createPromptService } = require('../services/prompt.service');

const rootDir = path.join(__dirname, '..');

test('B2C import source no longer contains the fixed station roster', () => {
  const payload = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'data', 'ecoco-knowledge-import.json'), 'utf8')
  );
  const legacySections = payload.sections.filter(section => (
    String(section.category || '').startsWith(LEGACY_STATION_CATEGORY_PREFIX)
  ));
  const stationGuidance = payload.sections.find(section => (
    section.category === LIVE_STATION_GUIDANCE_CATEGORY
  ));

  assert.equal(legacySections.length, 0);
  assert.equal(stationGuidance.content, LIVE_STATION_GUIDANCE_CONTENT);
  assert.doesNotMatch(stationGuidance.content, /台南（126 站）|全家台南大興店/);

  const seed = fs.readFileSync(path.join(rootDir, 'knowledge.js'), 'utf8');
  assert.match(seed, /一律以 Hive 同步至系統的最新站點資料為準/);
  assert.doesNotMatch(seed, /台南（126 站）|全家台南大興店/);
});

test('startup permanently removes legacy station sections and their RAG chunks', async () => {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT id, category/.test(sql)) {
        return {
          rows: [
            { id: 90, category: `${LEGACY_STATION_CATEGORY_PREFIX}臺南` },
            { id: 91, category: `${LEGACY_STATION_CATEGORY_PREFIX}高雄` },
          ],
        };
      }
      if (/DELETE FROM knowledge_chunks/.test(sql)) return { rowCount: 12, rows: [] };
      return { rowCount: 2, rows: [] };
    },
    release() {
      calls.push({ sql: 'release', params: [] });
    },
  };
  const pool = { connect: async () => db };

  const result = await purgeLegacyStationKnowledge(pool);

  assert.deepEqual(result, {
    deletedSections: 2,
    deletedChunks: 12,
    refreshedSectionIds: [],
  });
  assert.ok(calls.some(call => /DELETE FROM knowledge_sections/.test(call.sql)));
  assert.ok(calls.some(call => /knowledge\.legacy_station_purge/.test(call.sql)));
  assert.deepEqual(
    calls.find(call => /SELECT id, category/.test(call.sql)).params,
    [`${LEGACY_STATION_CATEGORY_PREFIX}%`, LIVE_STATION_GUIDANCE_CATEGORY]
  );
  assert.equal(calls.at(-1).sql, 'release');
});

test('startup replaces the old combined station list with Hive-only guidance', async () => {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT id, category/.test(sql)) {
        return {
          rows: [{
            id: 4,
            category: LIVE_STATION_GUIDANCE_CATEGORY,
            content: '台南（126 站）：固定站點清單',
          }],
        };
      }
      if (/DELETE FROM knowledge_chunks/.test(sql)) return { rowCount: 8, rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };

  const result = await purgeLegacyStationKnowledge({ connect: async () => db });

  assert.deepEqual(result, {
    deletedSections: 0,
    deletedChunks: 8,
    refreshedSectionIds: [4],
  });
  const update = calls.find(call => /UPDATE knowledge_sections/.test(call.sql));
  assert.equal(update.params[0], LIVE_STATION_GUIDANCE_CONTENT);
  assert.deepEqual(update.params[2], [4]);
});

test('official B2C terminology is enforced in the model prompt', () => {
  const prompt = createPromptService().buildStaticSystemPrompt();

  assert.match(prompt, /ECOCO 智慧收瓶機/);
  assert.match(prompt, /ECOCO 智慧電池機/);
  assert.match(prompt, /同時泛指兩種設備時，統一稱為「ECOCO 設備」/);
  assert.match(prompt, /只能使用後端提供的 Hive 同步站點資料/);
});

test('web guided menu uses official equipment names and required categories', () => {
  const html = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(rootDir, 'public', 'index.js'), 'utf8');

  assert.match(html, /設備操作問題/);
  assert.match(html, /點數與 App 問題/);
  assert.match(html, /回收物品分類/);
  assert.match(html, /ECOCO 可以回收哪些物品？/);
  assert.match(html, /異常與緊急事件/);
  assert.equal((html.match(/data-locate-request/g) || []).length, 3);
  assert.doesNotMatch(html, /data-question="請幫我查詢附近的 ECOCO 站點"/);
  assert.match(script, /function requestNearestStations\(triggerButton\)/);
  assert.match(script, /querySelectorAll\("\[data-locate-request\]"\)/);
  assert.match(script, /ECOCO 智慧收瓶機/);
  assert.match(script, /ECOCO 智慧電池機/);
});

test('LINE B2C replies include a selectable quick-reply menu', () => {
  const items = buildB2CQuickReplyItems();
  const message = buildLineTextMessage('請選擇問題類別', items);

  assert.equal(items.length, 5);
  assert.equal(message.type, 'text');
  assert.equal(message.quickReply.items.length, 5);
  assert.deepEqual(
    message.quickReply.items.map(item => item.action.label),
    ['智慧收瓶機', '智慧電池機', '點數與 App', '回收物品分類', '站點查詢']
  );
  assert.equal(message.quickReply.items[3].action.text, 'ECOCO 可以回收哪些物品？');
  assert.deepEqual(message.quickReply.items[4].action, {
    type: 'location',
    label: '站點查詢',
  });
});
