/*
 * calc.js — 合成オッズと比率の計算（純粋関数のみ。DOM・chrome API に依存しない）
 *
 * 「1点で買う券（single）」と「同じ的中条件になる複数点（multi）」を比べる。
 *   合成オッズ S = 1 / Σ(1/o)（multi の各点に 1/o の比率で配分したときの払戻倍率）
 *   比率 R = single のオッズ / S
 * R > 1 なら single のほうが得、R < 1 なら multi のほうが得。
 * ボートレースは全賭式の払戻率が同じ（75%）なので控除率の補正はしない。
 *
 * 比較（SECTIONS）:
 *   2t2f: 2連複 i=j          vs 2連単2点  i→j, j→i
 *   3t3f: 3連複 i=j=k        vs 3連単6点  i,j,k の並べ替え
 *   2t3t: 2連単 i→j          vs 3連単4点  i→j→k（k は残りの艇）
 *   k3f : 拡連複 i=j         vs 3連複4点  i=j=k（k は残りの艇）
 *         拡連複のオッズは「下限-上限」の幅なので R も幅 [下限/S, 上限/S] になる
 *
 * 欠場艇を含む組は計算しない（absent: true）。multi のうち欠場艇を含む点は「買えない」ので除く
 * （例: 6号艇欠場なら 2連単 1→2 は 3連単 1→2→3/4/5 の3点と比べる）。
 * それ以外で1点でも有効なオッズがなければ（発売票数0の「0.0」など）その組は計算不可（r: null）。
 *
 * Chrome のコンテンツスクリプト／サイドパネル／ブックマークレットでは globalThis.OddsCalc として、
 * Node（テスト）では module.exports として使う。
 */
