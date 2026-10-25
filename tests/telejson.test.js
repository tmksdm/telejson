'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { JSDOM } = require('jsdom');

const core = require('../js/telejson-core.js');

const baseDom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const parserOptions = { DOMParser: baseDom.window.DOMParser };
const fixturesDir = path.join(__dirname, 'fixtures');
const projectDir = path.join(__dirname, '..');

after(function () {
  baseDom.window.close();
});

function fixture(name) {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

function parseFixture(name, exportName) {
  return core.parseExportHtml(fixture(name), {
    ...parserOptions,
    fileName: exportName || name
  });
}

function build(list) {
  const parts = list.map(function (entry) {
    return {
      name: entry[1],
      parsed: parseFixture(entry[0], entry[1])
    };
  });
  return core.buildDocument(parts);
}

function byId(messages) {
  return new Map(messages.map(function (message) {
    return [message.id, message];
  }));
}

test('basic Telegram export: service, dates, text, links, reply and joined sender', function () {
  const parsed = parseFixture('basic.html');
  assert.equal(parsed.title, 'Синтетический чат');
  assert.equal(parsed.titleIsGeneric, false);
  assert.equal(parsed.messages.length, 4);

  const service = parsed.messages[0].data;
  assert.equal(service.id, -1);
  assert.equal(service.type, 'service');
  assert.equal(service.text, '1 февраля 2024');
  assert.equal(service.sender, undefined);

  const first = parsed.messages[1].data;
  assert.equal(first.id, 1);
  assert.equal(first.type, 'message');
  assert.equal(first.sender, 'Анна');
  assert.equal(first.date, '01.02.2024 10:05:00 UTC+03:00');
  assert.equal(first.date_iso, '2024-02-01T10:05:00+03:00');
  assert.ok(first.text.includes('Привет!\nВторая строка 😀'));
  assert.ok(first.text.includes('const x = 1;'));
  assert.ok(first.text.includes('Цитата'));
  assert.ok(first.text.includes('Ссылка: пример'));
  assert.deepEqual(first.links, [
    { text: 'пример', url: 'https://example.com/page' }
  ]);

  const joined = parsed.messages[2].data;
  assert.equal(joined.id, 2);
  assert.equal(joined.sender, undefined);

  const result = core.buildDocument([{ name: 'basic.html', parsed: parsed }]);
  assert.equal(result.document.schema, core.SCHEMA);
  assert.equal(result.document.chat, 'Синтетический чат');
  assert.equal(result.document.messages.length, 4);
  assert.equal(result.document.messages[2].sender, 'Анна');
  assert.equal(result.document.messages[3].reply_to, 1);
  assert.equal(result.stats.messages, 3);
  assert.equal(result.stats.service, 1);
  assert.equal(result.stats.attachments, 0);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.document.warnings, undefined);
});

