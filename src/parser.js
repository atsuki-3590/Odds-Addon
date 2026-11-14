/*
 * parser.js — オッズページの Document からオッズを取り出す純粋関数
 *
 * 対象ページ（/owpc/pc/race/<種類>?rno=&jcd=&hd=）:
 *   odds2tf 2連単・2連複 / odds3t 3連単 / odds3f 3連複 / oddsk 拡連複
 *
 *   parsePage(doc)     → { type: '2tf'|'3t'|'3f'|'k'|null, meta, odds, absent }
 *     odds（type ごと）:
 *       2tf: { a: {"1-2": 5.3, ...}, c: {"1=2": 3.1, ...} }
 *       3t : { t: {"1-2-3": 12.1, ...} }
 *       3f : { f: {"1=2=3": 5.9, ...} }（艇番は昇順）
 *       k  : { k: {"1=2": [2.2, 3.0], ...} }（拡連複は [下限, 上限]）
 *     absent: 欠場艇の艇番（その艇を含むセルがすべて「欠場」のもの）
 *   parseOdds(doc)     → 2連単・2連複だけを読む（{ a, c }）
 *   parseRaceMeta(doc) → { venue, jcd, raceNo, date, updatedAt, oddsLabel, deadline, raceTitle, notice }
 *
 * 数値でない値（欠場・発売票数0の「0.0」・「-」・空欄など）はキーごと出力しない（エラーにしない）。
 *
 * ページ構造（fixtures/ の保存 HTML で確認。場による違いはない）:
 *   <div class="title7"><h3><span class="title7_mainLabel">2連単オッズ</span></h3></div>
 *   <div class="table1"><table>
 *     <thead> 1列目の艇番 th が 1〜6 の順に並ぶ（艇番 th と選手名 th が交互）
 *   2連単・2連複・拡連複（2艇の表）:
 *     <tbody> 各行は「相手艇番 td + td.oddsPoint」の組が 6 列分。列 k が 1着（連複系は組の一方）
 *   3連単・3連複（3艇の表）:
 *     2着艇の td が rowspan=4 で4行をまとめる。ブロック先頭行は列ごとに「2着 td + 3着 td + td.oddsPoint」の3セル、
 *     残りの行は「3着 td + td.oddsPoint」の2セル。3連複は下三角以外が td.is-disabled
 *   欠場は td.oddsPoint.is-miss に「欠場」。1000倍以上は「1244」のように小数点なし。拡連複は「2.2-3.0」。
 *
 * 使う DOM API は getElementsByClassName / getElementsByTagName / children / parentElement /
 * nextElementSibling / textContent / getAttribute / classList.contains のみ
 * （テストでは依存なしの test/helpers/mini-dom.js で同じ API を提供する）。
 */
