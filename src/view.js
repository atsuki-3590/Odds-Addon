/*
 * view.js — 結果の表示と設定フォーム（拡張のサイドパネルと、スマホ用ブックマークレットの結果ページで共通）
 *
 * 必要な要素の id: race, times, status, sections, thresholds, th-high, th-low, th-reset, only-strong
 * （sidepanel.html のマークアップを、ブックマークレットの結果ページもそのまま使う）
 * 計算は OddsCalc（src/calc.js）。chrome.* などの環境依存 API は使わない。
 *
 * state = {
 *   current: いま開いているページの解析結果（{ ok, type, meta, odds, absent, parsedAt, error }）または null,
 *   pages:   同じレースで読み取り済みのページ（{ '2tf': payload, '3t': payload, ... }）
 * }
 */
(function (root) {
  'use strict';

  const PAGE_NAMES = { '2tf': '2連単・2連複', '3t': '3連単', '3f': '3連複', k: '拡連複' };
  const PAGE_PATHS = { '2tf': 'odds2tf', '3t': 'odds3t', '3f': 'odds3f', k: 'oddsk' };

  const fmt = (v, digits) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—');
  const round3 = (v) => Math.round(v * 1000) / 1000;

  /** 同じレースの別ページの URL（公式サイトの PC 版） */
  function pageUrl(meta, type) {
    if (!meta || !meta.date || !meta.jcd || meta.raceNo == null || !PAGE_PATHS[type]) return null;
    return `https://www.boatrace.jp/owpc/pc/race/${PAGE_PATHS[type]}?rno=${meta.raceNo}&jcd=${meta.jcd}&hd=${meta.date}`;
  }

  function getEls(doc) {
    const $ = (id) => doc.getElementById(id);
    return {
      doc,
      race: $('race'),
      times: $('times'),
      status: $('status'),
      sections: $('sections'),
      form: $('thresholds'),
      high: $('th-high'),
      low: $('th-low'),
      reset: $('th-reset'),
      onlyStrong: $('only-strong'),
    };
  }

  function setStatus(els, text, isError) {
    els.status.textContent = text;
    els.status.classList.toggle('error', !!isError);
    els.status.hidden = !text;
  }

  function el(doc, tag, props, children) {
    const e = doc.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null) continue;
        if (k === 'text') e.textContent = v;
        else if (k === 'className') e.className = v;
        else e.setAttribute(k, v);
      }
    }
    for (const c of children || []) if (c) e.appendChild(c);
    return e;
  }

  /** 比較ごとの列の定義 */
  function columnsFor(section) {
    const sCell = (row) => {
      const text = fmt(row.s, 2);
      const nominal = section.id === '2t2f' ? 2 : section.id === '3t3f' ? 6 : 4;
      return row.s !== null && row.n !== nominal ? `${text}（${row.n}点）` : text;
    };
    const rCell = (row) => (row.rRange ? `${fmt(row.rRange[0], 2)}-${fmt(row.rRange[1], 2)}` : fmt(row.r, 3));
    const singleCell = (row) => (Array.isArray(row.single) ? `${fmt(row.single[0], 1)}-${fmt(row.single[1], 1)}` : fmt(row.single, 1));
    if (section.id === '2t2f') {
      return [
        ['組', (r) => r.key, 'Left'],
        ['a', (r) => fmt(r.a, 1), '', '2連単 i→j'],
        ['b', (r) => fmt(r.b, 1), '', '2連単 j→i'],
        ['合成S', sCell, '', '1/(1/a+1/b)'],
        ['2連複', singleCell],
        ['R', rCell, 'r', '2連複 / 合成S'],
      ];
    }
    return [
      ['組', (r) => r.key, 'Left'],
      [`${section.multi}合成`, sCell, '', '1/Σ(1/オッズ)'],
      [section.single, singleCell],
      ['R', rCell, 'r', `${section.single} / 合成`],
    ];
  }

  function verdictText(section, better, row) {
    if (row.absent) return '欠場';
    if (better === 'single') return section.single;
    if (better === 'multi') return section.multi;
    if (better === 'mixed') return '結果次第';
    if (better === 'even') return '同等';
    return '—';
  }

  function sourcesLine(section, pages) {
    return section.needs
      .map((t) => {
        const m = (pages[t] && pages[t].meta) || {};
        return `${PAGE_NAMES[t]} ${m.updatedAt || (m.oddsLabel === '締切時オッズ' ? '締切時' : '—')}`;
      })
      .join(' · ');
  }

  function renderSection(els, section, pages, settings, opts) {
    const { classify, absentBoats, timeGapWarning } = root.OddsCalc;
    const doc = els.doc;
    const wrap = el(doc, 'section', { className: 'cmp', 'data-id': section.id });
    wrap.appendChild(el(doc, 'h2', { text: section.title }));

    const missing = section.needs.filter((t) => !(pages[t] && pages[t].ok));
    if (missing.length) {
      const anyMeta = Object.values(pages).map((p) => p && p.meta).find(Boolean);
      const p = el(doc, 'p', { className: 'missing', text: `${missing.map((t) => PAGE_NAMES[t]).join('・')}のページを開くと表示されます。` });
      wrap.appendChild(p);
      const links = el(doc, 'p', { className: 'open-links' });
      for (const t of missing) {
        const url = pageUrl(anyMeta, t);
        if (!url) continue;
        const a = el(doc, 'a', { href: url, text: `${PAGE_NAMES[t]}を開く` });
        if (opts && opts.openPage) {
          a.addEventListener('click', (e) => {
            e.preventDefault();
            opts.openPage(url);
          });
        }
        links.appendChild(a);
      }
      if (links.childNodes.length) wrap.appendChild(links);
      return wrap;
    }

    wrap.appendChild(el(doc, 'p', { className: 'sources', text: sourcesLine(section, pages) }));
    if (section.needs.length > 1) {
      const warn = timeGapWarning(section.needs.map((t) => pages[t].meta));
      if (warn) wrap.appendChild(el(doc, 'p', { className: 'warn', text: warn }));
    }

    const rows = section.compute(pages, absentBoats(pages));
    const notes = [];
    const absentCount = rows.filter((r) => r.absent).length;
    const naCount = rows.filter((r) => !r.absent && r.r === null && !r.rRange).length;
    if (absentCount) notes.push(`${absentCount}組は欠場艇を含むため対象外`);
    if (naCount) notes.push(`${naCount}組は発売票数0などで計算できません`);

    const columns = columnsFor(section);
    const tbody = el(doc, 'tbody');
    let shown = 0;
    for (const row of rows) {
      const shownR = row.rRange ? row.rRange.map(round3) : row.r === null ? null : round3(row.r);
      const { better, strong } = classify(shownR, settings.thresholds);
      if (settings.onlyStrong && !strong) continue;
      shown++;
      const tr = el(doc, 'tr', { className: better === null || row.absent ? 'na' : `${better} ${strong ? 'strong' : 'weak'}` });
      for (const [, get, cls] of columns) {
        tr.appendChild(el(doc, 'td', { className: cls === 'Left' ? 'left' : cls || null, text: get(row) }));
      }
      tr.appendChild(el(doc, 'td', { className: 'left', text: verdictText(section, better, row) }));
      tbody.appendChild(tr);
    }

    if (shown === 0) {
      wrap.appendChild(el(doc, 'p', { className: 'missing', text: rows.some((r) => sortable(r)) ? 'しきい値を超えた組はありません。' : '計算できる組がありません。' }));
    } else {
      const headRow = el(doc, 'tr');
      for (const [label, , cls, title] of columns) {
        headRow.appendChild(el(doc, 'th', { className: cls === 'Left' ? 'left' : null, title: title || null, text: label }));
      }
      headRow.appendChild(el(doc, 'th', { className: 'left', text: '得な買い方' }));
      wrap.appendChild(el(doc, 'table', null, [el(doc, 'thead', null, [headRow]), tbody]));
    }
    if (notes.length) wrap.appendChild(el(doc, 'p', { className: 'note', text: `${notes.join('、')}。` }));
    return wrap;
  }

  const sortable = (r) => r.r !== null || !!r.rRange;

  /**
   * 描画する。settings = { thresholds: {high, low}, onlyStrong: boolean }
   * opts.openPage(url): 「〇〇を開く」リンクを押したときの処理（省略時は普通のリンク）
   */
  function render(els, state, settings, opts) {
    const doc = els.doc;
    const current = state && state.current;
    const pages = (state && state.pages) || {};
    els.sections.replaceChildren();

    if (!current) {
      els.race.textContent = '—';
      els.times.textContent = '';
      setStatus(els, 'オッズページ（2連単・2連複／3連単／3連複／拡連複）を開いてください。', false);
      return;
    }

    const meta = current.meta || {};
    const venue = meta.venue || '';
    const raceNo = meta.raceNo != null ? `${meta.raceNo}R` : '';
    const title = [venue, raceNo].filter(Boolean).join(' ');
    els.race.textContent = title ? (meta.raceTitle ? `${title}　${meta.raceTitle}` : title) : '—';
    const parts = [];
    if (meta.date && /^\d{8}$/.test(meta.date)) parts.push(`${Number(meta.date.slice(4, 6))}/${Number(meta.date.slice(6, 8))}`);
    if (meta.deadline) parts.push(`締切予定 ${meta.deadline}`);
    if (current.parsedAt) parts.push(`読取 ${new Date(current.parsedAt).toLocaleTimeString('ja-JP')}`);
    els.times.textContent = parts.join(' · ');

    if (!current.ok) {
      setStatus(els, `ページを解析できませんでした: ${current.error}`, true);
      return;
    }
    if (!current.type) {
      setStatus(els, meta.notice || 'このページは対象外です（2連単・2連複／3連単／3連複／拡連複のオッズページで使えます）。', false);
      return;
    }
    const hasOdds = Object.values(current.odds || {}).some((o) => o && Object.keys(o).length);
    if (!hasOdds) {
      setStatus(els, meta.notice || 'オッズが表示されていません（発売前・データなしなど）。', false);
      return;
    }
    setStatus(els, '', false);

    // 必要なページがそろっている比較を先に、いま開いているページを使う比較を優先して並べる
    const { SECTIONS } = root.OddsCalc;
    const ready = (s) => s.needs.every((t) => pages[t] && pages[t].ok);
    const uses = (s) => s.needs.includes(current.type);
    const ordered = [...SECTIONS].sort((a, b) => (ready(b) - ready(a)) || (uses(b) - uses(a)));
    const frag = doc.createDocumentFragment();
    for (const s of ordered) frag.appendChild(renderSection(els, s, pages, settings, opts));
    els.sections.appendChild(frag);
  }

  /**
   * 設定フォーム（しきい値・強調行だけ表示）を結びつける。
   * storage: { load: () => Promise<object|undefined>, save: (settings) => void }
   * onChange({ thresholds, onlyStrong }) は初期化時と変更のたびに呼ばれる。
   */
  async function bindSettings(els, storage, onChange) {
    const { normalizeThresholds, DEFAULT_THRESHOLDS } = root.OddsCalc;
    let settings = { thresholds: { ...DEFAULT_THRESHOLDS }, onlyStrong: false };

    const show = () => {
      els.high.value = settings.thresholds.high.toFixed(2);
      els.low.value = settings.thresholds.low.toFixed(2);
      els.onlyStrong.checked = settings.onlyStrong;
    };
    const apply = (next) => {
      settings = next;
      storage.save({ ...settings.thresholds, onlyStrong: settings.onlyStrong });
      onChange(settings);
    };
    const onInput = () => {
      const next = { high: Number(els.high.value), low: Number(els.low.value) };
      const normalized = normalizeThresholds(next);
      // 不正な入力中（例: 空欄）は保存せず、確定時に正規化した値へ戻す
      if (normalized.high !== next.high || normalized.low !== next.low) return;
      apply({ ...settings, thresholds: normalized });
    };

    els.high.addEventListener('input', onInput);
    els.low.addEventListener('input', onInput);
    els.high.addEventListener('change', show);
    els.low.addEventListener('change', show);
    els.onlyStrong.addEventListener('change', () => apply({ ...settings, onlyStrong: els.onlyStrong.checked }));
    els.form.addEventListener('submit', (e) => e.preventDefault());
    els.reset.addEventListener('click', () => {
      apply({ ...settings, thresholds: { ...DEFAULT_THRESHOLDS } });
      show();
    });

    let saved;
    try {
      saved = await storage.load();
    } catch (_) {
      saved = undefined;
    }
    settings = { thresholds: normalizeThresholds(saved), onlyStrong: !!(saved && saved.onlyStrong) };
    show();
    onChange(settings);
  }

  const api = { PAGE_NAMES, PAGE_PATHS, pageUrl, getEls, render, bindSettings };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OddsView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