(function (root) {
  'use strict';

  const BOATS = [1, 2, 3, 4, 5, 6];

  const DEFAULT_THRESHOLDS = Object.freeze({ high: 1.1, low: 0.9 });

  /** 計算に使える有効なオッズか（有限の正の数）。それ以外は null を返す。 */
  function validOdds(v) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  }

  /** 拡連複の [下限, 上限]。不正なら null */
  function validRange(v) {
    if (!Array.isArray(v) || v.length !== 2) return null;
    const lo = validOdds(v[0]);
    const hi = validOdds(v[1]);
    return lo !== null && hi !== null && lo <= hi ? [lo, hi] : null;
  }

  /**
   * 合成オッズ S = 1 / Σ(1/o)。1つでも無効な値があれば null。
   * @param {Array<number|null|undefined>} oddsList
   * @returns {number|null}
   */
  function syntheticOdds(oddsList) {
    if (!Array.isArray(oddsList) || oddsList.length === 0) return null;
    let inv = 0;
    for (const o of oddsList) {
      const v = validOdds(o);
      if (v === null) return null;
      inv += 1 / v;
    }
    return 1 / inv;
  }

  /** 1〜6 の艇から作れる 15 組 [i, j]（i < j） */
  function boatPairs() {
    const out = [];
    for (let x = 0; x < BOATS.length; x++) {
      for (let y = x + 1; y < BOATS.length; y++) out.push([BOATS[x], BOATS[y]]);
    }
    return out;
  }

  /** 20 組 [i, j, k]（i < j < k） */
  function boatTriples() {
    const out = [];
    for (const [i, j] of boatPairs()) for (const k of BOATS) if (k > j) out.push([i, j, k]);
    return out;
  }

  /** 30 組 [i, j]（i ≠ j、順序あり） */
  function orderedPairs() {
    const out = [];
    for (const i of BOATS) for (const j of BOATS) if (i !== j) out.push([i, j]);
    return out;
  }

  /** [a,b,c] の並べ替え6通り */
  function permutations3([a, b, c]) {
    return [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
  }

  const others = (used, absent) => BOATS.filter((b) => !used.includes(b) && !absent.includes(b));

  /**
   * 1組分の比較行を作る（汎用）。
   * single: 数値（拡連複なら [下限, 上限]）、legs: multi の各点のオッズ
   */
  function makeRow(key, boats, single, legs, absent) {
    const row = { key, boats, single, legs, n: legs.length, s: null, r: null, rRange: null, absent: false };
    if (boats.some((b) => absent.includes(b))) {
      row.absent = true;
      return row;
    }
    row.s = syntheticOdds(legs);
    if (row.s === null) return row;
    if (Array.isArray(single)) {
      const range = validRange(single);
      if (range) row.rRange = [range[0] / row.s, range[1] / row.s];
    } else if (validOdds(single) !== null) {
      row.r = single / row.s;
    }
    return row;
  }

  /** 並べ替え用の値（幅なら中央） */
  const sortValue = (row) => (row.r !== null ? row.r : row.rRange ? (row.rRange[0] + row.rRange[1]) / 2 : null);

  /** R の降順（計算できない組は末尾、組の順） */
  function sortRows(rows) {
    const order = new Map(rows.map((r, idx) => [r, idx]));
    return rows.sort((x, y) => {
      const a = sortValue(x);
      const b = sortValue(y);
      if (a === null && b === null) return order.get(x) - order.get(y);
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a || order.get(x) - order.get(y);
    });
  }

  const absentOf = (absent) => (Array.isArray(absent) ? absent : []);

  // ---- 2連単2点 vs 2連複 ----

  /**
   * 1組分の比較。どれかが無効なら s / r は null（エラーにはしない）。
   * 汎用の行に、従来の項目 pair / i / j / a / b / c も持たせる。
   */
  function compareRow(i, j, odds, absent) {
    const exacta = (odds && odds.a) || {};
    const quinella = (odds && odds.c) || {};
    const a = validOdds(exacta[`${i}-${j}`]);
    const b = validOdds(exacta[`${j}-${i}`]);
    const c = validOdds(quinella[`${i}=${j}`]);
    const row = makeRow(`${i}=${j}`, [i, j], c, [a, b], absentOf(absent));
    return Object.assign(row, { pair: `${i}=${j}`, i, j, a, b, c });
  }

  /**
   * 15組すべてを計算し、R の降順で返す（R を計算できない組は末尾、組番順）。
   * @param {{a:Object<string,number>, c:Object<string,number>}} odds
   */
  function computeRows(odds, absent) {
    return sortRows(boatPairs().map(([i, j]) => compareRow(i, j, odds, absent)));
  }

  // ---- 3連単6点 vs 3連複 ----

  function compareTrifectaTrio(t, f, absent) {
    const ab = absentOf(absent);
    const tri = t || {};
    const trio = f || {};
    return sortRows(
      boatTriples().map((boats) => {
        const legs = permutations3(boats).map((p) => validOdds(tri[p.join('-')]));
        return makeRow(boats.join('='), boats, validOdds(trio[boats.join('=')]), legs, ab);
      }),
    );
  }

  // ---- 3連単4点 vs 2連単 ----

  function compareExactaTrifecta(a, t, absent) {
    const ab = absentOf(absent);
    const exacta = a || {};
    const tri = t || {};
    return sortRows(
      orderedPairs().map(([i, j]) => {
        const legs = others([i, j], ab).map((k) => validOdds(tri[`${i}-${j}-${k}`]));
        return makeRow(`${i}-${j}`, [i, j], validOdds(exacta[`${i}-${j}`]), legs, ab);
      }),
    );
  }

  // ---- 3連複4点 vs 拡連複 ----

  function compareWideTrio(k, f, absent) {
    const ab = absentOf(absent);
    const wide = k || {};
    const trio = f || {};
    return sortRows(
      boatPairs().map(([i, j]) => {
        const legs = others([i, j], ab).map((m) => validOdds(trio[[i, j, m].sort((x, y) => x - y).join('=')]));
        return makeRow(`${i}=${j}`, [i, j], validRange(wide[`${i}=${j}`]), legs, ab);
      }),
    );
  }

  /**
   * 比較の定義。needs: 必要なページの種類（parser の type）。
   * single / multi: 「得な買い方」の表示名。
   */
  const SECTIONS = [
    {
      id: '2t2f', title: '2連単2点 vs 2連複', needs: ['2tf'], single: '2連複', multi: '2連単2点',
      compute: (p, absent) => computeRows(p['2tf'].odds, absent),
    },
    {
      id: '3t3f', title: '3連単6点 vs 3連複', needs: ['3t', '3f'], single: '3連複', multi: '3連単6点',
      compute: (p, absent) => compareTrifectaTrio(p['3t'].odds.t, p['3f'].odds.f, absent),
    },
    {
      id: '2t3t', title: '3連単4点 vs 2連単', needs: ['2tf', '3t'], single: '2連単', multi: '3連単4点',
      compute: (p, absent) => compareExactaTrifecta(p['2tf'].odds.a, p['3t'].odds.t, absent),
    },
    {
      id: 'k3f', title: '3連複4点 vs 拡連複', needs: ['k', '3f'], single: '拡連複', multi: '3連複4点',
      compute: (p, absent) => compareWideTrio(p.k.odds.k, p['3f'].odds.f, absent),
    },
  ];

  /** レースの記録（{ '2tf': payload, '3t': payload, ... }）に含まれる欠場艇の和集合 */
  function absentBoats(pages) {
    const set = new Set();
    for (const p of Object.values(pages || {})) for (const b of (p && p.absent) || []) set.add(b);
    return [...set].sort((x, y) => x - y);
  }

  /** "19:41" → 分。読めなければ null */
  function minutesOf(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  /**
   * 複数ページのオッズの時刻がそろっているか。
   * 発売中のページどうしで「オッズ更新時間」が maxGap 分以上離れている、または
   * 締切後のページと発売中のページが混ざっていれば警告文を返す。問題なければ null。
   */
  function timeGapWarning(metas, maxGap = 2) {
    const list = (metas || []).filter(Boolean);
    if (list.length < 2) return null;
    const live = list.filter((m) => m.updatedAt);
    const closed = list.filter((m) => !m.updatedAt && m.oddsLabel === '締切時オッズ');
    if (live.length && closed.length) return '締切時オッズと発売中のオッズが混ざっています。';
    const mins = live.map((m) => minutesOf(m.updatedAt)).filter((v) => v !== null);
    if (mins.length >= 2) {
      const gap = Math.max(...mins) - Math.min(...mins);
      if (gap >= maxGap) return `オッズの更新時刻が${gap}分ずれています。各ページで「更新」してから読み直してください。`;
    }
    return null;
  }

  /**
   * R を判定する。r は数値、または拡連複の幅 [下限, 上限]。
   *  better: 'single'（1点買いが得） / 'multi'（複数点買いが得） / 'even' / 'mixed'（幅が1をまたぐ＝結果次第） / null（計算不可）
   *  strong: しきい値（R >= high または R <= low。幅なら幅全体）を超えているか
   */
  function classify(r, thresholds) {
    const t = normalizeThresholds(thresholds);
    if (Array.isArray(r)) {
      const [lo, hi] = r;
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { better: null, strong: false };
      if (lo > 1) return { better: 'single', strong: lo >= t.high };
      if (hi < 1) return { better: 'multi', strong: hi <= t.low };
      if (lo === 1 && hi === 1) return { better: 'even', strong: false };
      return { better: 'mixed', strong: false };
    }
    if (typeof r !== 'number' || !Number.isFinite(r)) return { better: null, strong: false };
    if (r > 1) return { better: 'single', strong: r >= t.high };
    if (r < 1) return { better: 'multi', strong: r <= t.low };
    return { better: 'even', strong: false };
  }

  /** しきい値の検証。不正なら初期値に戻す（high > 1、0 < low < 1）。 */
  function normalizeThresholds(t) {
    const high = t && typeof t.high === 'number' && Number.isFinite(t.high) && t.high > 1
      ? t.high : DEFAULT_THRESHOLDS.high;
    const low = t && typeof t.low === 'number' && Number.isFinite(t.low) && t.low > 0 && t.low < 1
      ? t.low : DEFAULT_THRESHOLDS.low;
    return { high, low };
  }

  const api = {
    BOATS,
    DEFAULT_THRESHOLDS,
    SECTIONS,
    validOdds,
    validRange,
    syntheticOdds,
    boatPairs,
    boatTriples,
    orderedPairs,
    compareRow,
    computeRows,
    compareTrifectaTrio,
    compareExactaTrifecta,
    compareWideTrio,
    absentBoats,
    timeGapWarning,
    classify,
    normalizeThresholds,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OddsCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