(function (root) {
  'use strict';

  const LABELS = {
    exacta: '2連単オッズ',
    quinella: '2連複オッズ',
    trifecta: '3連単オッズ',
    trio: '3連複オッズ',
    wide: '拡連複オッズ',
  };

  // オッズ種別タブ（li.is-active）の表示 / URL のパス名 → ページの種類
  const TAB_TYPES = { '2連単・2連複': '2tf', '3連単': '3t', '3連複': '3f', '拡連複': 'k' };
  const PATH_TYPES = { odds2tf: '2tf', odds3t: '3t', odds3f: '3f', oddsk: 'k' };

  // jcd → レース場名（ページから場名が取れなかったときの予備）
  const VENUES = {
    '01': '桐生', '02': '戸田', '03': '江戸川', '04': '平和島', '05': '多摩川', '06': '浜名湖',
    '07': '蒲郡', '08': '常滑', '09': '津', '10': '三国', '11': 'びわこ', '12': '住之江',
    '13': '尼崎', '14': '鳴門', '15': '丸亀', '16': '児島', '17': '宮島', '18': '徳山',
    '19': '下関', '20': '若松', '21': '芦屋', '22': '福岡', '23': '唐津', '24': '大村',
  };

  /** 空白（全角スペース含む）を1つにまとめて前後を削る */
  function norm(text) {
    return String(text == null ? '' : text).replace(/[\s　 ]+/g, ' ').trim();
  }

  /**
   * セルの文字列をオッズ数値に変換。数値として読めなければ null。
   * 例: "5.3" → 5.3, " 12.0 " → 12, "1244" → 1244, "1,234.5" → 1234.5, "-" / "欠場" / "0.0" / "" → null
   */
  function parseOddsText(text) {
    if (typeof text !== 'string') return null;
    const t = text.replace(/[\s, 　]/g, '');
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    const v = Number(t);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  /** "1"〜"6" なら艇番、それ以外は null */
  function parseBoat(text) {
    const t = norm(text);
    return /^[1-6]$/.test(t) ? Number(t) : null;
  }

  const hasClass = (el, c) => !!(el && el.classList && el.classList.contains(c));
  const first = (list) => (list && list.length ? list[0] : null);

  function ancestorWithClass(el, cls) {
    for (let p = el; p; p = p.parentElement) if (hasClass(p, cls)) return p;
    return null;
  }

  /** 見出し「2連単オッズ」などの直後にある .table1 内の table を探す */
  function findOddsTable(doc, label) {
    for (const span of Array.from(doc.getElementsByClassName('title7_mainLabel'))) {
      if (norm(span.textContent) !== label) continue;
      const heading = ancestorWithClass(span, 'title7') || span;
      for (let el = heading.nextElementSibling; el && !hasClass(el, 'title7'); el = el.nextElementSibling) {
        const table = hasClass(el, 'table1') ? first(el.getElementsByTagName('table')) : null;
        if (table) return table;
      }
    }
    return null;
  }

  /** "2.2-3.0" → [2.2, 3.0]（拡連複）。読めなければ null */
  function parseRangeText(text) {
    if (typeof text !== 'string') return null;
    const m = /^([^-]+)-([^-]+)$/.exec(text.replace(/[\s\u00a0\u3000]/g, ''));
    if (!m) return null;
    const lo = parseOddsText(m[1]);
    const hi = parseOddsText(m[2]);
    return lo !== null && hi !== null && lo <= hi ? [lo, hi] : null;
  }

  function headerBoats(table) {
    const thead = first(table.getElementsByTagName('thead'));
    return thead
      ? Array.from(thead.getElementsByTagName('th')).map((th) => parseBoat(th.textContent)).filter((b) => b !== null)
      : [];
  }

  const bodyRows = (table) =>
    Array.from(table.getElementsByTagName('tbody')).flatMap((tb) => Array.from(tb.getElementsByTagName('tr')));

  /**
   * 2艇の表（2連単・2連複・拡連複）を走査し、オッズのセルごとに visit({ boats: [列の艇, 相手艇], cell }) を呼ぶ。
   * 列と艇番の対応は thead の艇番 th から読む（1〜6 が並んでいる前提をハードコードしない）。
   */
  function walkPairGrid(table, visit) {
    const columns = headerBoats(table);
    for (const tr of bodyRows(table)) {
      const cells = Array.from(tr.children);
      for (let k = 0; k < columns.length; k++) {
        const boatCell = cells[2 * k];
        const oddsCell = cells[2 * k + 1];
        if (!boatCell || !hasClass(oddsCell, 'oddsPoint')) continue;
        const other = parseBoat(boatCell.textContent);
        if (other === null || other === columns[k]) continue;
        visit({ boats: [columns[k], other], cell: oddsCell });
      }
    }
  }

  /**
   * 3艇の表（3連単・3連複）を走査する。rowspan=4 の2着艇 td があるブロック先頭行は1列3セル、
   * それ以外の行は1列2セル。列ごとに直前のブロックの2着艇を覚えておく。
   */
  function walkTripleGrid(table, visit) {
    const columns = headerBoats(table);
    const n = columns.length;
    const second = new Array(n).fill(null);
    for (const tr of bodyRows(table)) {
      const cells = Array.from(tr.children);
      let width;
      if (cells.length === 3 * n) width = 3;
      else if (cells.length === 2 * n) width = 2;
      else continue;
      for (let k = 0; k < n; k++) {
        const base = width * k;
        if (width === 3) second[k] = parseBoat(cells[base].textContent);
        const thirdCell = cells[base + width - 2];
        const oddsCell = cells[base + width - 1];
        if (second[k] === null || !hasClass(oddsCell, 'oddsPoint')) continue;
        const third = parseBoat(thirdCell.textContent);
        const boats = [columns[k], second[k], third];
        if (third === null || new Set(boats).size !== 3) continue;
        visit({ boats, cell: oddsCell });
      }
    }
  }

  /** 欠場セルの集計から、欠場艇（その艇を含むセルがすべて is-miss）を求める */
  function absentTracker() {
    const total = {};
    const miss = {};
    return {
      add(boats, isMiss) {
        for (const b of boats) {
          total[b] = (total[b] || 0) + 1;
          if (isMiss) miss[b] = (miss[b] || 0) + 1;
        }
      },
      result: () => Object.keys(total).map(Number).filter((b) => miss[b] === total[b]).sort((x, y) => x - y),
    };
  }

  /**
   * 表を読んで { key: 値 } にする。
   * keyOf(boats) でキーを作り、valueOf(text) で値を読む（null なら除外）。
   */
  function readTable(table, walk, keyOf, valueOf, absent) {
    const out = {};
    if (!table) return out;
    walk(table, ({ boats, cell }) => {
      const isMiss = hasClass(cell, 'is-miss');
      absent.add(boats, isMiss);
      if (isMiss) return;
      const v = valueOf(cell.textContent);
      if (v !== null) out[keyOf(boats)] = v;
    });
    return out;
  }

  const ordered = (boats) => boats.join('-');
  const unordered = (boats) => [...boats].sort((x, y) => x - y).join('=');

  function parseOddsWithAbsent(doc, type) {
    const absent = absentTracker();
    let odds;
    switch (type) {
      case '2tf':
        odds = {
          a: readTable(findOddsTable(doc, LABELS.exacta), walkPairGrid, ordered, parseOddsText, absent),
          c: readTable(findOddsTable(doc, LABELS.quinella), walkPairGrid, unordered, parseOddsText, absent),
        };
        break;
      case '3t':
        odds = { t: readTable(findOddsTable(doc, LABELS.trifecta), walkTripleGrid, ordered, parseOddsText, absent) };
        break;
      case '3f':
        odds = { f: readTable(findOddsTable(doc, LABELS.trio), walkTripleGrid, unordered, parseOddsText, absent) };
        break;
      case 'k':
        odds = { k: readTable(findOddsTable(doc, LABELS.wide), walkPairGrid, unordered, parseRangeText, absent) };
        break;
      default:
        odds = {};
    }
    return { odds, absent: absent.result() };
  }

  /**
   * Document → { a: {"i-j": オッズ}, c: {"i=j": オッズ（i<j）} }（2連単・2連複のページ用）
   * 表が見つからない（発売前・データなしなど）場合は空のオブジェクトを返す。
   */
  function parseOdds(doc) {
    return parseOddsWithAbsent(doc, '2tf').odds;
  }

  /** ページの種類を判定する（オッズ種別タブの選択中の項目 → URL のパス名の順） */
  function detectPageType(doc) {
    for (const tabs of Array.from(doc.getElementsByClassName('tab4_tabs'))) {
      for (const li of Array.from(tabs.getElementsByTagName('li'))) {
        if (!hasClass(li, 'is-active')) continue;
        const t = TAB_TYPES[norm(li.textContent)];
        if (t) return t;
      }
    }
    const m = /\/race\/([a-z0-9]+)\?/i.exec(doc.URL || (doc.location && doc.location.href) || '');
    return (m && PATH_TYPES[m[1]]) || null;
  }

  /** ページの種類・レース情報・オッズ・欠場艇をまとめて読む */
  function parsePage(doc) {
    const type = detectPageType(doc);
    const { odds, absent } = parseOddsWithAbsent(doc, type);
    return { type, meta: parseRaceMeta(doc), odds, absent };
  }

  /** レースを一意に表すキー（日付_場_レース番号）。読めなければ null */
  function raceKey(meta) {
    return meta && meta.date && meta.jcd && meta.raceNo != null ? `${meta.date}_${meta.jcd}_${meta.raceNo}` : null;
  }

  /** URL / href からレースのパラメータ（rno, jcd, hd）を読む */
  function raceParams(href) {
    if (!href) return null;
    const get = (k) => {
      const m = new RegExp(`[?&](?:amp;)?${k}=(\\d+)`).exec(href);
      return m ? m[1] : null;
    };
    const rno = get('rno');
    const jcd = get('jcd');
    const hd = get('hd');
    return rno && jcd && hd ? { rno, jcd, hd } : null;
  }

  function findRaceParams(doc) {
    // 1) オッズ種別タブ・更新ボタンのリンク（保存した HTML でも残る）
    for (const area of Array.from(doc.getElementsByClassName('tab4'))) {
      for (const a of Array.from(area.getElementsByTagName('a'))) {
        const p = raceParams(a.getAttribute('href'));
        if (p) return p;
      }
    }
    // 2) ページ自身の URL
    return raceParams(doc.URL || (doc.location && doc.location.href) || '');
  }

  /**
   * 締切予定時刻の行から、表示中レースの時刻を読む。
   * （is-activeColor1 は「現在発売中のレース」の印で、表示中のレースとは限らないので使わない）
   * 見出し行「レース | 1R | 2R …」と「締切予定時刻 | 15:16 | …」は先頭セルがどちらも colspan=2 なので列番号が揃う。
   */
  function findDeadline(doc, raceNo) {
    if (raceNo == null) return null;
    for (const td of Array.from(doc.getElementsByTagName('td'))) {
      if (norm(td.textContent) !== '締切予定時刻' || !td.parentElement) continue;
      const table = ancestorWithTag(td, 'TABLE');
      const thead = table && first(table.getElementsByTagName('thead'));
      if (!thead) return null;
      const heads = Array.from(thead.getElementsByTagName('th'));
      const idx = heads.findIndex((th) => norm(th.textContent) === `${raceNo}R`);
      const cell = idx >= 0 ? td.parentElement.children[idx] : null;
      const m = cell ? /(\d{1,2}:\d{2})/.exec(cell.textContent) : null;
      return m ? m[1] : null;
    }
    return null;
  }

  function ancestorWithTag(el, tag) {
    for (let p = el; p; p = p.parentElement) if (p.tagName === tag) return p;
    return null;
  }

  function parseRaceMeta(doc) {
    const params = findRaceParams(doc);
    const jcd = params ? params.jcd : null;
    const raceNo = params ? Number(params.rno) : null;

    let venue = null;
    const area = first(doc.getElementsByClassName('heading2_area'));
    if (area) {
      const img = first(area.getElementsByTagName('img'));
      venue = norm((img && img.getAttribute('alt')) || area.textContent) || null;
    }
    if (!venue && jcd) venue = VENUES[jcd] || null;

    // 発売中: 「オッズ更新時間 18:55」 / 締切後: 「締切時オッズ」
    let updatedAt = null;
    let oddsLabel = null;
    const refresh = first(doc.getElementsByClassName('tab4_refreshText'));
    if (refresh) {
      const m = /(\d{1,2}:\d{2})/.exec(refresh.textContent);
      updatedAt = m ? m[1] : null;
      oddsLabel = 'オッズ更新時間';
    } else {
      const fixed = first(doc.getElementsByClassName('tab4_time'));
      if (fixed) oddsLabel = norm(fixed.textContent) || null;
    }

    const title = first(doc.getElementsByClassName('title16_titleDetail__add2020'));
    const noticeEl = first(doc.getElementsByClassName('heading1_mainLabel'));

    return {
      venue,
      jcd,
      raceNo,
      date: params ? params.hd : null,
      updatedAt,
      oddsLabel,
      deadline: findDeadline(doc, raceNo),
      raceTitle: title ? norm(title.textContent) || null : null,
      notice: noticeEl ? norm(noticeEl.textContent) || null : null,
    };
  }

  const api = {
    VENUES, PATH_TYPES, parseOddsText, parseRangeText, parseOdds, parseRaceMeta, detectPageType, parsePage, raceKey,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OddsParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