test('link without a visible label still keeps its URL', function () {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
  <div class="page_wrap">
    <div class="page_header"><div class="text bold">Синтетические ссылки</div></div>
    <div class="page_body chat_page"><div class="history">
      <div class="message default clearfix" id="message1">
        <div class="body">
          <div class="pull_right date details" title="10.11.2024 12:00:00 UTC+03:00">12:00</div>
          <div class="from_name">Тест</div>
          <div class="text">Видимый текст <a href="https://example.com/invisible"></a></div>
        </div>
      </div>
    </div></div>
  </div>
</body></html>`;

  const parsed = core.parseExportHtml(html, {
    ...parserOptions,
    fileName: 'links.html'
  });
  const result = core.buildDocument([{ name: 'links.html', parsed: parsed }]);
  assert.deepEqual(result.document.messages[0].links, [
    { text: '', url: 'https://example.com/invisible' }
  ]);
});

test('media metadata, captions and forwarded source are extracted without media contents', function () {
  const result = build([['media.html', 'media.html']]);
  const messages = byId(result.document.messages);

  assert.equal(result.document.chat, 'Медиа-чат');
  assert.equal(result.stats.attachments, 7);
  assert.deepEqual(result.warnings, []);

  const photo = messages.get(10);
  assert.deepEqual(photo.attachments, [{
    type: 'photo',
    path: 'photos/photo_10.jpg',
    caption: 'Фото с подписью'
  }]);

  const video = messages.get(11);
  assert.deepEqual(video.attachments, [{
    type: 'video',
    path: 'video_files/video_11.mp4',
    caption: 'Видео'
  }]);

  const voice = messages.get(12);
  assert.deepEqual(voice.attachments, [{
    type: 'voice',
    path: 'voice_messages/audio_12.ogg',
    caption: 'Голосовое'
  }]);

  const sticker = messages.get(13);
  assert.deepEqual(sticker.attachments, [{
    type: 'sticker',
    path: 'stickers/sticker_13.webp'
  }]);

  const file = messages.get(14);
  assert.deepEqual(file.attachments, [{
    type: 'file',
    name: 'document.pdf'
  }]);
  assert.equal(file.text, undefined);

  const audio = messages.get(15);
  assert.deepEqual(audio.attachments, [{
    type: 'audio',
    path: 'files/song.mp3',
    caption: 'Аудио'
  }]);

  const forwarded = messages.get(16);
  assert.equal(forwarded.sender, 'Борис');
  assert.equal(forwarded.forwarded_from, 'Синтетический канал');
  assert.equal(forwarded.text, 'Пересланный текст');
  assert.deepEqual(forwarded.attachments, [{
    type: 'file',
    name: 'forwarded.txt',
    caption: 'Пересланный текст'
  }]);
});

test('forwarded source ignores the preceding forwarded userpic wrapper', function () {
  const result = build([['forwarded-wrapper.html', 'forwarded-wrapper.html']]);
  const message = result.document.messages[0];

  assert.equal(message.sender, 'Тест');
  assert.equal(message.forwarded_from, 'Синтетический источник');
  assert.equal(message.text, 'Синтетический пересланный текст');
  assert.deepEqual(result.warnings, []);
});

test('multipart files are naturally sorted, deduplicated and joined senders continue', function () {
  assert.ok(core.naturalCompare('messages.html', 'messages2.html') < 0);
  assert.ok(core.naturalCompare('messages2.html', 'messages10.html') < 0);

  const result = build([
    ['multipart-b.html', 'messages2.html'],
    ['multipart-a.html', 'messages.html']
  ]);

  assert.equal(result.stats.files, 2);
  assert.equal(result.stats.duplicatesRemoved, 1);
  assert.equal(result.stats.conflicts, 0);
  assert.deepEqual(result.document.messages.map(function (message) {
    return message.id;
  }), [1, 2, 3, 4]);
  assert.deepEqual(result.document.messages.map(function (message) {
    return message.sender;
  }), ['Анна', 'Анна', 'Анна', 'Борис']);
  assert.equal(result.document.messages[3].text, 'Четвёртое сообщение');
  assert.deepEqual(result.warnings, []);
});

test('joined message without a known sender produces a warning', function () {
  const result = build([['multipart-b.html', 'messages2.html']]);
  assert.equal(result.document.messages[0].sender, undefined);
  assert.equal(result.document.messages[1].sender, undefined);
  assert.ok(result.warnings.some(function (warning) {
    return warning.includes('Joined-сообщение') && warning.includes('id 2');
  }));
  assert.ok(result.warnings.some(function (warning) {
    return warning.includes('Joined-сообщение') && warning.includes('id 3');
  }));
});

test('conflicting duplicate IDs are deterministic and warned about', function () {
  const result = build([
    ['multipart-b.html', 'messages2.html'],
    ['multipart-conflict.html', 'messages3.html'],
    ['multipart-a.html', 'messages.html']
  ]);

  assert.equal(result.stats.duplicatesRemoved, 2);
  assert.equal(result.stats.conflicts, 1);
  assert.equal(result.document.messages.find(function (message) {
    return message.id === 4;
  }).text, 'Четвёртое сообщение');
  assert.ok(result.warnings.some(function (warning) {
    return warning.includes('id 4') &&
      warning.includes('messages2.html') &&
      warning.includes('messages3.html');
  }));
  assert.deepEqual(result.document.warnings, result.warnings);
});

test('different chats are rejected instead of mixing overlapping IDs', function () {
  assert.throws(function () {
    build([
      ['basic.html', 'messages.html'],
      ['other-chat.html', 'messages2.html']
    ]);
  }, function (error) {
    return error.code === 'DIFFERENT_CHATS' &&
      error.message.includes('Синтетический чат') &&
      error.message.includes('Другой чат');
  });
});

test('generic Exported Data header is not used as the chat name', function () {
  const alone = build([['generic.html', 'messages.html']]);
  assert.equal(alone.document.chat, null);
  assert.ok(alone.warnings.some(function (warning) {
    return warning.includes('Exported Data') && warning.includes('chat');
  }));

  const mixed = build([
    ['generic.html', 'messages2.html'],
    ['basic.html', 'messages.html']
  ]);
  assert.equal(mixed.document.chat, 'Синтетический чат');
  assert.ok(mixed.warnings.some(function (warning) {
    return warning.includes('messages2.html') && warning.includes('Exported Data');
  }));
});

test('empty, empty-single and invalid HTML exports fail clearly', function () {
  assert.throws(function () {
    parseFixture('empty.html');
  }, function (error) {
    return error.code === 'EMPTY_EXPORT' && error.message.includes('не найдено сообщений');
  });

  assert.throws(function () {
    parseFixture('empty-single.html');
  }, function (error) {
    return error.code === 'EMPTY_EXPORT' && error.message.includes('No exported messages');
  });

  assert.throws(function () {
    parseFixture('invalid.html');
  }, function (error) {
    return error.code === 'INVALID_EXPORT';
  });

  assert.throws(function () {
    core.parseExportHtml('   \n\t ', parserOptions);
  }, function (error) {
    return error.code === 'EMPTY_FILE';
  });
});

test('resource-bearing synthetic markup is treated as data, not inserted content', function () {
  const result = build([['resource-elements.html', 'resource-elements.html']]);
  const message = result.document.messages[0];

  assert.ok(message.text.includes('Видимый текст'));
  assert.ok(message.text.includes('ALT'));
  assert.ok(message.text.includes('ссылка'));
  assert.ok(!message.text.includes('IFRAME_FALLBACK'));
  assert.ok(!message.text.includes('OBJECT_FALLBACK'));
  assert.deepEqual(message.links, [
    { text: 'ссылка', url: 'https://example.com/safe' }
  ]);
  assert.deepEqual(message.attachments, [{
    type: 'photo',
    path: 'https://resources.invalid/photo.jpg',
    caption: message.text
  }]);
});

test('HTML is inert and unsafe links/scripts do not enter the JSON', function () {
  const xssDom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'dangerously'
  });

  try {
    const parsed = core.parseExportHtml(fixture('xss.html'), {
      fileName: 'xss.html',
      DOMParser: xssDom.window.DOMParser
    });
    assert.equal(xssDom.window.__telejsonXss, undefined);

    const result = core.buildDocument([{ name: 'xss.html', parsed: parsed }]);
    const message = result.document.messages[0];

    assert.equal(message.sender, '<img src=x onerror="window.__telejsonXss=1">');
    assert.ok(message.text.includes('2 < 3 && 4 > 1'));
    assert.ok(message.text.includes('опасная и безопасная'));
    assert.ok(!message.text.includes('script'));
    assert.deepEqual(message.links, [
      { text: 'безопасная', url: 'https://example.com/?a=1&b=2' }
    ]);
    assert.ok(!JSON.stringify(result.document).includes('<script>'));
  } finally {
    xssDom.window.close();
  }
});

test('date normalization keeps the original offset and warns about non-ISO fallbacks', function () {
  assert.equal(
    core.normalizeDate('01.02.2024 10:05:00 UTC-05:30'),
    '2024-02-01T10:05:00-05:30'
  );
  assert.equal(core.normalizeDate('01.02.2024 10:05:00'), null);
  assert.equal(core.normalizeDate('31.02.2024 10:05:00 UTC+03:00'), null);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
  <div class="page_wrap">
    <div class="page_header"><div class="text bold">Даты</div></div>
    <div class="page_body chat_page"><div class="history">
      <div class="message default clearfix" id="message1">
        <div class="body">
          <div class="pull_right date details" title="07.08.2024 15:00:00">15:00</div>
          <div class="from_name">Тест</div>
          <div class="text">Без часового пояса</div>
        </div>
      </div>
    </div></div>
  </div>
</body></html>`;

  const parsed = core.parseExportHtml(html, {
    ...parserOptions,
    fileName: 'dates.html'
  });
  assert.equal(parsed.messages[0].data.date, '07.08.2024 15:00:00');
  assert.equal(parsed.messages[0].data.date_iso, undefined);
  assert.ok(parsed.warnings.some(function (warning) {
    return warning.includes('нормализовать даты');
  }));
});

