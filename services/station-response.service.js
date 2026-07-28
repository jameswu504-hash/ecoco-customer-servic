const { normalizeUnicodeText } = require('./text-normalization.service');

async function attachLiveStationContext({
  rag,
  question,
  classification,
  retrieveLiveStationContext,
  coords = null,
}) {
  if (typeof retrieveLiveStationContext !== 'function') return rag;

  try {
    const live = await retrieveLiveStationContext(question, { classification, coords });
    const hasTrustedMiss = (
      live.retrievalMode === 'postgres_iot_miss'
        && Array.isArray(live.terms)
        && live.terms.length > 0
    ) || (
      live.retrievalMode === 'postgres_iot_nearest_miss'
        && live.coords
    );
    if (!live.context && !hasTrustedMiss) return rag;
    const retrievalModes = [rag.retrievalMode, live.retrievalMode]
      .filter(mode => mode && mode !== 'none');
    return {
      ...rag,
      retrievalMode: retrievalModes.length > 0 ? retrievalModes.join('+') : rag.retrievalMode,
      context: [rag.context, live.context].filter(Boolean).join('\n\n'),
      liveStationContext: live,
    };
  } catch (err) {
    console.error('Live station context lookup error:', err.message);
    return rag;
  }
}

function formatStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (!status) return '未知';
  if (['up', 'online', 'normal', 'ok'].includes(status)) return '正常';
  if (['down', 'offline'].includes(status)) return '離線';
  return String(value);
}

function hasNumber(value) {
  return value !== null && value !== undefined && value !== '';
}

function formatDistance(distanceKm) {
  if (distanceKm === null || distanceKm === undefined || distanceKm === '') return '';
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km < 0) return '';
  if (km < 1) return `（約 ${Math.max(Math.round((km * 1000) / 10) * 10, 10)} 公尺）`;
  return `（約 ${Math.round(km * 10) / 10} 公里）`;
}

function formatCapacity(slotName, count, max, remain) {
  if (!hasNumber(count) && !hasNumber(max) && !hasNumber(remain)) {
    return `${slotName}：目前還沒有容量數字`;
  }

  const remainText = hasNumber(remain) ? `剩餘 ${remain}` : '剩餘量未知';
  const usageText = hasNumber(count) && hasNumber(max) ? `目前 ${count}/${max}` : '';
  const fullHint = hasNumber(remain) && Number(remain) === 0 ? '（目前看起來已滿）' : '';
  return `${slotName}：${[remainText, usageText].filter(Boolean).join('，')}${fullHint}`;
}

