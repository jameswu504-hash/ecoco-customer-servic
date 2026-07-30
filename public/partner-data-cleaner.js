(function initPartnerDataCleaner(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.EcocoPartnerDataCleaner = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const SKILL_NAME = 'ecoco-clean-brand-knowledge';
  const SKILL_VERSION = '1.0.0';
  const MAX_SOURCE_CHARACTERS = 500_000;
  const MAX_SECTION_CHARACTERS = 6_000;
  const MAX_CHUNK_CHARACTERS = 1_800;
  const LINE_DATE_PATTERN = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:（[^）]*）)?\s*$/;
  const LINE_MESSAGE_PATTERN = /^\d{1,2}:\d{2}\t[^\t]+\t/;
  const LINE_ATTACHMENT_PATTERN =
    /^\d{1,2}:\d{2}\t[^\t]+\t\[(?:照片|貼圖|檔案|影片|語音訊息)\]\s*$/;

  function normalizeText(value) {
    return String(value || '')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .trim();
  }

  function normalizeFilename(value) {
    return String(value || '')
      .split(/[\\/]/)
      .pop()
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
  }

  function stripExtension(value) {
    return normalizeFilename(value).replace(/\.(?:txt|md|markdown)$/i, '');
  }

  function detectSourceType(sourceName) {
    const filename = normalizeFilename(sourceName).toLowerCase();
    if (filename.endsWith('.txt')) return 'line_txt';
    if (filename.endsWith('.md') || filename.endsWith('.markdown')) return 'markdown';
    throw new Error('第一版只支援 LINE TXT 與 Markdown（.txt、.md）檔案。');
  }

  function normalizeCompany(company = {}) {
    const id = Number(company.id);
    const name = String(company.name || '').trim();
    if (!Number.isInteger(id) || id <= 0 || !name) {
      throw new Error('必須先選擇有效的合作公司。');
    }
    return {
      id,
      name: name.slice(0, 160),
      slug: String(company.slug || '').trim().slice(0, 80),
    };
  }

  async function sha256Hex(value) {
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.subtle) throw new Error('目前瀏覽器不支援本機 SHA-256。');
    const bytes = new TextEncoder().encode(String(value || ''));
    const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  function splitByLimit(value, maxCharacters) {
    const parts = [];
    let remaining = String(value || '').trim();
    while (remaining.length > maxCharacters) {
      const candidates = [
        remaining.lastIndexOf('\n\n', maxCharacters),
        remaining.lastIndexOf('\n', maxCharacters),
        remaining.lastIndexOf('。', maxCharacters),
      ];
      let cutAt = Math.max(...candidates);
      if (cutAt < Math.floor(maxCharacters * 0.45)) cutAt = maxCharacters;
      if (remaining[cutAt] === '。') cutAt += 1;
      const part = remaining.slice(0, cutAt).trim();
      if (part) parts.push(part);
      remaining = remaining.slice(cutAt).trim();
    }
    if (remaining) parts.push(remaining);
    return parts;
  }

  function parseLineDate(line) {
    const match = String(line || '').trim().match(LINE_DATE_PATTERN);
    if (!match) return null;
    return {
      display: `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`,
      raw: String(line).trim(),
    };
  }

  function cleanLineLines(content) {
    const lines = [];
    let ignoredAttachmentCount = 0;
    let previousBlank = false;
    for (const rawLine of content.split('\n')) {
      const line = rawLine.replace(/[ \t]+$/g, '');
      if (/^\[LINE\].*聊天記錄\s*$/.test(line) || /^儲存日期[:：]/.test(line)) continue;
      if (LINE_ATTACHMENT_PATTERN.test(line)) {
        ignoredAttachmentCount += 1;
        continue;
      }
      const isBlank = !line.trim();
      if (isBlank && previousBlank) continue;
      lines.push(line);
      previousBlank = isBlank;
    }
    return { lines, ignoredAttachmentCount };
  }

  function parseLineSections({ company, sourceName, content }) {
    const { lines, ignoredAttachmentCount } = cleanLineLines(content);
    const blocks = [];
    let currentDate = null;
    let currentLines = [];
    const flush = () => {
      const body = currentLines.join('\n').trim();
      if (body) blocks.push({ date: currentDate, body });
      currentLines = [];
    };

    for (const line of lines) {
      const parsedDate = parseLineDate(line);
      if (parsedDate) {
        flush();
        currentDate = parsedDate;
      } else {
        currentLines.push(line);
      }
    }
    flush();

    if (blocks.length === 0) throw new Error('TXT 檔案沒有可使用的 LINE 對話內容。');

    const sourceLabel = stripExtension(sourceName)
      .replace(/^\[LINE\]\s*/i, '')
      .trim() || 'LINE 聊天紀錄';
    const guidance = [
      `[所屬公司] ${company.name}`,
      `[匯入來源] ${sourceName}`,
      '[資料性質] 品牌方 LINE 歷史對話；日期、發言者、聯絡資訊與原始說法均保留。',
      '[使用規則] 回答時較新且已確認的紀錄優先；歷史討論不可直接改寫為目前承諾。',
      '[隱私規則] 僅限目前公司的授權 B2B 群組與管理後台使用，不得進入公開 B2C 回答。',
    ].join('\n');
    const sections = [];
    for (const block of blocks) {
      const date = block.date?.display || '未標日期';
      const pieces = splitByLimit(block.body, MAX_SECTION_CHARACTERS - guidance.length - 120);
      pieces.forEach((piece, pieceIndex) => {
        const suffix = pieces.length > 1 ? `（${pieceIndex + 1}/${pieces.length}）` : '';
        sections.push({
          companyId: company.id,
          title: `${sourceLabel}｜${date}${suffix}`.slice(0, 180),
          category: `AI 清洗｜LINE｜${sourceLabel}｜${date}${suffix}`.slice(0, 160),
          content: `${guidance}\n\n## ${date}${suffix}\n\n${piece}`.trim(),
          metadata: {
            sourceType: 'line_txt',
            dateFrom: block.date?.display || '',
            dateTo: block.date?.display || '',
            topic: sourceLabel,
          },
        });
      });
    }

    return {
      sections,
      ignoredAttachmentCount,
      messageCount: lines.filter(line => LINE_MESSAGE_PATTERN.test(line)).length,
      warnings: [
        ...(!blocks.some(block => block.date)
          ? ['未偵測到 LINE 日期標題，已使用「未標日期」。']
          : []),
        ...(ignoredAttachmentCount > 0
          ? [`已忽略 ${ignoredAttachmentCount} 個照片、貼圖或附件占位。`]
          : []),
      ],
    };
  }

  function parseMarkdownSections({ company, sourceName, content }) {
    const lines = content.split('\n');
    const sourceLabel = stripExtension(sourceName) || 'Markdown 知識文件';
    const rawSections = [];
    let current = { title: sourceLabel, lines: [] };
    const flush = () => {
      const body = current.lines.join('\n').trim();
      if (body) rawSections.push({ title: current.title, body });
    };

    for (const line of lines) {
      const heading = line.match(/^#{1,3}\s+(.+?)\s*$/);
      if (heading) {
        flush();
        current = { title: heading[1].trim(), lines: [line] };
      } else {
        current.lines.push(line);
      }
    }
    flush();
    if (rawSections.length === 0) throw new Error('Markdown 檔案沒有可使用的內容。');

    const guidance = [
      `[所屬公司] ${company.name}`,
      `[匯入來源] ${sourceName}`,
      '[資料性質] 品牌方知識文件；姓名、電話與 Email 保留。',
      '[隱私規則] 僅限目前公司的授權 B2B 群組與管理後台使用，不得進入公開 B2C 回答。',
    ].join('\n');
    const sections = [];
    rawSections.forEach(rawSection => {
      const pieces = splitByLimit(
        rawSection.body,
        MAX_SECTION_CHARACTERS - guidance.length - 120
      );
      pieces.forEach((piece, pieceIndex) => {
        const suffix = pieces.length > 1 ? `（${pieceIndex + 1}/${pieces.length}）` : '';
        const title = `${rawSection.title}${suffix}`.slice(0, 180);
        sections.push({
          companyId: company.id,
          title,
          category: `AI 清洗｜MD｜${sourceLabel}｜${title}`.slice(0, 160),
          content: `${guidance}\n\n${piece}`.trim(),
          metadata: {
            sourceType: 'markdown',
            topic: rawSection.title,
          },
        });
      });
    });

    return {
      sections,
      ignoredAttachmentCount: 0,
      messageCount: 0,
      warnings: [],
    };
  }

  async function buildChunks({ company, source, sections }) {
    const chunks = [];
    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
      const section = sections[sectionIndex];
      const pieces = splitByLimit(section.content, MAX_CHUNK_CHARACTERS);
      for (let chunkIndex = 0; chunkIndex < pieces.length; chunkIndex += 1) {
        const content = pieces[chunkIndex];
        chunks.push({
          companyId: company.id,
          sectionIndex,
          chunkIndex,
          topic: String(section.metadata?.topic || section.title).slice(0, 180),
          content,
          searchText: [
            company.name,
            section.title,
            section.category,
            content,
          ].join(' ').replace(/\s+/g, ' ').trim(),
          contentHash: await sha256Hex(content),
          metadata: {
            ...section.metadata,
            companySlug: company.slug,
            preservePersonalData: true,
            externalAiUsed: false,
          },
          sourceReferences: [{
            sourceName: source.name,
            sourceHash: source.contentHash,
            sectionIndex,
            chunkIndex,
          }],
        });
      }
    }
    return chunks;
  }

  async function cleanPartnerKnowledgeFile({
    company: companyInput,
    sourceName,
    content: contentInput,
  }) {
    const company = normalizeCompany(companyInput);
    const filename = normalizeFilename(sourceName);
    const type = detectSourceType(filename);
    const content = normalizeText(contentInput);
    if (!content) throw new Error('檔案沒有內容。');
    if (content.length > MAX_SOURCE_CHARACTERS) {
      throw new Error(`檔案內容需少於 ${MAX_SOURCE_CHARACTERS.toLocaleString('zh-TW')} 字。`);
    }

    const source = {
      name: filename,
      type,
      contentHash: await sha256Hex(content),
      characterCount: content.length,
    };
    const parsed = type === 'line_txt'
      ? parseLineSections({ company, sourceName: filename, content })
      : parseMarkdownSections({ company, sourceName: filename, content });
    const sections = [];
    for (const section of parsed.sections) {
      sections.push({
        ...section,
        contentHash: await sha256Hex(section.content),
      });
    }
    const chunks = await buildChunks({ company, source, sections });
    const markdown = [
      `# ${company.name}｜AI 清洗知識`,
      '',
      `- 來源：${filename}`,
      `- 格式：${type === 'line_txt' ? 'LINE TXT' : 'Markdown'}`,
      '- 個資：保留內部姓名、電話與 Email',
      '- 外部 AI：未使用',
      '- 原始檔：僅保留於使用者本機，未上傳',
      '',
      ...sections.flatMap(section => [
        `## ${section.title}`,
        '',
        section.content,
        '',
      ]),
    ].join('\n').trim();

    return {
      format: 'ecoco-partner-cleaning-package/v1',
      company,
      source,
      policy: {
        preservePersonalData: true,
        externalAiUsed: false,
        rawContentUploaded: false,
        localProcessingOnly: true,
      },
      skill: {
        name: SKILL_NAME,
        version: SKILL_VERSION,
      },
      report: {
        sourceCharacters: content.length,
        normalizedCharacters: markdown.length,
        messageCount: parsed.messageCount,
        ignoredAttachmentCount: parsed.ignoredAttachmentCount,
        sectionCount: sections.length,
        chunkCount: chunks.length,
        warnings: parsed.warnings,
      },
      sections,
      chunks,
      markdown,
    };
  }

  return {
    MAX_SOURCE_CHARACTERS,
    SKILL_NAME,
    SKILL_VERSION,
    cleanPartnerKnowledgeFile,
    sha256Hex,
  };
}));
