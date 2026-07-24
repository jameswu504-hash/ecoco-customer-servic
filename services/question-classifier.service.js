const DEFAULT_CONTACT_URL = 'https://ecoco.tw/kWqgW';

function normalizeQuestionText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .trim();
}

function hasAny(text, keywords = []) {
  return keywords.some(keyword => text.includes(normalizeQuestionText(keyword)));
}

function buildDirectReply(message, nextStep) {
  return `${message}\n\n${nextStep}：${DEFAULT_CONTACT_URL}`;
}

const QUESTION_CATEGORIES = [
  {
    category: 'points',
    label: '點數 / 回收回饋',
    keywords: ['點數', '點', '回饋', '沒收到', '未入帳', '補點', '兌換', '投遞紀錄', '序號', '集點'],
    ragScope: ['點數', '回饋', '兌換', '優惠券', '投遞'],
  },
  {
    category: 'recycling_rules',
    label: '回收規則 / 品項',
    keywords: ['回收', '品項', '寶特瓶', '塑膠', '鋁罐', '鐵罐', '清洗', '分類', '可不可以收', '不收'],
    ragScope: ['回收規則', '品項', '回收物', '清洗', '正面回饋'],
  },
  {
    category: 'station_machine',
    label: '站點 / 機台',
    keywords: ['站點', '機台', '機器', '滿倉', '故障', '維修', '清潔', '地圖', '位置', '營業時間', '無法投'],
    ragScope: ['站點', '機台', '設備', '滿倉', '清潔', '維修', '狀態', '地圖'],
  },
  {
    category: 'app_account',
    label: 'APP / 帳號',
    keywords: ['app', '帳號', '登入', '註冊', '密碼', 'otp', '手機', '驗證碼', '會員', '無法登入', '忘記密碼'],
    ragScope: ['APP', '帳號', '登入', '註冊', '密碼', 'OTP', '會員'],
  },
  {
    category: 'merchant_coupon',
    label: '公益商家 / 優惠券',
    keywords: ['公益商家', '合作商家', '優惠券', '折價券', '商家', '店家', '兌換規則', '克朗', '台塑'],
    ragScope: ['公益商家', '商家', '優惠券', '兌換', '合作', '台塑'],
  },
  {
    category: 'customer_service',
    label: '人工客服 / 個案處理',
    keywords: ['客服', '真人', '人工', '申訴', '查詢個案', '我的帳號', '幫我查', '退款', '退費', '個資', '刪除帳號'],
    ragScope: ['客服', '顧客關係', '客服管道', '服務中斷'],
    shouldUseRag: false,
    shouldEscalate: true,
    directReply: buildDirectReply(
      '這個狀況可能需要確認您的會員紀錄或投遞資料，AI 無法直接查詢個案。',
      '請透過客服表單提供會員帳號、投遞站點、投遞時間與相關截圖，客服人員會協助確認'
    ),
  },
  {
    category: 'small_talk',
    label: '招呼 / 測試',
    keywords: ['hi', 'hello', '哈囉', '你好', '測試', 'test'],
    ragScope: [],
    shouldUseRag: false,
    directReply: '你好，我是 ECOCO AI 客服，可以協助回收規則、點數、APP 帳號、站點機台與優惠券相關問題。',
  },
];

const HIGH_RISK_KEYWORDS = [
  '法律',
  '報警',
  '個資外洩',
  '信用卡',
  '付款',
  '金流',
  '退款',
  '退費',
  '盜用',
  '詐騙',
  '帳號被盜',
  '刪除個資',
];

function confidenceFor(text, category) {
  const hits = category.keywords.filter(keyword => text.includes(normalizeQuestionText(keyword))).length;
  if (hits >= 2) return 'high';
  return hits === 1 ? 'medium' : 'low';
}

function getCategory(categoryName) {
  return QUESTION_CATEGORIES.find(category => category.category === categoryName);
}

function isStationLookupIntent(text) {
  return (
    /(站點|機台|機器|地圖|營業時間)/.test(text)
    || /站.*(在哪|哪裡|哪裏|位置|地址|怎麼去|如何去)/.test(text)
    || /(在哪|哪裡|哪裏|位置|地址|怎麼去|如何去).*站/.test(text)
  );
}

function classifyQuestion(question) {
  const text = normalizeQuestionText(question);
  if (!text) {
    return {
      category: 'unknown',
      label: '無法判斷',
      confidence: 'low',
      ragScope: [],
      shouldUseRag: true,
      shouldEscalate: false,
      reason: 'empty question',
    };
  }

  if (/es\d{3,6}(?:_[a-z0-9]+)?/i.test(text)) {
    const station = getCategory('station_machine');
    return {
      category: station.category,
      label: station.label,
      confidence: 'high',
      ragScope: station.ragScope,
      shouldUseRag: true,
      shouldEscalate: false,
      reason: 'matched station code',
      directReply: '',
    };
  }

  if (hasAny(text, HIGH_RISK_KEYWORDS)) {
    return {
      category: 'high_risk',
      label: '高風險 / 需人工確認',
      confidence: 'high',
      ragScope: ['客服', '顧客關係', '客服管道'],
      shouldUseRag: false,
      shouldEscalate: true,
      reason: 'matched high-risk keyword',
      directReply: buildDirectReply(
        '這個問題需要客服人員協助確認，AI 無法直接查詢會員資料或承諾處理結果。',
        '請透過客服表單提供問題時間、會員帳號或註冊手機、相關截圖，我們會由客服人員協助確認'
      ),
    };
  }

  if (isStationLookupIntent(text)) {
    const station = getCategory('station_machine');
    return {
      category: station.category,
      label: station.label,
      confidence: 'medium',
      ragScope: station.ragScope,
      shouldUseRag: true,
      shouldEscalate: false,
      reason: 'matched station lookup intent',
      directReply: '',
    };
  }

  const matched = QUESTION_CATEGORIES.find(category => hasAny(text, category.keywords));
  if (matched) {
    return {
      category: matched.category,
      label: matched.label,
      confidence: confidenceFor(text, matched),
      ragScope: matched.ragScope,
      shouldUseRag: matched.shouldUseRag !== false,
      shouldEscalate: Boolean(matched.shouldEscalate),
      reason: 'matched keyword rule',
      directReply: matched.directReply || '',
    };
  }

  return {
    category: 'unknown',
    label: '無法判斷',
    confidence: 'low',
    ragScope: [],
    shouldUseRag: true,
    shouldEscalate: false,
    reason: 'no keyword rule matched',
  };
}

module.exports = {
  QUESTION_CATEGORIES,
  classifyQuestion,
  normalizeQuestionText,
};
