// 從 ecoco-stations.kml 解析站點資料並更新 knowledge.js
const fs   = require('fs');
const path = require('path');

const kmlPath       = path.join(__dirname, 'ecoco-stations.kml');
const knowledgePath = path.join(__dirname, 'knowledge.js');

if (!fs.existsSync(kmlPath)) {
  console.error('❌ 找不到 ecoco-stations.kml，請先確認檔案存在');
  process.exit(1);
}

const kml = fs.readFileSync(kmlPath, 'utf-8');

// ── 解析所有 Placemark ────────────────────────────────────
const placemarks = [...kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)];

const CITY_KEYWORDS = [
  { city: '台南', patterns: ['台南', '臺南', '崑山科技', '成功大學', '長榮大學',
      '仁德', '新化', '安中', '文賢', '崇善', '北安', '安南', '佳里', '新仁',
      '崇學', '湖內', '永大', '吹吹風', '健美洋行', '輕鬆購', '七陶', '北海道生鮮',
      '幫純好茶', '成功店', '善化', '麻豆', '永康', '新營', '六甲', '歸仁',
      '學甲', '西港', '裕農'] },
  { city: '新北', patterns: ['新北', '板橋', '三重', '中和', '蘆洲', '新莊', '永和',
      '汐止', '深坑', '八里', '淡水', '新店', '土城', '樹林', '鶯歌', '三峽', '南雅'] },
  { city: '台北', patterns: ['台北', '臺北', '信義', '大安', '中山', '松山', '內湖',
      '南港', '文山', '北投', '士林', '萬華', '中正', '大同'] },
  { city: '桃園', patterns: ['桃園', '中壢', '平鎮', '龜山', '八德', '楊梅', '蘆竹', '內壢', '中原'] },
  { city: '台中', patterns: ['台中', '臺中', '逢甲', '西屯', '北屯', '南屯', '豐原',
      '大里', '太平', '烏日', '中清', '縣政', '大雅', '沙鹿'] },
  { city: '高雄', patterns: ['高雄', '鳳山', '左營', '三民', '苓雅', '前鎮', '小港',
      '楠梓', '五甲', '右昌', '仁武', '九如', '瑞豐', '大昌', '岡山', '旗山',
      '鳥松', '大樹', '鼓山', '橋頭', '前金', '大順', '高明貨櫃', '新楠', '中工'] },
  { city: '新竹', patterns: ['新竹', '竹北', '竹東', '大庄', '芎林'] },
  { city: '彰化', patterns: ['彰化', '員林', '鹿港', '溪湖', '和美'] },
  { city: '嘉義', patterns: ['嘉義', '大林', '民雄', '水上'] },
  { city: '屏東', patterns: ['屏東', '新屏'] },
  { city: '花蓮', patterns: ['花蓮', 'DAKA', '台泥', '鳳林'] },
  { city: '台東', patterns: ['台東', '臺東'] },
  { city: '澎湖', patterns: ['澎湖', '馬公', '觀音亭', '白沙', '赤嵌', '南海交通', '澎坊'] },
  { city: '苗栗', patterns: ['苗栗'] },
  { city: '雲林', patterns: ['雲林', '斗六'] },
  { city: '宜蘭', patterns: ['宜蘭'] },
  { city: '基隆', patterns: ['基隆'] },
];

function detectCity(name) {
  for (const { city, patterns } of CITY_KEYWORDS) {
    if (patterns.some(p => name.includes(p))) return city;
  }
  return '其他';
}

// ── 過濾 + 分組 ───────────────────────────────────────────
const byCity = {};
let skipped = 0;

for (const match of placemarks) {
  const block = match[1];

  const nameMatch = block.match(/<name>([\s\S]*?)<\/name>/);
  const descMatch = block.match(/<description>([\s\S]*?)<\/description>/);
  if (!nameMatch) continue;

  const rawName = nameMatch[1].trim();
  const desc    = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

  // 跳過暫停或結束的站點
  if (rawName.startsWith('暫停服務') || rawName.startsWith('合作完畢')) {
    skipped++;
    continue;
  }

  // 清理站點名稱
  const name = rawName.replace('[ECOCO] ', '').replace('站', '').trim();
  const city = detectCity(rawName);

  if (!byCity[city]) byCity[city] = [];
  byCity[city].push({ name, desc });
}

// ── 生成知識庫文字 ────────────────────────────────────────
const totalStations = Object.values(byCity).reduce((s, v) => s + v.length, 0);
const totalCities   = Object.keys(byCity).filter(c => c !== '其他').length;

let stationText = `【站點資訊】
全台共 ${totalStations} 個站點，遍佈 ${totalCities} 個縣市（以下為 2022 年資料，即時狀態請以 ECOCO App 為準）。
查詢方式：App 底部「站點」頁面 → 選縣市篩選。

`;

// 依縣市排序輸出
const CITY_ORDER = ['台南','新北','台北','桃園','台中','高雄','新竹','彰化','嘉義','屏東','花蓮','台東','澎湖','苗栗','雲林','宜蘭','基隆','其他'];

for (const city of CITY_ORDER) {
  if (!byCity[city] || byCity[city].length === 0) continue;
  const list = byCity[city];
  stationText += `${city}（${list.length} 站）：\n`;
  list.forEach(s => {
    stationText += `- ${s.name}`;
    if (s.desc) stationText += `（${s.desc}）`;
    stationText += '\n';
  });
  stationText += '\n';
}

// ── 更新 knowledge.js ─────────────────────────────────────
let knowledge = fs.readFileSync(knowledgePath, 'utf-8');

const sectionRegex = /【站點[^】]*】[\s\S]*?(?=\n【)/;
if (!sectionRegex.test(knowledge)) {
  console.error('❌ 找不到【站點查詢】區塊，請確認 knowledge.js 格式');
  process.exit(1);
}

knowledge = knowledge.replace(sectionRegex, stationText);
fs.writeFileSync(knowledgePath, knowledge, 'utf-8');

// ── 結果報告 ──────────────────────────────────────────────
console.log(`\n✅ 成功匯入 ${totalStations} 個站點！knowledge.js 已更新。`);
console.log(`（已略過 ${skipped} 個暫停/合作完畢的站點）\n`);
console.log('各縣市站點數：');
for (const city of CITY_ORDER) {
  if (byCity[city]?.length) {
    console.log(`  ${city.padEnd(4)}：${byCity[city].length} 站`);
  }
}
console.log('\n重啟伺服器後生效：npm start');
