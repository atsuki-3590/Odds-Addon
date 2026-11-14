/*
 * parser.js — 2連単・2連複オッズページ（/owpc/pc/race/odds2tf）の Document からオッズを取り出す純粋関数
 *
 *   parseOdds(doc)     → { a: {"1-2": 5.3, ...}, c: {"1=2": 3.1, ...} }
 *   parseRaceMeta(doc) → { venue, jcd, raceNo, date, updatedAt, oddsLabel, deadline, raceTitle, notice }
 *
 * 数値でない値（欠場・発売票数0の「0.0」・「-」・空欄など）はキーごと出力しない（エラーにしない）。
 *
 * ページ構造（fixtures/ の 14 場分の保存 HTML で確認。場による違いはない）:
 *   <div class="title7"><h3><span class="title7_mainLabel">2連単オッズ</span></h3></div>
 *   <div class="table1"><table>
 *     <thead> 1列目の艇番 th が 1〜6 の順に並ぶ（艇番 th と選手名 th が交互）
 *     <tbody> 各行は「相手艇番 td + td.oddsPoint」の組が 6 列分。列 k が 1着（2連複は小さい番号側）
 *   2連複も同じ形で、下三角以外は td.is-disabled
 *   欠場は td.oddsPoint.is-miss に「欠場」。1000倍以上は「1244」のように小数点なし。
 *
 * 使う DOM API は getElementsByClassName / getElementsByTagName / children / parentElement /
 * nextElementSibling / textContent / getAttribute / classList.contains のみ
 * （テストでは依存なしの test/helpers/mini-dom.js で同じ API を提供する）。
 */
(function (root) {
  'use strict';

  const LABEL_EXACTA = '2連単オッズ';
  const LABEL_QUINELLA = '2連複オッズ';

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

  /**
   * オッズ表を走査して [1列目の艇, 相手艇, オッズ] を返す（数値でないセルは除外）。
   * 列と艇番の対応は thead の艇番 th から読む（1〜6 が並んでいる前提をハードコードしない）。
   */
  function readGrid(table) {
    const thead = first(table.getElementsByTagName('thead'));
    const columns = thead
      ? Array.from(thead.getElementsByTagName('th')).map((th) => parseBoat(th.textContent)).filter((b) => b !== null)
      : [];
    const out = [];
    if (columns.length === 0) return out;

    for (const tbody of Array.from(table.getElementsByTagName('tbody'))) {
      for (const tr of Array.from(tbody.getElementsByTagName('tr'))) {
        const cells = Array.from(tr.children);
        for (let k = 0; k < columns.length; k++) {
          const boatCell = cells[2 * k];
          const oddsCell = cells[2 * k + 1];
          if (!boatCell || !hasClass(oddsCell, 'oddsPoint') || hasClass(oddsCell, 'is-miss')) continue;
          const other = parseBoat(boatCell.textContent);
          const odds = parseOddsText(oddsCell.textContent);
          if (other === null || other === columns[k] || odds === null) continue;
          out.push([columns[k], other, odds]);
        }
      }
    }
    return out;
  }

  /**
   * Document → { a: {"i-j": オッズ}, c: {"i=j": オッズ（i<j）} }
   * 表が見つからない（発売前・データなしなど）場合は空のオブジェクトを返す。
   */
  function parseOdds(doc) {
    const a = {};
    const c = {};
    const exacta = findOddsTable(doc, LABEL_EXACTA);
    if (exacta) {
      for (const [x, y, v] of readGrid(exacta)) a[`${x}-${y}`] = v;
    }
    const quinella = findOddsTable(doc, LABEL_QUINELLA);
    if (quinella) {
      for (const [x, y, v] of readGrid(quinella)) c[`${Math.min(x, y)}=${Math.max(x, y)}`] = v;
    }
    return { a, c };
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

  const api = { VENUES, parseOddsText, parseOdds, parseRaceMeta };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OddsParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
