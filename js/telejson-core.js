(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TeleJSONCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA = 'telejson/v1';
  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
  const MAX_PREVIEW_CHARS = 50000;

  const GENERIC_TITLES = new Set([
    'exported data',
    'экспортированные данные',
    'экспорт данных'
  ]);

  const SKIP_TAGS = new Set([
    'script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed',
    'svg', 'canvas', 'head', 'title', 'meta', 'link'
  ]);

  const BLOCK_TAGS = new Set([
    'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'dt', 'dd',
    'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
    'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre',
    'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'
  ]);

  const naturalCollator = new Intl.Collator('en', {
    numeric: true,
    sensitivity: 'base'
  });

  class TeleJSONError extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'TeleJSONError';
      this.code = code || 'TELEJSON_ERROR';
    }
  }

  function normalizeSpace(value) {
    return String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeExtractedText(value) {
    return String(value == null ? '' : value)
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]*(?=\n)/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^[ \t\n]+|[ \t\n]+$/g, '');
  }

  function getDOMParser(options) {
    if (options && typeof options.DOMParser === 'function') {
      return options.DOMParser;
    }
    if (typeof DOMParser !== 'undefined') {
      return DOMParser;
    }
    throw new TeleJSONError(
      'В этой среде нет DOMParser — разобрать HTML-экспорт невозможно.',
      'NO_DOMPARSER'
    );
  }

  function naturalCompare(left, right) {
    const a = String(left == null ? '' : left);
    const b = String(right == null ? '' : right);
    const compared = naturalCollator.compare(a, b);
    if (compared !== 0) {
      return compared;
    }
    if (a === b) {
      return 0;
    }
    return a < b ? -1 : 1;
  }

  function sortParts(parts) {
    return parts.slice().sort(function (a, b) {
      const byName = naturalCompare(a.name, b.name);
      if (byName !== 0) {
        return byName;
      }
      const aSize = Number(a.size) || 0;
      const bSize = Number(b.size) || 0;
      return aSize - bSize;
    });
  }

  function getClass(node) {
    return node && node.getAttribute ? (node.getAttribute('class') || '') : '';
  }

  function readSafeUrl(value) {
    const url = String(value == null ? '' : value).trim();
    if (!url) {
      return null;
    }
    if (url.charAt(0) === '#' || /^(?:javascript|vbscript|data):/i.test(url)) {
      return null;
    }
    return url;
  }

  function renderContents(node, output, links) {
    for (let index = 0; index < node.childNodes.length; index += 1) {
      const child = node.childNodes[index];

      if (child.nodeType === 3) {
        output.push(child.nodeValue || '');
        continue;
      }

      if (child.nodeType !== 1) {
        continue;
      }

      const tag = String(child.tagName || '').toLowerCase();
      if (SKIP_TAGS.has(tag)) {
        continue;
      }

      if (tag === 'br') {
        output.push('\n');
        continue;
      }

      if (tag === 'img') {
        const alt = child.getAttribute('alt');
        if (alt) {
          output.push(alt);
        }
        continue;
      }

      if (tag === 'a' && links) {
        const url = readSafeUrl(child.getAttribute('href'));
        if (url) {
          const linkBuffer = [];
          renderContents(child, linkBuffer, null);
          links.push({ text: normalizeSpace(linkBuffer.join('')), url: url });
        }
      }

      const isBlock = BLOCK_TAGS.has(tag);
      if (isBlock) {
        output.push('\n');
      }
      renderContents(child, output, links);
      if (isBlock) {
        output.push('\n');
      }
    }
  }

  function uniqueLinks(links) {
    const seen = new Set();
    const result = [];
    for (const link of links) {
      const key = link.url + '\u0000' + link.text;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(link);
      }
    }
    return result;
  }

  function extractFromRoots(roots) {
    const parts = [];
    const links = [];
    for (const root of roots) {
      const buffer = [];
      renderContents(root, buffer, links);
      const text = normalizeExtractedText(buffer.join(''));
      if (text) {
        parts.push(text);
      }
    }
    return {
      text: normalizeExtractedText(parts.join('\n')),
      links: uniqueLinks(links)
    };
  }

  function extractMessageText(element) {
    const roots = Array.from(element.querySelectorAll('.text')).filter(function (node) {
      return !node.closest('.reply_to');
    });
    return extractFromRoots(roots);
  }

  function extractServiceText(element) {
    const body = element.querySelector('.body');
    if (!body) {
      return { text: '', links: [] };
    }
    const clone = body.cloneNode(true);
    clone.querySelectorAll('.date, .from_name, .reply_to, .media_wrap, .userpic_wrap, .userpic')
      .forEach(function (node) {
        node.remove();
      });
    return extractFromRoots([clone]);
  }

  function readChatTitle(documentNode) {
    const selectors = [
      '.page_header .text.bold',
      '.page_header_title',
      '.page_header h1',
      '.page_header .text'
    ];
    for (const selector of selectors) {
      const node = documentNode.querySelector(selector);
      if (node) {
        const title = normalizeSpace(node.textContent);
        if (title) {
          return title;
        }
      }
    }
    return null;
  }

  function isGenericTitle(title) {
    if (!title) {
      return false;
    }
    return GENERIC_TITLES.has(normalizeSpace(title).toLowerCase());
  }

  function readMessageId(element) {
    const dataId = element.getAttribute('data-message-id');
    if (dataId !== null && normalizeSpace(dataId) !== '') {
      return normalizeId(dataId);
    }
    const idAttribute = element.getAttribute('id') || '';
    const match = /^message(-?\d+)$/i.exec(idAttribute);
    if (match) {
      return normalizeId(match[1]);
    }
    return null;
  }

  function normalizeId(value) {
    const raw = String(value == null ? '' : value).trim();
    if (/^-?\d+$/.test(raw)) {
      const number = Number(raw);
      if (Number.isSafeInteger(number)) {
        return number;
      }
    }
    return raw;
  }

  function readDate(element) {
    const node = element.querySelector('.date[title]') ||
      element.querySelector('.pull_right.date') ||
      element.querySelector('.date');
    if (!node) {
      return null;
    }
    const title = normalizeSpace(node.getAttribute('title'));
    if (title) {
      return title;
    }
    return normalizeSpace(node.textContent) || null;
  }

  function daysInMonth(year, month) {
    const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) {
      return 29;
    }
    return lengths[month - 1];
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function normalizeDate(value) {
    const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s+(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?)?$/i.exec(
      normalizeSpace(value)
    );
    if (!match) {
      return null;
    }

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6] || 0);
    const offsetSign = match[7];
    const offsetHour = Number(match[8] || 0);
    const offsetMinute = Number(match[9] || 0);

    if (!offsetSign || month < 1 || month > 12 || year < 1 ||
      day < 1 || day > daysInMonth(year, month) ||
      hour > 23 || minute > 59 || second > 59 ||
      offsetHour > 23 || offsetMinute > 59) {
      return null;
    }

    return String(year).padStart(4, '0') + '-' + pad2(month) + '-' + pad2(day) +
      'T' + pad2(hour) + ':' + pad2(minute) + ':' + pad2(second) +
      offsetSign + pad2(offsetHour) + ':' + pad2(offsetMinute);
  }

  function readSender(element) {
    const names = Array.from(element.querySelectorAll('.from_name'));
    const ownName = names.find(function (node) {
      return !node.closest('.forwarded') && !node.closest('.reply_to');
    });
    return ownName ? (normalizeSpace(ownName.textContent) || null) : null;
  }

  function readForwardedFrom(element) {
    const name = element.querySelector('.forwarded.body .from_name') ||
      element.querySelector('.forwarded .from_name');
    if (!name) {
      return null;
    }

    const anchors = Array.from(name.querySelectorAll('a'))
      .map(function (anchor) { return normalizeSpace(anchor.textContent); })
      .filter(Boolean);
    if (anchors.length) {
      return anchors.join(' / ');
    }

    const clone = name.cloneNode(true);
    clone.querySelectorAll('.details').forEach(function (node) {
      node.remove();
    });
    let value = normalizeSpace(clone.textContent)
      .replace(/^(?:forwarded from|переслано от|weitergeleitet von|reenviado de)\s*:?\s*/i, '');
    if (value) {
      return value;
    }

    const details = name.querySelector('.details');
    if (details) {
      value = normalizeSpace(details.textContent)
        .replace(/^(?:forwarded from|переслано от|weitergeleitet von|reenviado de)\s*:?\s*/i, '');
      if (value) {
        return value;
      }
    }
    return null;
  }

  function readReplyTo(element) {
    const reply = Array.from(element.querySelectorAll('.reply_to')).find(function (node) {
      return !node.closest('.forwarded');
    });
    if (!reply) {
      return { value: null, unresolved: false };
    }

    const link = reply.querySelector('a[href*="go_to_message"], a[onclick]') ||
      reply.querySelector('a[href]');
    let raw = null;

    if (link) {
      const href = link.getAttribute('href') || '';
      const hrefMatch = /#go_to_message(-?\d+)/i.exec(href);
      if (hrefMatch) {
        raw = hrefMatch[1];
      }
      if (raw === null) {
        const onclick = link.getAttribute('onclick') || '';
        const onclickMatch = /GoToMessage\(\s*(-?\d+)\s*\)/i.exec(onclick);
        if (onclickMatch) {
          raw = onclickMatch[1];
        }
      }
    }

    if (raw === null) {
      raw = reply.getAttribute('data-message-id');
    }
    if (raw === null && link) {
      raw = link.getAttribute('data-message-id');
    }

    if (raw === null || normalizeSpace(raw) === '') {
      return { value: null, unresolved: true };
    }
    return { value: normalizeId(raw), unresolved: false };
  }

  function inferAttachmentType(classSource, path, title) {
    const classes = String(classSource || '').toLowerCase();
    const normalizedPath = String(path || '').replace(/\\/g, '/').toLowerCase();

    if (normalizedPath.includes('round_video_messages/')) {
      return 'video_message';
    }
    if (normalizedPath.includes('voice_messages/')) {
      return 'voice';
    }
    if (normalizedPath.includes('stickers/')) {
      return 'sticker';
    }
    if (normalizedPath.includes('photos/') || normalizedPath.includes('profile_photos/')) {
      return 'photo';
    }
    if (normalizedPath.includes('video_files/')) {
      return 'video';
    }
    if (normalizedPath.includes('gifs/')) {
      return 'animation';
    }

    if (/sticker/.test(classes)) {
      return 'sticker';
    }
    if (/voice/.test(classes)) {
      return 'voice';
    }
    if (/(?:round[_-]?video|video[_-]?message|video[_-]?note)/.test(classes)) {
      return 'video_message';
    }
    if (/(?:gif|animation)/.test(classes)) {
      return 'animation';
    }
    if (/photo|image/.test(classes)) {
      return 'photo';
    }
    if (/video/.test(classes)) {
      return 'video';
    }
    if (/audio|music/.test(classes)) {
      return 'audio';
    }
    if (/contact/.test(classes)) {
      return 'contact';
    }
    if (/venue|location|geo/.test(classes)) {
      return 'location';
    }
    if (/poll/.test(classes)) {
      return 'poll';
    }
    if (/call/.test(classes)) {
      return 'call';
    }
    if (/game/.test(classes)) {
      return 'game';
    }
    if (/invoice/.test(classes)) {
      return 'invoice';
    }
    if (/link[_-]?preview/.test(classes)) {
      return 'link';
    }

    if (normalizedPath.includes('files/')) {
      return 'file';
    }

    const extensionMatch = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(normalizedPath);
    const extension = extensionMatch ? extensionMatch[1] : '';
    if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'bmp', 'tif', 'tiff'].includes(extension)) {
      return 'photo';
    }
    if (['mp4', 'mov', 'mkv', 'webm', 'avi'].includes(extension)) {
      return 'video';
    }
    if (['ogg', 'opus'].includes(extension)) {
      return 'voice';
    }
    if (['mp3', 'm4a', 'flac', 'wav', 'aac'].includes(extension)) {
      return 'audio';
    }
    if (extension === 'gif') {
      return 'animation';
    }
    if (title) {
      return 'file';
    }
    return path ? 'file' : null;
  }

  function extractAttachments(element, text) {
    const attachments = [];
    const seen = new Set();

    function addAttachment(type, path, title) {
      if (!type) {
        return;
      }
      const item = { type: type };
      if (path) {
        item.path = path;
      }
      if ((type === 'file' || type === 'contact') && title) {
        item.name = title;
      }
      if (text) {
        item.caption = text;
      }
      const key = item.type + '\u0000' + (item.path || '') + '\u0000' + (item.name || '');
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      attachments.push(item);
    }

    const containers = Array.from(element.querySelectorAll('.media_wrap'));
    for (const container of containers) {
      if (container.parentElement && container.parentElement.closest('.media_wrap')) {
        continue;
      }
      const containerClass = getClass(container);
      if (/link[_-]?preview/.test(containerClass) || container.querySelector('.link_preview')) {
        continue;
      }

      const anchor = container.querySelector('a[href]');
      const mediaNode = container.querySelector('video[src], audio[src]');
      const imageNode = container.querySelector('img[src]');
      const path = readSafeUrl(
        (anchor && anchor.getAttribute('href')) ||
        (mediaNode && mediaNode.getAttribute('src')) ||
        (imageNode && imageNode.getAttribute('src'))
      );
      const classSource = [
        containerClass,
        getClass(container.querySelector('.media')),
        getClass(container.querySelector('.media_poll')),
        getClass(anchor),
        getClass(container.querySelector('.photo')),
        getClass(container.querySelector('.video_file')),
        getClass(container.querySelector('.audio_file')),
        getClass(container.querySelector('.sticker')),
        getClass(container.querySelector('.media_voice_message'))
      ].join(' ');
      const titleNode = container.querySelector('.title.bold') ||
        container.querySelector('.title') ||
        container.querySelector('.question.bold');
      const title = titleNode ? normalizeSpace(titleNode.textContent) : null;
      const type = inferAttachmentType(classSource, path, title);

      if (!type) {
        continue;
      }
      addAttachment(type, path, title);
    }

    const standaloneSelector = [
      'a.photo_wrap',
      'a.video_file_wrap',
      'a.audio_file_wrap',
      'a.media_voice_message',
      'a.sticker_wrap',
      'a.round_video_message',
      'a.video_message'
    ].join(',');
    const standalone = Array.from(element.querySelectorAll(standaloneSelector));
    for (const anchor of standalone) {
      if (anchor.closest('.media_wrap')) {
        continue;
      }
      const path = readSafeUrl(anchor.getAttribute('href'));
      const type = inferAttachmentType(getClass(anchor), path, null);
      addAttachment(type, path, null);
    }

    return attachments;
  }

  function isTelegramMessage(element) {
    return element.hasAttribute('data-message-id') ||
      /^message-?\d+$/i.test(element.getAttribute('id') || '') ||
      Boolean(element.querySelector('.body'));
  }

  function parseMessageElement(element, context) {
    const isService = element.classList.contains('service');
    const data = {
      id: readMessageId(element),
      type: isService ? 'service' : 'message'
    };

    const date = readDate(element);
    if (date) {
      data.date = date;
      const normalizedDate = normalizeDate(date);
      if (normalizedDate) {
        data.date_iso = normalizedDate;
      }
    }

    if (!isService) {
      const sender = readSender(element);
      if (sender) {
        data.sender = sender;
      }
      const forwardedFrom = readForwardedFrom(element);
      if (forwardedFrom) {
        data.forwarded_from = forwardedFrom;
      }
      const reply = readReplyTo(element);
      if (reply.value !== null) {
        data.reply_to = reply.value;
      }
      if (reply.unresolved) {
        context.replyUnresolved += 1;
      }
    }

    const textInfo = isService ? extractServiceText(element) : extractMessageText(element);
    if (textInfo.text) {
      data.text = textInfo.text;
    }
    if (textInfo.links.length) {
      data.links = textInfo.links;
    }

    if (!isService) {
      const attachments = extractAttachments(element, textInfo.text);
      if (attachments.length) {
        data.attachments = attachments;
      }
    }

    return {
      data: data,
      joined: !isService && element.classList.contains('joined')
    };
  }

  function parseExportHtml(html, options) {
    const settings = options || {};
    const prefix = settings.fileName ? String(settings.fileName) + ': ' : '';
    const source = typeof html === 'string' ? html.replace(/^\ufeff/, '') : '';

    if (!source.trim()) {
      throw new TeleJSONError(
        prefix + 'Файл пуст. Выберите HTML-файл экспорта Telegram Desktop.',
        'EMPTY_FILE'
      );
    }

    const Parser = getDOMParser(settings);
    let documentNode;
    try {
      documentNode = new Parser().parseFromString(source, 'text/html');
    } catch (error) {
      throw new TeleJSONError(
        prefix + 'Не удалось разобрать HTML: ' + (error && error.message ? error.message : 'неизвестная ошибка') + '.',
        'INVALID_HTML'
      );
    }

    if (!documentNode || documentNode.querySelector('parsererror')) {
      throw new TeleJSONError(
        prefix + 'HTML повреждён или не является экспортом Telegram Desktop.',
        'INVALID_HTML'
      );
    }

    const hasHeader = Boolean(documentNode.querySelector('.page_header, .page_header_title'));
    const hasHistory = Boolean(documentNode.querySelector('.history, .page_body'));
    const messageElements = Array.from(documentNode.querySelectorAll('.message'))
      .filter(isTelegramMessage);

    if (!messageElements.length) {
      if (hasHeader || hasHistory) {
        throw new TeleJSONError(
          prefix + 'В экспорте не найдено сообщений. Похоже, список сообщений пуст.',
          'EMPTY_EXPORT'
        );
      }
      throw new TeleJSONError(
        prefix + 'Не удалось распознать HTML-экспорт Telegram Desktop. Ожидается messages.html (или messages2.html и следующие части).',
        'INVALID_EXPORT'
      );
    }

    if (!hasHeader && !hasHistory) {
      throw new TeleJSONError(
        prefix + 'HTML не похож на полный экспорт Telegram Desktop: не найдены заголовок или контейнер чата.',
        'INVALID_EXPORT'
      );
    }

    const rawTitle = readChatTitle(documentNode);
    const titleIsGeneric = isGenericTitle(rawTitle);
    const title = titleIsGeneric ? null : rawTitle;
    const warnings = [];
    const messages = [];
    const context = { replyUnresolved: 0 };
    let missingIds = 0;
    let unnormalizedDates = 0;

    for (const element of messageElements) {
      const parsed = parseMessageElement(element, context);
      if (parsed.data.id === null) {
        missingIds += 1;
      }
      if (parsed.data.date && !parsed.data.date_iso) {
        unnormalizedDates += 1;
      }
      messages.push(parsed);
    }

    if (messages.length === 1 && messages[0].data.type === 'service' &&
      normalizeSpace(messages[0].data.text).toLowerCase() === 'no exported messages') {
      throw new TeleJSONError(
        prefix + 'В экспорте не найдено сообщений: Telegram записал «No exported messages».',
        'EMPTY_EXPORT'
      );
    }

    if (missingIds) {
      warnings.push(
        prefix + 'Сообщений без id: ' + missingIds + '. Они не участвуют в дедупликации.'
      );
    }
    if (unnormalizedDates) {
      warnings.push(
        prefix + 'Не удалось нормализовать даты (сообщений: ' + unnormalizedDates +
        '). Оригинальные значения сохранены.'
      );
    }
    if (context.replyUnresolved) {
      warnings.push(
        prefix + 'Не удалось определить id ответа в сообщениях: ' + context.replyUnresolved + '.'
      );
    }

    return {
      title: title,
      rawTitle: rawTitle,
      titleIsGeneric: titleIsGeneric,
      messages: messages,
      warnings: warnings
    };
  }

  function stableJson(value) {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return '[' + value.map(stableJson).join(',') + ']';
    }
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + stableJson(value[key]);
    }).join(',') + '}';
  }

  function addWarning(warnings, seen, value) {
    const warning = String(value == null ? '' : value);
    if (!warning || seen.has(warning)) {
      return;
    }
    seen.add(warning);
    warnings.push(warning);
  }

  function buildDocument(parts) {
    if (!Array.isArray(parts) || !parts.length) {
      throw new TeleJSONError('Не выбрано ни одного файла экспорта.', 'NO_FILES');
    }

    for (const part of parts) {
      if (!part || typeof part.name !== 'string' || !part.parsed ||
        !Array.isArray(part.parsed.messages)) {
        throw new TeleJSONError('Внутренняя ошибка: некорректные данные файла.', 'INVALID_INPUT');
      }
    }

    const sortedParts = sortParts(parts);
    const warnings = [];
    const warningSet = new Set();

    for (const part of sortedParts) {
      for (const warning of (part.parsed.warnings || [])) {
        addWarning(warnings, warningSet, warning);
      }
    }

    const titles = new Map();
    for (const part of sortedParts) {
      if (part.parsed.title) {
        const key = normalizeSpace(part.parsed.title);
        if (!titles.has(key)) {
          titles.set(key, { title: key, files: [] });
        }
        titles.get(key).files.push(part.name);
      }
    }

    if (titles.size > 1) {
      const titleList = Array.from(titles.values());
      const details = titleList.slice(0, 3).map(function (entry) {
        return '«' + entry.title + '» (' + entry.files.slice(0, 2).join(', ') + ')';
      }).join('; ') + (titleList.length > 3 ? ' и другие' : '');
      throw new TeleJSONError(
        'Выбраны файлы разных чатов: ' + details +
        '. Загрузите части одного экспорта, чтобы не смешать сообщения.',
        'DIFFERENT_CHATS'
      );
    }

    const chat = titles.size === 1 ? Array.from(titles.values())[0].title : null;

    if (!chat) {
      const hasGeneric = sortedParts.some(function (part) {
        return part.parsed.titleIsGeneric;
      });
      addWarning(
        warnings,
        warningSet,
        'Не удалось определить название чата' +
        (hasGeneric ? ': служебный заголовок «Exported Data» не используется как название' : '') +
        '. Поле chat оставлено null. Проверьте, что все файлы относятся к одному чату.'
      );
    } else {
      for (const part of sortedParts) {
        if (part.parsed.title) {
          continue;
        }
        if (part.parsed.titleIsGeneric) {
          addWarning(
            warnings,
            warningSet,
            part.name + ': служебный заголовок «' + (part.parsed.rawTitle || 'Exported Data') +
            '» не является названием чата. Использовано «' + chat + '». ' +
            'Проверьте, что файл относится к тому же чату.'
          );
        } else {
          addWarning(
            warnings,
            warningSet,
            part.name + ': не найдено название чата. Использовано «' + chat + '». ' +
            'Проверьте, что файл относится к тому же чату.'
          );
        }
      }
    }

    const items = [];
    const byId = new Map();
    let duplicatesRemoved = 0;
    let conflicts = 0;

    for (const part of sortedParts) {
      for (const parsedMessage of part.parsed.messages) {
        const id = parsedMessage.data.id;
        const key = id === null || id === undefined ? null : 'id:' + String(id);

        if (key !== null && byId.has(key)) {
          const previous = byId.get(key);
          duplicatesRemoved += 1;
          if (stableJson(previous.data) !== stableJson(parsedMessage.data)) {
            conflicts += 1;
            addWarning(
              warnings,
              warningSet,
              'Конфликт дубликата: сообщение id ' + id + ' встречается в «' + previous.file +
              '» и «' + part.name + '» с разным содержимым. Сохранено первое.'
            );
          }
          continue;
        }

        const item = {
          data: parsedMessage.data,
          joined: Boolean(parsedMessage.joined),
          file: part.name
        };
        if (key !== null) {
          byId.set(key, item);
        }
        items.push(item);
      }
    }

    let lastSender = null;
    for (const item of items) {
      const message = item.data;
      if (message.type !== 'message') {
        continue;
      }

      if (!message.sender && item.joined && lastSender) {
        message.sender = lastSender;
      }

      if (message.sender) {
        lastSender = message.sender;
      } else if (item.joined) {
        addWarning(
          warnings,
          warningSet,
          'Joined-сообщение с id ' + (message.id === null ? '—' : message.id) +
          ': не удалось определить отправителя.'
        );
      } else {
        lastSender = null;
      }
    }

    const messages = items.map(function (item) { return item.data; });
    const documentNode = {
      schema: SCHEMA,
      chat: chat,
      messages: messages
    };

    if (warnings.length) {
      documentNode.warnings = warnings.slice();
    }

    const stats = {
      files: sortedParts.length,
      messages: messages.filter(function (message) { return message.type === 'message'; }).length,
      service: messages.filter(function (message) { return message.type === 'service'; }).length,
      attachments: messages.reduce(function (total, message) {
        return total + (Array.isArray(message.attachments) ? message.attachments.length : 0);
      }, 0),
      duplicatesRemoved: duplicatesRemoved,
      conflicts: conflicts,
      warnings: warnings.length
    };

    return {
      document: documentNode,
      stats: stats,
      warnings: warnings.slice()
    };
  }

  function makePreview(fullJson, limit) {
    const value = String(fullJson == null ? '' : fullJson);
    const maximum = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : MAX_PREVIEW_CHARS;
    if (value.length <= maximum) {
      return { text: value, truncated: false };
    }
    let end = maximum;
    const code = value.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      end -= 1;
    }
    return {
      text: value.slice(0, end) + '\n…',
      truncated: true
    };
  }

  function makeDownloadName(chat) {
    const normalized = normalizeSpace(chat)
      .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[.\s-]+|[.\s-]+$/g, '');
    const base = Array.from(normalized)
      .slice(0, 60)
      .join('')
      .replace(/[.\s-]+$/g, '');
    return 'telejson' + (base ? '-' + base : '') + '.json';
  }

  return {
    SCHEMA: SCHEMA,
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    MAX_TOTAL_BYTES: MAX_TOTAL_BYTES,
    MAX_PREVIEW_CHARS: MAX_PREVIEW_CHARS,
    TeleJSONError: TeleJSONError,
    naturalCompare: naturalCompare,
    normalizeDate: normalizeDate,
    parseExportHtml: parseExportHtml,
    buildDocument: buildDocument,
    makePreview: makePreview,
    makeDownloadName: makeDownloadName
  };
});
