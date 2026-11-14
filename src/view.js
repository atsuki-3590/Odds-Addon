/*
 * view.js — 結果の表示としきい値フォーム（拡張のサイドパネルと、スマホ用ブックマークレットの結果ページで共通）
 *
 * 必要な要素の id: race, times, status, table, rows, thresholds, th-high, th-low, th-reset
 * （sidepanel.html と bookmarklet/result.html が同じマークアップを持つ）
 * 計算は OddsCalc（src/calc.js）。chrome.* などの環境依存 API は使わない。
 */
(function (root) {
  'use strict';

  const LABELS = { quinella: '2連複', exacta: '2連単2点', even: '同等' };

  const fmt = (v, digits) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—');

  function getEls(doc) {
    const $ = (id) => doc.getElementById(id);
    return {
      doc,
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
  }

  function setStatus(els, text, isError) {
    els.status.textContent = text;
    els.status.classList.toggle('error', !!isError);
    els.status.hidden = !text;
  }

  /**
   * payload: { ok, meta, odds, parsedAt, error } または null（対象ページでない）
   */
  function render(els, payload, thresholds) {
    const { computeRows, classify } = root.OddsCalc;
    const p = payload;
    els.rows.replaceChildren();

    if (!p) {
      els.race.textContent = '—';
      els.times.textContent = '';
      els.table.hidden = true;
      setStatus(els, '2連単・2連複のオッズページを開いてください。', false);
      return;
    }

    const meta = p.meta || {};
    const venue = meta.venue || '';
    const raceNo = meta.raceNo != null ? `${meta.raceNo}R` : '';
    const title = [venue, raceNo].filter(Boolean).join(' ');
    els.race.textContent = title ? (meta.raceTitle ? `${title}　${meta.raceTitle}` : title) : '—';
    const parts = [];
    if (meta.date && /^\d{8}$/.test(meta.date)) {
      parts.push(`${Number(meta.date.slice(4, 6))}/${Number(meta.date.slice(6, 8))}`);
    }
    if (meta.deadline) parts.push(`締切予定 ${meta.deadline}`);
    if (meta.updatedAt) parts.push(`オッズ更新 ${meta.updatedAt}`);
    else if (meta.oddsLabel) parts.push(meta.oddsLabel);
    if (p.parsedAt) parts.push(`読取 ${new Date(p.parsedAt).toLocaleTimeString('ja-JP')}`);
    els.times.textContent = parts.join(' · ');

    if (!p.ok) {
      els.table.hidden = true;
      setStatus(els, `ページを解析できませんでした: ${p.error}`, true);
      return;
    }

    const rows = computeRows(p.odds);
    const computable = rows.filter((r) => r.r !== null).length;
    if (computable === 0) {
      els.table.hidden = true;
      setStatus(els, meta.notice || '計算できる組がありません（発売前・データなしなど）。', false);
      return;
    }
    const skipped = rows.length - computable;
    setStatus(els, skipped > 0 ? `${skipped}組は欠場・発売票数0などで計算対象外です。` : '', false);

    const doc = els.doc;
    const frag = doc.createDocumentFragment();
    for (const row of rows) {
      // 表示している小数3桁の値で判定する（「0.900」と表示されているのに強調されない、を防ぐ）
      const shownR = row.r === null ? null : Math.round(row.r * 1000) / 1000;
      const { better, strong } = classify(shownR, thresholds);
      const tr = doc.createElement('tr');
      tr.className = better === null ? 'na' : `${better} ${strong ? 'strong' : 'weak'}`;

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
        const td = doc.createElement('td');
        td.textContent = text;
        if (cls) td.className = cls;
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }
    els.rows.appendChild(frag);
    els.table.hidden = false;
  }

  /**
   * しきい値フォームを結びつける。
   * storage: { load: () => Promise<object|undefined>, save: (t) => void }
   * onChange(thresholds) は初期化時と変更のたびに呼ばれる。
   */
  async function bindThresholds(els, storage, onChange) {
    const { normalizeThresholds, DEFAULT_THRESHOLDS } = root.OddsCalc;
    let thresholds = { ...DEFAULT_THRESHOLDS };

    const show = () => {
      els.high.value = thresholds.high.toFixed(2);
      els.low.value = thresholds.low.toFixed(2);
    };
    const apply = (t, persist) => {
      thresholds = t;
      if (persist) storage.save(thresholds);
      onChange(thresholds);
    };
    const onInput = () => {
      const next = { high: Number(els.high.value), low: Number(els.low.value) };
      const normalized = normalizeThresholds(next);
      // 不正な入力中（例: 空欄）は保存せず、確定時に正規化した値へ戻す
      if (normalized.high !== next.high || normalized.low !== next.low) return;
      apply(normalized, true);
    };

    els.high.addEventListener('input', onInput);
    els.low.addEventListener('input', onInput);
    els.high.addEventListener('change', show);
    els.low.addEventListener('change', show);
    els.form.addEventListener('submit', (e) => e.preventDefault());
    els.reset.addEventListener('click', () => {
      apply({ ...DEFAULT_THRESHOLDS }, true);
      show();
    });

    let saved;
    try {
      saved = await storage.load();
    } catch (_) {
      saved = undefined;
    }
    thresholds = normalizeThresholds(saved);
    show();
    onChange(thresholds);
  }

  const api = { getEls, render, bindThresholds, LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OddsView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