test('preview is bounded and download names are filesystem-safe', function () {
  const preview = core.makePreview('x'.repeat(80), 10);
  assert.equal(preview.truncated, true);
  assert.ok(preview.text.startsWith('xxxxxxxxxx'));

  const small = core.makePreview('{"ok":true}', 100);
  assert.deepEqual(small, { text: '{"ok":true}', truncated: false });

  assert.equal(core.makeDownloadName('A/B: C'), 'telejson-A-B-C.json');
  assert.equal(core.makeDownloadName(null), 'telejson.json');
});

test('static site uses local classic scripts and contains no network or HTML-injection calls', function () {
  const html = fs.readFileSync(path.join(projectDir, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(projectDir, 'styles.css'), 'utf8');
  const scriptFiles = ['telejson-core.js', 'example.js', 'app.js'].map(function (name) {
    return fs.readFileSync(path.join(projectDir, 'js', name), 'utf8');
  });

  assert.ok(!/type\s*=\s*["']module["']/i.test(html));
  assert.ok(!/https?:\/\//i.test(html));
  assert.ok(!/https?:\/\//i.test(css));
  assert.ok(html.includes('<script defer src="js/telejson-core.js"></script>'));
  assert.ok(html.includes('<script defer src="js/example.js"></script>'));
  assert.ok(html.includes('<script defer src="js/app.js"></script>'));

  for (const source of scriptFiles) {
    assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(source));
    assert.ok(!/\b(innerHTML|outerHTML|insertAdjacentHTML)\b/.test(source));
  }
});

test('index.html enforces a restrictive CSP and contains no inline executable markup', function () {
  const html = fs.readFileSync(path.join(projectDir, 'index.html'), 'utf8');
  const match = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i.exec(html);
  assert.ok(match, 'CSP meta tag must be present');

  const csp = match[1];
  const directives = [
    "default-src 'none'",
    "script-src 'self' file:",
    "script-src-attr 'none'",
    "style-src 'self' file:",
    "style-src-elem 'self' file:",
    "style-src-attr 'unsafe-inline'",
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ];
  for (const directive of directives) {
    assert.ok(csp.includes(directive), 'missing CSP directive: ' + directive);
  }

  const cspPosition = html.indexOf('Content-Security-Policy');
  const stylePosition = html.indexOf('<link rel="stylesheet"');
  const scriptPosition = html.indexOf('<script defer src="js/telejson-core.js"');
  assert.ok(cspPosition > 0 && cspPosition < stylePosition && cspPosition < scriptPosition,
    'CSP must be declared before styles and scripts');

  assert.ok(!/<style[\s>]/i.test(html), 'inline style element is not expected');
  assert.ok(!/\sstyle\s*=/i.test(html), 'inline style attributes are not expected');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'inline event handlers are not expected');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'inline script is not expected');
});

test('index.html loads through file:// and renders the built-in synthetic example', async function () {
  const dom = await JSDOM.fromFile(path.join(projectDir, 'index.html'), {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true
  });

  try {
    await new Promise(function (resolve, reject) {
      if (dom.window.document.readyState === 'complete') {
        resolve();
        return;
      }
      const timer = setTimeout(function () {
        reject(new Error('index.html load timeout'));
      }, 10000);
      dom.window.addEventListener('load', function () {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });

    assert.equal(typeof dom.window.TeleJSONCore.parseExportHtml, 'function');
    assert.equal(typeof dom.window.TeleJSONExample.files.length, 'number');

    const documentNode = dom.window.document;
    documentNode.getElementById('example-button').click();

    await waitFor(function () {
      return !documentNode.getElementById('result').hidden;
    }, 10000);

    const preview = documentNode.getElementById('preview').textContent;
    assert.ok(preview.includes('"schema": "telejson/v1"'));
    assert.ok(preview.includes('"chat": "Демо-чат TeleJSON"'));
    assert.ok(preview.includes('"reply_to": 1'));
    assert.ok(preview.includes('"forwarded_from": "Канал примеров"'));
    assert.ok(documentNode.getElementById('warnings-section').hidden);
    assert.match(documentNode.getElementById('status').textContent, /^Готово/);
    assert.equal(documentNode.querySelectorAll('#stats .stat').length, 5);
  } finally {
    dom.window.close();
  }
});

function waitFor(predicate, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const started = Date.now();
    const timer = setInterval(function () {
      let value = false;
      try {
        value = predicate();
      } catch (error) {
        clearInterval(timer);
        reject(error);
        return;
      }
      if (value) {
        clearInterval(timer);
        resolve(value);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('waitFor timeout'));
      }
    }, 25);
  });
}