function buildLiveStationStatusReply(liveStationContext = null) {
  const rows = Array.isArray(liveStationContext?.rows) ? liveStationContext.rows : [];
  if (rows.length === 0) {
    if (liveStationContext?.retrievalMode === 'postgres_iot_nearest_miss') {
      const label = liveStationContext?.coords?.label || '';
      return [
        label
          ? `可可粉，依目前同步的站點資料，在「${label}」附近沒有查到 ECOCO 站點。`
          : '可可粉，依目前同步的站點資料，在你目前的位置附近沒有查到 ECOCO 站點。',
        '',
        '你可以改傳另一個位置，或先到 ECOCO App 查看完整站點地圖。',
      ].join('\n');
    }
    if (liveStationContext?.retrievalMode !== 'postgres_iot_miss') return '';
    const terms = Array.isArray(liveStationContext?.terms) ? liveStationContext.terms : [];
    const location = terms[0] || '這個地區';
    return [
      '可可粉，我有幫你查詢 ECOCO 站點資料。',
      '',
      `目前在「${location}」沒有查到站點。`,
      '',
      '你可以再告訴我附近的捷運站、路名或地標，我再幫你查查看。',
    ].join('\n');
  }

  const uniqueRows = [];
  const seenStations = new Set();
  for (const row of rows) {
    const fallbackKey = [row.stationName, row.address].filter(Boolean).join('|');
    const key = String(row.stationCode || fallbackKey).trim();
    if (key && seenStations.has(key)) continue;
    if (key) seenStations.add(key);
    uniqueRows.push(row);
  }

  const displayedRows = uniqueRows.slice(0, 3);
  const isNearestQuery = liveStationContext?.retrievalMode === 'postgres_iot_nearest';
  if (isNearestQuery) {
    const label = liveStationContext?.coords?.label || '';
    const lines = [
      label
        ? `可可粉，離「${label}」最近的 ECOCO 站點是：`
        : '可可粉，離你最近的 ECOCO 站點是：',
    ];
    displayedRows.forEach((row, index) => {
      const name = row.stationName || row.stationCode || `站點 ${index + 1}`;
      lines.push(
        '',
        `${index + 1}. ${name}${formatDistance(row.distanceKm)}`,
        `地址：${row.address || '未知'}`
      );
      if (liveStationContext?.isStale !== true) {
        lines.push(`目前狀態：機台${formatStatus(row.machineStatus || row.stationStatus)}、連線${formatStatus(row.lastConnectionStatus)}`);
      }
    });
    if (liveStationContext?.isStale === true) {
      lines.push('', '站點資料目前沒有在預期時間內更新，所以我暫時不能確認最新的機台狀態或回收槽容量，建議出發前先查看 ECOCO App。');
    } else {
      lines.push('', '如果你到現場看到的狀態和這裡不一樣，可以透過 App 或客服表單回報，我們會協助確認。');
    }
    return lines.join('\n');
  }

  const matchedStationCount = Number(liveStationContext?.matchedStationCount);
  if (liveStationContext?.queryIntent?.asksCount && Number.isFinite(matchedStationCount)) {
    const terms = Array.isArray(liveStationContext?.terms) ? liveStationContext.terms : [];
    const location = terms[0] || '這個地區';
    const lines = [
      '可可粉，我有幫你查詢 ECOCO 站點資料。',
      '',
      `依目前同步到的站點資料，「${location}」共有 ${matchedStationCount} 個 ECOCO 站點。`,
    ];

    if (displayedRows.length > 0) {
      lines.push('', '其中包含：');
      displayedRows.forEach((row, index) => {
        const name = row.stationName || row.stationCode || `站點 ${index + 1}`;
        lines.push(
          `${index + 1}. ${name}`,
          `地址：${row.address || '未提供'}`
        );
      });
    }

    if (liveStationContext?.isStale === true) {
      lines.push(
        '',
        '站點資料目前沒有在預期時間內更新，數量可能不是最新狀態。'
      );
    }
    return lines.join('\n');
  }

  if (liveStationContext?.isStale === true) {
    const lines = [
      '可可粉，站點資料目前沒有在預期時間內更新，所以我暫時不能確認最新的機台狀態或回收槽容量。',
      '',
      '目前可以確認的站點位置：',
    ];
    displayedRows.forEach((row, index) => {
      const name = row.stationName || row.stationCode || `站點 ${index + 1}`;
      lines.push(
        displayedRows.length > 1 ? `${index + 1}. ${name}` : name,
        `地址：${row.address || '未知'}`
      );
    });
    lines.push('', '建議出發前先查看 ECOCO App；若現場有異常，也可以透過客服表單回報，我們會協助確認。');
    return lines.join('\n');
  }

  const lines = displayedRows.length > 1
    ? ['可可粉，幫你找到幾個可能適合的 ECOCO 站點囉：']
    : ['可可粉，幫你查到這個站點目前的狀況囉：'];
  displayedRows.forEach((row, index) => {
    const name = row.stationName || row.stationCode || `站點 ${index + 1}`;
    lines.push(
      '',
      displayedRows.length > 1 ? `${index + 1}. ${name}` : name,
      `地址：${row.address || '未知'}`,
      '',
      '目前狀態',
      `機台：${formatStatus(row.machineStatus || row.stationStatus)}`,
      `連線：${formatStatus(row.lastConnectionStatus)}`,
      '',
      '回收槽容量',
      formatCapacity('第 1 槽', row.bin1Count, row.bin1MaxCapacity, row.bin1RemainCapacity),
      formatCapacity('第 2 槽', row.bin2Count, row.bin2MaxCapacity, row.bin2RemainCapacity),
    );
  });

  lines.push('', '如果你到現場看到的狀態和這裡不一樣，可以直接透過 App 或客服表單回報，我們會協助確認。');
  return lines.join('\n');
}

function shouldUseDeterministicStationReply(question, classification = null, liveStationContext = null) {
  const rows = Array.isArray(liveStationContext?.rows) ? liveStationContext.rows : [];
  if (liveStationContext?.retrievalMode === 'postgres_iot_nearest' && rows.length > 0) {
    return true;
  }
  if (liveStationContext?.retrievalMode === 'postgres_iot_nearest_miss') {
    return true;
  }
  if (classification?.category !== 'station_machine') return false;
  if (liveStationContext?.queryIntent?.isHowTo === true) return false;
  if (rows.length === 0) {
    return liveStationContext?.retrievalMode === 'postgres_iot_miss'
      && liveStationContext?.queryIntent?.hasLocationTerms === true
      && Array.isArray(liveStationContext?.terms)
      && liveStationContext.terms.length > 0;
  }

  const text = normalizeUnicodeText(question, {
    lowercase: true,
    whitespace: 'remove',
  });
  const asksItemRule = /(可以投|能不能投|可不可以投|可以回收|能回收|收不收|能不能收)/.test(text)
    && /(牛奶瓶|鮮奶瓶|奶瓶|紙盒|鋁箔包|玻璃|紙杯|塑膠袋|便當盒)/.test(text);

  return !asksItemRule;
}

module.exports = {
  attachLiveStationContext,
  buildLiveStationStatusReply,
  formatCapacity,
  formatDistance,
  formatStatus,
  shouldUseDeterministicStationReply,
};
