const STATION_CODE_PATTERN = /es\d{3,6}(?:_[a-z0-9]+)?/i;

function normalizeStationQueryText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .trim();
}

function hasAny(text, words = []) {
  return words.some(word => text.includes(word.toLowerCase()));
}

const NEARBY_WORDS = [
  '\u9644\u8fd1',
  '\u5468\u908a',
  '\u5468\u8fb9',
  '\u5468\u906d',
  '\u9130\u8fd1',
  '\u90bb\u8fd1',
  '\u6700\u8fd1',
  '\u54ea\u88e1',
  '\u54ea\u88cf',
  '\u54ea\u908a',
  '\u54ea\u91cc',
  '\u5728\u54ea',
];

const LOCATION_ASK_WORDS = [
  '\u67e5\u8a62',
  '\u67e5\u8be2',
  '\u641c\u5c0b',
  '\u641c\u7d22',
  '\u627e',
  '\u5730\u5740',
  '\u4f4d\u7f6e',
  '\u5730\u5716',
  '\u5730\u56fe',
  '\u71df\u696d\u6642\u9593',
  '\u8425\u4e1a\u65f6\u95f4',
  '\u600e\u9ebc\u53bb',
  '\u600e\u4e48\u53bb',
  '\u5982\u4f55\u53bb',
  '\u8def\u7dda',
  '\u8def\u7ebf',
  '\u63a8\u85a6',
  '\u63a8\u8350',
];

const STATION_RESOURCE_WORDS = [
  'ecoco',
  '\u7ad9\u9ede',
  '\u7ad9\u70b9',
  '\u7ad9',
  '\u64da\u9ede',
  '\u636e\u70b9',
  '\u6a5f\u53f0',
  '\u673a\u53f0',
  '\u6a5f\u5668',
  '\u673a\u5668',
  '\u56de\u6536\u6a5f',
  '\u56de\u6536\u673a',
  '\u56de\u6536\u9ede',
  '\u56de\u6536\u70b9',
];

const RECYCLE_PLACE_WORDS = [
  '\u56de\u6536',
  '\u6295\u74f6',
  '\u6295\u905e',
  '\u6295\u9012',
  '\u5bf6\u7279\u74f6',
  '\u5b9d\u7279\u74f6',
  '\u94dd\u7f50',
  '\u92c1\u7f50',
];

const NON_STATION_ENTITY_WORDS = [
  '\u9ede\u6578',
  '\u70b9\u6570',
  '\u6703\u54e1',
  '\u4f1a\u5458',
  '\u5e33\u865f',
  '\u8d26\u53f7',
  '\u767c\u7968',
  '\u53d1\u7968',
  '\u512a\u60e0\u5238',
  '\u4f18\u60e0\u5238',
  '\u5ba2\u670d',
  '\u54c1\u9805',
  '\u54c1\u9879',
  '\u5bf6\u7279\u74f6',
  '\u5b9d\u7279\u74f6',
  '\u92c1\u7f50',
  '\u94dd\u7f50',
];

const LIVE_STATUS_WORDS = [
  '\u72c0\u614b',
  '\u72b6\u6001',
  '\u5bb9\u91cf',
  '\u5269\u9918',
  '\u5269\u4f59',
  '\u6eff\u888b',
  '\u6ee1\u888b',
  '\u6eff\u5009',
  '\u6ee1\u4ed3',
  '\u6545\u969c',
  '\u7dad\u4fee',
  '\u7ef4\u4fee',
  '\u6b63\u5e38',
  '\u96e2\u7dda',
  '\u79bb\u7ebf',
  '\u53ef\u7528',
  '\u80fd\u4e0d\u80fd\u7528',
  '\u9084\u80fd\u6295',
  '\u8fd8\u80fd\u6295',
  '\u53ef\u4ee5\u6295',
  'online',
  'offline',
  'asset',
];

