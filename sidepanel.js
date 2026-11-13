/*
 * sidepanel.js — アクティブなタブの解析結果を chrome.storage.session から読み、表を描画する
 * 計算は OddsCalc（src/calc.js）で行うので、しきい値を変えると即座に再描画される。
 */
(function () {
  'use strict';

  const { computeRows, classify, normalizeThresholds, DEFAULT_THRESHOLDS } = globalThis.OddsCalc;

  const $ = (id) => document.getElementById(id);
  const els = {
    race: $('race'),
    times: $('times'),
    status: $('status'),
    table: $('table'),
    rows: $('rows'),
    form: $('thresholds'),
    high: $('th-high'),
    low: $('th-low'),
    reset: $('th-reset'),
  };

  let thresholds = { ...DEFAULT_THRESHOLDS };
  let currentTabId = null;
  let currentPayload = null;

  const fmt = (v, digits) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—');

  const LABELS = {
    quinella: '2連複',
    exacta: '2連単2点',
    even: '同等',
  };

  function setStatus(text, isError) {
    els.status.textContent = text;
    els.status.classList.toggle('error', !!isError);
    els.status.hidden = !text;
  }

  function render() {
    const p = currentPayload;
    els.rows.replaceChildren();

    if (!p) {
      els.race.textContent = '—';
      els.times.textContent = '';
      els.table.hidden = true;
      setStatus('2連単・2連複のオッズページを開いてください。', false);
      return;
    }

    const meta = p.meta || {};
    const venue = meta.venue || '';
    const raceNo = meta.raceNo != null ? `${meta.raceNo}R` : '';
    els.race.textContent = [venue, raceNo].filter(Boolean).join(' ') || '—';
    const parts = [];
    if (meta.updatedAt) parts.push(`オッズ時刻: ${meta.updatedAt}`);
    if (p.parsedAt) parts.push(`解析: ${new Date(p.parsedAt).toLocaleTimeString('ja-JP')}`);
    els.times.textContent = parts.join(' / ');

    if (!p.ok) {
      els.table.hidden = true;
      setStatus(`ページを解析できませんでした: ${p.error}`, true);
      return;
    }

    const rows = computeRows(p.odds);
    const computable = rows.filter((r) => r.r !== null).length;
    setStatus(computable === 0 ? '計算できる組がありません（発売前・欠場など）。' : '', false);

    const frag = document.createDocumentFragment();
    for (const row of rows) {
      const { better, strong } = classify(row.r, thresholds);
      const tr = document.createElement('tr');
      if (better === null) tr.className = 'na';
      else tr.className = `${better} ${strong ? 'strong' : 'weak'}`;

      const cells = [
        [row.pair, ''],
        [fmt(row.a, 1), ''],
        [fmt(row.b, 1), ''],
        [fmt(row.s, 2), ''],
        [fmt(row.c, 1), ''],
        [fmt(row.r, 3), 'r'],
        [better ? LABELS[better] : '—', ''],
      ];
      for (const [text, cls] of cells) {
        const td = document.createElement('td');
        td.textContent = text;
        if (cls) td.className = cls;
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }
    els.rows.appendChild(frag);
    els.table.hidden = false;
  }

  async function loadForActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    currentTabId = tab ? tab.id : null;
    if (currentTabId == null) {
      currentPayload = null;
    } else {
      const key = `tab:${currentTabId}`;
      const data = await chrome.storage.session.get(key);
      currentPayload = data[key] || null;
    }
    render();
  }

  // ---- しきい値 ----
  function showThresholds() {
    els.high.value = thresholds.high.toFixed(2);
    els.low.value = thresholds.low.toFixed(2);
  }

  async function loadThresholds() {
    const { thresholds: saved } = await chrome.storage.local.get('thresholds');
    thresholds = normalizeThresholds(saved);
    showThresholds();
  }

  function onThresholdInput() {
    const next = { high: Number(els.high.value), low: Number(els.low.value) };
    const normalized = normalizeThresholds(next);
    // 不正な入力中（例: 空欄）は保存せず、確定時に正規化した値へ戻す
    if (normalized.high !== next.high || normalized.low !== next.low) return;
    thresholds = normalized;
    chrome.storage.local.set({ thresholds });
    render();
  }

  els.high.addEventListener('input', onThresholdInput);
  els.low.addEventListener('input', onThresholdInput);
  els.high.addEventListener('change', showThresholds);
  els.low.addEventListener('change', showThresholds);
  els.form.addEventListener('submit', (e) => e.preventDefault());
  els.reset.addEventListener('click', () => {
    thresholds = { ...DEFAULT_THRESHOLDS };
    chrome.storage.local.set({ thresholds });
    showThresholds();
    render();
  });

  // ---- 変更の監視 ----
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || currentTabId == null) return;
    const key = `tab:${currentTabId}`;
    if (key in changes) {
      currentPayload = changes[key].newValue || null;
      render();
    }
  });
  chrome.tabs.onActivated.addListener(loadForActiveTab);
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) loadForActiveTab();
  });

  loadThresholds().then(loadForActiveTab);
})();
