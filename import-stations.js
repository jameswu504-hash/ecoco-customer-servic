// 站點資料匯入腳本
// 用法：node import-stations.js stations.csv
//       node import-stations.js stations.xlsx

const fs   = require('fs');
const path = require('path');

const inputFile = process.argv[2];
if (!inputFile) {
  console.log('用法：node import-stations.js <檔案名稱>');
  console.log('支援格式：.csv 或 .xlsx');
  console.log('範本請參考 stations-template.csv');
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`❌ 找不到檔案：${inputFile}`);
  process.exit(1);
}

// ── CSV 解析（不需額外套件）────────────────────────────────
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8').replace(/\r/g, '');
  const lines   = content.split('\n').filter(l => l.trim());
  const headers = splitCSVLine(lines[0]);

  return lines.slice(1)
    .map(line => {
      const values = splitCSVLine(line);
      const row = {};
      headers.forEach((h, i) => row[h] = (values[i] || '').trim());
      return row;
    })
    .filter(row => row['縣市'] && row['站點名稱']);
}

function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += ch;
  }
  result.push(current);
  return result.map(s => s.trim());
}

// ── XLSX 解析（需安裝 xlsx 套件）──────────────────────────
function parseXLSX(filePath) {
  try {
    const XLSX = require('xlsx');
    const wb   = XLSX.readFile(filePath);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws).filter(row => row['縣市'] && row['站點名稱']);
  } catch {
    console.error('❌ 讀取 XLSX 需先安裝套件：npm install xlsx');
    process.exit(1);
  }
}

// ── 讀取檔案 ───────────────────────────────────────────────
const ext = path.extname(inputFile).toLowerCase();
let stations;

if (ext === '.csv') {
  stations = parseCSV(inputFile);
} else if (ext === '.xlsx' || ext === '.xls') {
  stations = parseXLSX(inputFile);
} else {
  console.error('❌ 只支援 .csv 或 .xlsx 格式');
  process.exit(1);
}

if (stations.length === 0) {
  console.error('❌ 沒有讀到任何站點資料，請確認欄位名稱是否正確（縣市、站點名稱、地址、機台類型）');
  process.exit(1);
}

// ── 按縣市分組 ─────────────────────────────────────────────
const byCity = {};
stations.forEach(s => {
  const city = (s['縣市'] || '').trim();
  const name = (s['站點名稱'] || '').trim();
  const addr = (s['地址'] || '').trim();
  const type = (s['機台類型'] || '').trim();
  if (!city || !name) return;
  if (!byCity[city]) byCity[city] = [];
  byCity[city].push({ name, addr, type });
});

const totalCities  = Object.keys(byCity).length;
const totalStations = stations.length;

// ── 生成知識庫文字 ─────────────────────────────────────────
let stationText = `【站點資訊】
全台共 ${totalStations} 個站點，遍佈 ${totalCities} 個縣市。
即時狀態請以 ECOCO App 為準（App 底部「站點」頁面）。

`;

Object.entries(byCity).forEach(([city, list]) => {
  stationText += `${city}（${list.length} 站）：\n`;
  list.forEach(s => {
    stationText += `- ${s.name}`;
    if (s.addr) stationText += `｜${s.addr}`;
    if (s.type) stationText += `｜${s.type}`;
    stationText += '\n';
  });
  stationText += '\n';
});

// ── 更新 knowledge.js ──────────────────────────────────────
const knowledgePath = path.join(__dirname, 'knowledge.js');
let knowledge = fs.readFileSync(knowledgePath, 'utf-8');

const sectionRegex = /【站點[^】]*】[\s\S]*?(?=\n【)/;

if (!sectionRegex.test(knowledge)) {
  console.error('❌ 找不到【站點查詢】或【站點資訊】區塊，請確認 knowledge.js 格式');
  process.exit(1);
}

knowledge = knowledge.replace(sectionRegex, stationText);
fs.writeFileSync(knowledgePath, knowledge, 'utf-8');

// ── 完成報告 ───────────────────────────────────────────────
console.log(`\n✅ 成功匯入 ${totalStations} 個站點！knowledge.js 已更新。`);
console.log(`\n站點分布：`);
Object.entries(byCity).forEach(([city, list]) => {
  console.log(`  ${city.padEnd(6)}：${list.length} 站`);
});
console.log('\n重啟伺服器後生效：npm start');
