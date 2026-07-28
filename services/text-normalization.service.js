function normalizeUnicodeText(value, {
  lowercase = false,
  whitespace = 'collapse',
} = {}) {
  let text = String(value || '')
    .normalize('NFKC')
    .replace(/\p{Extended_Pictographic}/gu, '');

  if (whitespace === 'remove') {
    text = text.replace(/\s+/g, '');
  } else {
    text = text
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  text = text.trim();
  return lowercase ? text.toLowerCase() : text;
}

module.exports = { normalizeUnicodeText };