const COMMON_QUERY_WORDS = [
  '\u8acb\u554f',
  '\u8bf7\u95ee',
  '\u60f3\u554f',
  '\u67e5\u8a62',
  '\u67e5\u8be2',
  '\u73fe\u5728',
  '\u73b0\u5728',
  '\u76ee\u524d',
  '\u53ef\u4ee5',
  '\u53ef\u4e0d\u53ef\u4ee5',
  '\u80fd\u4e0d\u80fd',
  '\u662f\u5426',
  '\u600e\u9ebc',
  '\u600e\u4e48',
  '\u5982\u4f55',
  '\u54ea\u88e1',
  '\u54ea\u88cf',
  '\u54ea\u91cc',
  '\u54ea\u908a',
  '\u5728\u54ea',
  '\u5730\u5740',
  '\u4f4d\u7f6e',
  '\u71df\u696d\u6642\u9593',
  '\u8425\u4e1a\u65f6\u95f4',
  '\u72c0\u614b',
  '\u72b6\u6001',
  '\u5bb9\u91cf',
  '\u5269\u9918',
  '\u5269\u4f59',
  '\u6eff\u888b',
  '\u6ee1\u888b',
  '\u6a5f\u53f0',
  '\u673a\u53f0',
  '\u6a5f\u5668',
  '\u673a\u5668',
  '\u56de\u6536\u6a5f',
  '\u56de\u6536\u673a',
  '\u56de\u6536',
  '\u6295\u905e',
  '\u6295\u9012',
  '\u6295\u74f6',
  '\u6eff\u5009',
  '\u6ee1\u4ed3',
  '\u6545\u969c',
  '\u7dad\u4fee',
  '\u7ef4\u4fee',
  '\u6b63\u5e38',
  '\u4f7f\u7528',
  '\u9644\u8fd1',
  '\u5468\u908a',
  '\u5468\u8fb9',
  '\u5468\u906d',
  '\u9130\u8fd1',
  '\u90bb\u8fd1',
  '\u6700\u8fd1',
  '\u63a8\u85a6',
  '\u63a8\u8350',
  '\u8def\u7dda',
  '\u8def\u7ebf',
  '\u5730\u5716',
  '\u5730\u56fe',
  'ecoco',
  '\u55ce',
  '\u5462',
  '\u7684',
  '\u6709\u6c92\u6709',
  '\u6709\u6ca1\u6709',
  '\u6709\u55ce',
  '\u6709',
];

const LANDMARK_ALIASES = [
  {
    match: ['\u6210\u5927', '\u6210\u529f\u5927\u5b78', '\u6210\u529f\u5927\u5b66', '\u570b\u7acb\u6210\u529f\u5927\u5b78', '\u56fd\u7acb\u6210\u529f\u5927\u5b66'],
    terms: ['\u6210\u5927', '\u6210\u529f\u5927\u5b78', '\u570b\u7acb\u6210\u529f\u5927\u5b78', '\u5927\u5b78\u8def', '\u52dd\u5229\u8def', '\u6771\u5340'],
  },
  {
    match: ['\u81fa\u5357\u6771\u5340', '\u53f0\u5357\u6771\u5340', '\u6771\u5340'],
    terms: ['\u81fa\u5357\u6771\u5340', '\u53f0\u5357\u6771\u5340', '\u6771\u5340'],
  },
];

const CITY_PREFIXES = [
  '\u81fa\u5317',
  '\u53f0\u5317',
  '\u65b0\u5317',
  '\u6843\u5712',
  '\u81fa\u4e2d',
  '\u53f0\u4e2d',
  '\u81fa\u5357',
  '\u53f0\u5357',
  '\u9ad8\u96c4',
  '\u57fa\u9686',
  '\u65b0\u7af9',
  '\u82d7\u6817',
  '\u5f70\u5316',
  '\u5357\u6295',
  '\u96f2\u6797',
  '\u5609\u7fa9',
  '\u5c4f\u6771',
  '\u5b9c\u862d',
  '\u82b1\u84ee',
  '\u81fa\u6771',
  '\u53f0\u6771',
  '\u6f8e\u6e56',
  '\u91d1\u9580',
  '\u9023\u6c5f',
];

