// 知識庫內容解析器：以「### 」開頭的行切割為題目區塊。
// 保證 round-trip：assembleKbContent(parseKbContent(x)) === x（任意輸入）。
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KbParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const HEADING_RE = /^###\s/;

  function parseKbContent(content) {
    const text = String(content ?? '');
    const lines = text.split(/(?<=\n)/);
    const preambleLines = [];
    const items = [];
    let current = null;
    for (const line of lines) {
      if (HEADING_RE.test(line)) {
        if (current) items.push(current);
        current = { heading: line.replace(/^###\s+/, '').replace(/\r?\n$/, ''), raw: line };
      } else if (current) {
        current.raw += line;
      } else {
        preambleLines.push(line);
      }
    }
    if (current) items.push(current);
    return { preamble: preambleLines.join(''), items };
  }

  function assembleKbContent(parsed) {
    return (parsed.preamble || '') + parsed.items.map(item => item.raw).join('');
  }

  return { parseKbContent, assembleKbContent };
});
