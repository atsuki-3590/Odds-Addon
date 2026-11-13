/*
 * calc.js — 合成オッズと比率の計算（純粋関数のみ。DOM・chrome API に依存しない）
 *
 * 2連単 i→j のオッズ a、j→i のオッズ b から
 *   合成オッズ S = 1 / (1/a + 1/b)
 * 2連複 i=j のオッズ C との比率
 *   R = C / S
 * R > 1 なら 2連複のほうが得、R < 1 なら 2連単2点買いのほうが得。
 * ボートレースは全賭式の払戻率が同じ（75%）なので控除率の補正はしない。
 *
 * syntheticOdds は任意点数に対応しているので、将来の
 * 「3連単6点の合成 vs 3連複」（S = 1 / Σ(1/o)）にもそのまま使える。
 *
 * Chrome のコンテンツスクリプト／サイドパネルでは globalThis.OddsCalc として、
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

  /**
   * 1組分の比較。どれかが無効なら s / r は null（エラーにはしない）。
   * @returns {{pair:string,i:number,j:number,a:number|null,b:number|null,s:number|null,c:number|null,r:number|null}}
   */
  function compareRow(i, j, odds) {
    const exacta = (odds && odds.a) || {};
    const quinella = (odds && odds.c) || {};
    const a = validOdds(exacta[`${i}-${j}`]);
    const b = validOdds(exacta[`${j}-${i}`]);
    const c = validOdds(quinella[`${i}=${j}`]);
    const s = syntheticOdds([a, b]);
    const r = s !== null && c !== null ? c / s : null;
    return { pair: `${i}=${j}`, i, j, a, b, s, c, r };
  }

  /**
   * 15組すべてを計算し、R の降順で返す（R を計算できない組は末尾、組番順）。
   * @param {{a:Object<string,number>, c:Object<string,number>}} odds
   */
  function computeRows(odds) {
    const rows = boatPairs().map(([i, j]) => compareRow(i, j, odds));
    rows.sort((x, y) => {
      if (x.r === null && y.r === null) return x.i - y.i || x.j - y.j;
      if (x.r === null) return 1;
      if (y.r === null) return -1;
      return y.r - x.r || x.i - y.i || x.j - y.j;
    });
    return rows;
  }

  /**
   * R を判定する。
   *  better: 'quinella'（2連複が得） / 'exacta'（2連単2点が得） / 'even' / null（計算不可）
   *  strong: しきい値（R >= high または R <= low）を超えているか
   */
  function classify(r, thresholds) {
    const t = normalizeThresholds(thresholds);
    if (typeof r !== 'number' || !Number.isFinite(r)) return { better: null, strong: false };
    if (r > 1) return { better: 'quinella', strong: r >= t.high };
    if (r < 1) return { better: 'exacta', strong: r <= t.low };
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
    validOdds,
    syntheticOdds,
    boatPairs,
    compareRow,
    computeRows,
    classify,
    normalizeThresholds,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OddsCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