function getLocationAliasTerms(text) {
  const terms = [];
  for (const alias of LANDMARK_ALIASES) {
    if (alias.match.some(term => text.includes(term.toLowerCase()))) {
      terms.push(...alias.terms);
    }
  }
  return [...new Set(terms)];
}

function isStationDataQuestion(question) {
  const text = normalizeStationQueryText(question);
  if (!text) return false;
  if (STATION_CODE_PATTERN.test(text)) return true;

  const hasStationResource = hasAny(text, STATION_RESOURCE_WORDS);
  const hasRecyclePlace = hasAny(text, RECYCLE_PLACE_WORDS);
  const hasLiveStatus = hasAny(text, LIVE_STATUS_WORDS);
  const hasNearby = hasAny(text, NEARBY_WORDS);
  const asksLocation = hasAny(text, LOCATION_ASK_WORDS);
  const hasKnownLocation = getLocationAliasTerms(text).length > 0;
  const hasLikelyEntity = hasLikelyStationEntity(text);

  if (hasStationResource && (hasLiveStatus || hasNearby || asksLocation || hasKnownLocation)) return true;
  if (hasLiveStatus && hasLikelyEntity) return true;
  if (hasKnownLocation && (hasNearby || asksLocation) && (hasStationResource || hasRecyclePlace)) return true;
  if ((hasNearby || asksLocation) && hasRecyclePlace && hasKnownLocation) return true;

  return false;
}

function hasLikelyStationEntity(text) {
  if (getLocationAliasTerms(text).length > 0) return true;
  if (/[\u4e00-\u9fffA-Za-z0-9]{2,40}\u7ad9/.test(text)) return true;

  let candidate = stripCommonStationWords(text);
  for (const word of NON_STATION_ENTITY_WORDS) {
    candidate = candidate.replaceAll(word, '');
  }

  return candidate.length >= 3 && /[\u4e00-\u9fff]/.test(candidate);
}

function stripCommonStationWords(value) {
  let text = String(value || '');
  for (const word of COMMON_QUERY_WORDS) {
    text = text.replaceAll(word, '');
  }
  return text.trim();
}

function addTerm(terms, value) {
  const term = stripCommonStationWords(normalizeStationQueryText(value));
  if (term.length >= 2 && term.length <= 40) terms.add(term);
}

function buildStationSearchTerms(question) {
  const text = normalizeStationQueryText(question);
  const terms = new Set();

  for (const match of text.matchAll(/es\d{3,6}(?:_[a-z0-9]+)?/gi)) addTerm(terms, match[0]);
  for (const match of text.matchAll(/\b\d{8,22}\b/g)) addTerm(terms, match[0]);
  getLocationAliasTerms(text).forEach(term => addTerm(terms, term));

  for (const match of text.matchAll(/[\u4e00-\u9fffA-Za-z0-9]{2,40}\u7ad9/g)) {
    const stationName = match[0];
    addTerm(terms, stationName);
    if (stationName.length > 2) addTerm(terms, stationName.slice(0, -1));
    for (const city of CITY_PREFIXES) {
      if (stationName.startsWith(city) && stationName.length > city.length + 1) {
        const withoutCity = stationName.slice(city.length);
        addTerm(terms, withoutCity);
        if (withoutCity.endsWith('\u7ad9')) addTerm(terms, withoutCity.slice(0, -1));
      }
    }
  }

  text
    .split(/[^0-9A-Za-z\u4e00-\u9fff]+/g)
    .map(stripCommonStationWords)
    .filter(term => term.length >= 2 && term.length <= 24)
    .forEach(term => addTerm(terms, term));

  return [...terms].slice(0, 8);
}

module.exports = {
  buildStationSearchTerms,
  getLocationAliasTerms,
  hasLikelyStationEntity,
  isStationDataQuestion,
  normalizeStationQueryText,
  stripCommonStationWords,
};
