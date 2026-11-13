/*
 * parser.js — オッズページの Document からオッズを取り出す純粋関数
 *
 *   parseOdds(doc)     → { a: {"1-2": 5.3, ...}, c: {"1=2": 3.1, ...} }
 *   parseRaceMeta(doc) → { venue, raceNo, updatedAt }
 *
 * 数値でない値（欠場・発売なし・「-」など）はキーごと出力しない（エラーにしない）。
 *
 * ※ DOM セレクタは fixtures/ に保存した実ページの HTML を見てから実装する。
 *   推測では書かない。それまで parseOdds / parseRaceMeta は未実装エラーを投げる。
 */
(function (root) {
  'use strict';

  /**
   * セルの文字列をオッズ数値に変換。数値として読めなければ null。
   * 例: "5.3" → 5.3, " 12.0 " → 12, "1,234.5" → 1234.5, "-" / "欠場" / "" → null
   */
  function parseOddsText(text) {
    if (typeof text !== 'string') return null;
    const t = text.replace(/[\s, ]/g, '');
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    const v = Number(t);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  function parseOdds(_doc) {
    throw new Error('parseOdds は未実装です（fixtures/ のHTMLを見て実装予定）');
  }

  function parseRaceMeta(_doc) {
    throw new Error('parseRaceMeta は未実装です（fixtures/ のHTMLを見て実装予定）');
  }

  const api = { parseOddsText, parseOdds, parseRaceMeta };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OddsParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
