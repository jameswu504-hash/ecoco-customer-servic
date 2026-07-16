const test = require('node:test');
const assert = require('node:assert/strict');

const { parseKbContent, assembleKbContent } = require('../public/kb-parser.js');

const cases = [
  '',
  '沒有任何標題的自由文字\n第二行',
  '### 只有一題\n內容 A\n',
  '前言兩行\n第二行\n### 題一\n內文\n\n### 題二\n- 清單\n#### 子標題不切\n',
  '### 題一\r\nCRLF 內容\r\n### 題二\r\n',
  '### 尾題無換行',
  '###沒有空格不是標題\n### 有空格才是\n內容',
];

for (const [i, input] of cases.entries()) {
  test(`kb-parser round-trip case ${i}`, () => {
    assert.equal(assembleKbContent(parseKbContent(input)), input);
  });
}

test('kb-parser returns item count and headings', () => {
  const parsed = parseKbContent('前言\n### A 題\n1\n### B 題\n2\n');
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].heading, 'A 題');
  assert.equal(parsed.preamble, '前言\n');
});
