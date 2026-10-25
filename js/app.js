(function () {
  'use strict';

  const Core = window.TeleJSONCore;
  const numberFormatter = new Intl.NumberFormat('ru-RU');

  const state = {
    busy: false,
    fullJson: '',
    inputBytes: 0,
    outputBytes: 0,
    document: null,
    stats: null,
    warnings: [],
    fileName: 'telejson.json'
  };

  const elements = {};
  let initialized = false;

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;

    if (!Core) {
      const error = document.getElementById('error');
      if (error) {
        error.hidden = false;
        error.textContent = 'Не удалось загрузить модуль TeleJSON. Проверьте файлы js/telejson-core.js, js/example.js и js/app.js.';
      }
      return;
    }

    elements.dropzone = document.getElementById('dropzone');
    elements.fileInput = document.getElementById('file-input');
    elements.exampleButton = document.getElementById('example-button');
    elements.downloadButton = document.getElementById('download-button');
    elements.resetButton = document.getElementById('reset-button');
    elements.status = document.getElementById('status');
    elements.progress = document.getElementById('progress');
    elements.error = document.getElementById('error');
    elements.warningsSection = document.getElementById('warnings-section');
    elements.warningsList = document.getElementById('warnings-list');
    elements.warningsCount = document.getElementById('warnings-count');
    elements.result = document.getElementById('result');
    elements.resultSummary = document.getElementById('result-summary');
    elements.stats = document.getElementById('stats');
    elements.preview = document.getElementById('preview');
    elements.previewNote = document.getElementById('preview-note');
    elements.main = document.getElementById('main');

    const limitFile = document.querySelector('[data-limit-file]');
    const limitTotal = document.querySelector('[data-limit-total]');
    if (limitFile) {
      limitFile.textContent = formatBytes(Core.MAX_FILE_BYTES);
    }
    if (limitTotal) {
      limitTotal.textContent = formatBytes(Core.MAX_TOTAL_BYTES);
    }

    bindEvents();
    setStatus('Файлы не выбраны.');
    elements.progress.hidden = true;
  }

  function bindEvents() {
    elements.dropzone.addEventListener('click', function () {
      openFilePicker();
    });
    elements.dropzone.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openFilePicker();
      }
    });

    elements.fileInput.addEventListener('change', function () {
      const files = Array.from(elements.fileInput.files || []);
      elements.fileInput.value = '';
      if (files.length) {
        processFiles(files);
      }
    });

    ['dragenter', 'dragover'].forEach(function (type) {
      elements.dropzone.addEventListener(type, function (event) {
        if (state.busy) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'copy';
        }
        elements.dropzone.classList.add('is-dragging');
      });
    });

    elements.dropzone.addEventListener('dragleave', function (event) {
      if (!event.relatedTarget || !elements.dropzone.contains(event.relatedTarget)) {
        elements.dropzone.classList.remove('is-dragging');
      }
    });

    elements.dropzone.addEventListener('drop', function (event) {
      event.preventDefault();
      event.stopPropagation();
      elements.dropzone.classList.remove('is-dragging');
      if (state.busy) {
        return;
      }
      const files = event.dataTransfer ? Array.from(event.dataTransfer.files || []) : [];
      if (files.length) {
        processFiles(files);
      }
    });

    window.addEventListener('dragover', function (event) {
      if (hasFiles(event)) {
        event.preventDefault();
      }
    });

    window.addEventListener('drop', function (event) {
      if (hasFiles(event)) {
        event.preventDefault();
      }
    });

    elements.exampleButton.addEventListener('click', loadExample);
    elements.downloadButton.addEventListener('click', downloadJson);
    elements.resetButton.addEventListener('click', resetAll);
  }

  function hasFiles(event) {
    return Boolean(event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files'));
  }

  function openFilePicker() {
    if (state.busy) {
      return;
    }
    elements.fileInput.click();
  }

  function processFiles(fileList) {
    if (state.busy) {
      return;
    }

    const files = Array.from(fileList || []);
    if (!files.length) {
      return;
    }

    clearOutput();
    hideError();

    const unsupported = files.filter(function (file) {
      return !/\.html?$/i.test(file.name);
    });
    if (unsupported.length) {
      showError(
        'Поддерживаются только .html и .htm. Неподходящие файлы: ' +
        unsupported.map(function (file) { return file.name; }).join(', ') + '.',
        'Файл не принят.'
      );
      return;
    }

    const oversized = files.find(function (file) {
      return file.size > Core.MAX_FILE_BYTES;
    });
    if (oversized) {
      showError(
        'Файл «' + oversized.name + '» больше ' + formatBytes(Core.MAX_FILE_BYTES) +
        '. Обработка остановлена, чтобы не перегрузить браузер.',
        'Файл не принят.'
      );
      return;
    }

    const totalSize = files.reduce(function (total, file) {
      return total + file.size;
    }, 0);
    if (totalSize > Core.MAX_TOTAL_BYTES) {
      showError(
        'Суммарный размер файлов ' + formatBytes(totalSize) + ' больше ' +
        formatBytes(Core.MAX_TOTAL_BYTES) + '. Выберите меньшее количество частей.',
        'Файл не принят.'
      );
      return;
    }

    const sources = files.map(function (file) {
      return {
        name: file.name,
        byteLength: file.size,
        getText: function () { return readFileText(file); }
      };
    });

    return processSources(sources, { example: false });
  }

  function loadExample() {
    if (state.busy) {
      return;
    }
    const example = window.TeleJSONExample;
    if (!example || !Array.isArray(example.files) || !example.files.length) {
      showError('Встроенный синтетический пример недоступен.', 'Пример не загрузился.');
      return;
    }

    const sources = example.files.map(function (file) {
      return {
        name: file.name,
        byteLength: Core.utf8ByteLength(file.html),
        getText: function () { return file.html; }
      };
    });
    processSources(sources, { example: true });
  }

  async function processSources(sources, meta) {
    if (state.busy || !sources.length) {
      return;
    }

    const ordered = sources.slice().sort(function (left, right) {
      return Core.naturalCompare(left.name, right.name);
    });

    setBusy(true);
    clearOutput();
    hideError();
    setProgress(0, ordered.length);
    setStatus(meta && meta.example ? 'Подготовка синтетического примера…' : 'Подготовка файлов…');
    await nextFrame();

    try {
      const parts = [];
      let inputBytes = 0;

      for (let index = 0; index < ordered.length; index += 1) {
        const source = ordered[index];
        const position = (index + 1) + ' из ' + ordered.length + ': ' + source.name;

        setStatus((meta && meta.example ? 'Разбор ' : 'Чтение ') + position);
        setProgress(index, ordered.length);
        await nextFrame();

        let html;
        try {
          html = await source.getText();
        } catch (error) {
          throw new Error(
            'Не удалось прочитать «' + source.name + '»: ' +
            (error && error.message ? error.message : 'неизвестная ошибка') + '.'
          );
        }

        inputBytes += Number.isFinite(source.byteLength)
          ? source.byteLength
          : Core.utf8ByteLength(html);

        setStatus('Разбор ' + position);
        await nextFrame();

        const parsed = Core.parseExportHtml(html, {
          fileName: source.name,
          DOMParser: window.DOMParser
        });
        parts.push({ name: source.name, parsed: parsed });
        setProgress(index + 1, ordered.length);
      }

      setStatus('Сборка JSON…');
      await nextFrame();

      const result = Core.buildDocument(parts);
      const compactJson = JSON.stringify(result.document);
      renderResult(result, compactJson, Object.assign({}, meta || {}, {
        inputBytes: inputBytes
      }));
    } catch (error) {
      showError(
        error && error.message ? error.message : 'Не удалось обработать файлы.',
        'Обработка остановлена.'
      );
    } finally {
      setBusy(false);
    }
  }

  function readFileText(file) {
    if (typeof file.text === 'function') {
      return file.text();
    }
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ''));
      };
      reader.onerror = function () {
        reject(reader.error || new Error('ошибка чтения'));
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  function renderResult(result, compactJson, meta) {
    const outputBytes = Core.utf8ByteLength(compactJson);
    state.fullJson = compactJson;
    state.inputBytes = Number(meta.inputBytes) || 0;
    state.outputBytes = outputBytes;
    state.document = result.document;
    state.stats = result.stats;
    state.warnings = result.warnings.slice();
    state.fileName = Core.makeDownloadName(result.document.chat);

    const preview = Core.makeJsonPreview(result.document, Core.MAX_PREVIEW_CHARS);
    elements.preview.textContent = preview.text;
    elements.previewNote.textContent = preview.truncated
      ? 'Предпросмотр: первые ' + formatNumber(Core.MAX_PREVIEW_CHARS) +
        ' символов · скачиваемый JSON: ' + formatByteCount(outputBytes) + ' UTF-8'
      : 'Полный JSON · ' + formatByteCount(outputBytes) + ' UTF-8 · скачивается компактным';

    renderStats(result.stats);
    renderWarnings(result.warnings);

    const summary = [];
    if (meta.example) {
      summary.push('Синтетический пример');
    }
    summary.push('Компактный JSON');
    summary.push('Файлов: ' + formatNumber(result.stats.files));
    summary.push('Сообщений: ' + formatNumber(result.stats.messages));
    if (result.stats.service) {
      summary.push('Служебных: ' + formatNumber(result.stats.service));
    }
    summary.push('Вложений: ' + formatNumber(result.stats.attachments));
    if (state.inputBytes > 0) {
      const savedBytes = state.inputBytes - outputBytes;
      const savedPercent = (savedBytes / state.inputBytes) * 100;
      summary.push('JSON: ' + formatByteCount(outputBytes) + ' UTF-8');
      summary.push('HTML: ' + formatByteCount(state.inputBytes));
      summary.push(
        (savedBytes >= 0 ? '−' : '+') + formatPercent(Math.abs(savedPercent)) + ' к HTML'
      );
    }
    elements.resultSummary.textContent = summary.join(' · ');
    elements.result.hidden = false;
    elements.downloadButton.disabled = false;

    const statusLabel = 'Сообщений: ' + formatNumber(result.stats.messages) +
      '. Служебных: ' + formatNumber(result.stats.service) +
      '. Вложений: ' + formatNumber(result.stats.attachments) +
      '. Файлов: ' + formatNumber(result.stats.files) +
      '. JSON: ' + formatByteCount(outputBytes) + ' UTF-8.';
    setStatus(
      result.warnings.length
        ? 'Готово с предупреждениями. ' + statusLabel
        : 'Готово. ' + statusLabel
    );
  }

  function renderWarnings(warnings) {
    elements.warningsList.replaceChildren();
    if (!warnings.length) {
      elements.warningsSection.hidden = true;
      elements.warningsCount.textContent = '';
      return;
    }

    elements.warningsCount.textContent = formatNumber(warnings.length);
    for (const warning of warnings) {
      const item = document.createElement('li');
      item.textContent = warning;
      elements.warningsList.appendChild(item);
    }
    elements.warningsSection.hidden = false;
  }

  function renderStats(stats) {
    const definitions = [
      ['Сообщений', stats.messages],
      ['Служебных', stats.service],
      ['Вложений', stats.attachments],
      ['Файлов', stats.files],
      ['Удалено дублей', stats.duplicatesRemoved]
    ];

    elements.stats.replaceChildren();
    for (const definition of definitions) {
      const card = document.createElement('div');
      card.className = 'stat';

      const value = document.createElement('span');
      value.className = 'stat-value';
      value.textContent = formatNumber(definition[1]);

      const label = document.createElement('span');
      label.className = 'stat-label';
      label.textContent = definition[0];

      card.appendChild(value);
      card.appendChild(label);
      elements.stats.appendChild(card);
    }
  }

  function downloadJson() {
    if (!state.fullJson) {
      return;
    }

    try {
      const blob = new Blob([state.fullJson], {
        type: 'application/json;charset=utf-8'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = state.fileName;
      link.rel = 'noopener';
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 2000);
      setStatus(
        'Компактный JSON (' + formatByteCount(state.outputBytes) + ' UTF-8) подготовлен для скачивания.'
      );
    } catch (error) {
      showError(
        'Не удалось подготовить файл для скачивания: ' +
        (error && error.message ? error.message : 'неизвестная ошибка') + '.',
        'Скачивание недоступно.'
      );
    }
  }

  function resetAll() {
    if (state.busy) {
      return;
    }
    elements.fileInput.value = '';
    clearOutput();
    hideError();
    setStatus('Файлы не выбраны.');
    elements.progress.hidden = true;
    elements.progress.value = 0;
  }

  function clearOutput() {
    state.fullJson = '';
    state.inputBytes = 0;
    state.outputBytes = 0;
    state.document = null;
    state.stats = null;
    state.warnings = [];
    state.fileName = 'telejson.json';

    elements.result.hidden = true;
    elements.resultSummary.textContent = '';
    elements.stats.replaceChildren();
    elements.preview.textContent = '';
    elements.previewNote.textContent = '';
    elements.downloadButton.disabled = false;

    elements.warningsSection.hidden = true;
    elements.warningsList.replaceChildren();
    elements.warningsCount.textContent = '';
  }

  function setBusy(busy) {
    state.busy = busy;
    elements.exampleButton.disabled = busy;
    elements.downloadButton.disabled = busy;
    elements.resetButton.disabled = busy;
    elements.fileInput.disabled = busy;
    elements.dropzone.classList.toggle('is-disabled', busy);
    elements.dropzone.setAttribute('aria-disabled', busy ? 'true' : 'false');
    elements.dropzone.tabIndex = busy ? -1 : 0;
    elements.main.setAttribute('aria-busy', busy ? 'true' : 'false');
    elements.progress.hidden = !busy;
    if (!busy) {
      elements.dropzone.classList.remove('is-dragging');
    }
  }

  function setStatus(text) {
    elements.status.textContent = text;
  }

  function setProgress(value, max) {
    elements.progress.max = Math.max(1, max);
    elements.progress.value = Math.max(0, Math.min(value, max));
  }

  function hideError() {
    elements.error.hidden = true;
    elements.error.textContent = '';
  }

  function showError(message, statusText) {
    elements.error.textContent = message;
    elements.error.hidden = false;
    setStatus(statusText || 'Обработка остановлена.');
  }

  function formatBytes(bytes) {
    const megabytes = bytes / (1024 * 1024);
    return (Number.isInteger(megabytes) ? String(megabytes) : megabytes.toFixed(1)) + ' МБ';
  }

  function formatByteCount(bytes) {
    return formatNumber(bytes) + ' B';
  }

  function formatPercent(value) {
    return numberFormatter.format(Math.round(Number(value) * 10) / 10) + ' %';
  }

  function formatNumber(value) {
    return numberFormatter.format(Number(value) || 0);
  }

  function nextFrame() {
    return new Promise(function (resolve) {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(function () {
          resolve();
        });
      } else {
        window.setTimeout(resolve, 0);
      }
    });
  }

  window.TeleJSONApp = { init: init };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
