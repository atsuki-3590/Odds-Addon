/*
 * bookmarklet/main.js — ブックマークレット本体（スマホの Chrome など、拡張機能が使えない環境向け）
 *
 * scripts/build-bookmarklet.js が parser.js と結果ページのテンプレート（RESULT_TEMPLATE）を前に連結して
 * 1つの javascript: URL にする。ここでは globalThis.OddsParser（関数スコープ内のローカル）と RESULT_TEMPLATE が使える前提。
 *
 * - 読むのは今開いているページの DOM だけ（fetch しない、外部へ送信しない）
 * - 公式ページの DOM は書き換えない。結果は Blob の別ページに表示し、ブラウザの「戻る」でオッズページへ戻る
 * - 読み取った結果はこの端末のブラウザ（localStorage）にレースごとに保存し、
 *   3連単と3連複のように別ページどうしの比較は、両方のページで実行したときに突き合わせる
 * - スマホ版（/owsp/sp/）や対象外のページで実行したら、同じレースの PC 版オッズページへ移動する
 */
(function () {
  'use strict';

  var STORE_KEY = 'oddsDistortionChecker.races';
  var MAX_RACES = 30;
  var SUPPORTED = { odds2tf: 1, odds3t: 1, odds3f: 1, oddsk: 1 };

  var href = location.href;
  var page = /^https:\/\/www\.boatrace\.jp\/(owpc\/pc|owsp\/sp)\/race\/([a-z0-9]+)\?/i.exec(href);
  var get = function (k) {
    var m = new RegExp('[?&]' + k + '=(\\d+)').exec(href);
    return m ? m[1] : null;
  };
  var rno = get('rno');
  var jcd = get('jcd');
  var hd = get('hd');

  if (!page || !rno || !jcd || !hd) {
    alert('ボートレースのオッズページ（2連単・2連複／3連単／3連複／拡連複）を開いてから実行してください。');
    return;
  }

  if (page[1] !== 'owpc/pc' || !SUPPORTED[page[2]]) {
    var path = SUPPORTED[page[2]] ? page[2] : 'odds2tf';
    var pcUrl = 'https://www.boatrace.jp/owpc/pc/race/' + path + '?rno=' + rno + '&jcd=' + jcd + '&hd=' + hd;
    if (confirm('このレースのオッズ（PC版ページ）を開きます。\n開いたら、もう一度このブックマークを実行してください。')) {
      location.href = pcUrl;
    }
    return;
  }

  var P = globalThis.OddsParser;
  var current;
  try {
    var parsed = P.parsePage(document);
    current = { ok: true, url: href, type: parsed.type, meta: parsed.meta, odds: parsed.odds, absent: parsed.absent };
  } catch (e) {
    current = { ok: false, url: href, error: String((e && e.message) || e) };
  }
  current.parsedAt = Date.now();

  // レースごとの記録を読み書きする（保存できない環境でも、このページの結果だけは表示する）
  var pages = {};
  var key = current.ok ? P.raceKey(current.meta) : null;
  var hasOdds = current.ok && Object.keys(current.odds || {}).some(function (t) {
    return Object.keys(current.odds[t] || {}).length > 0;
  });
  try {
    var store = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
    if (key) pages = store[key] || {};
    if (key && current.type && hasOdds) {
      pages[current.type] = current;
      store[key] = pages;
      var latest = function (rec) {
        return Math.max.apply(null, [0].concat(Object.keys(rec || {}).map(function (t) {
          return (rec[t] && rec[t].parsedAt) || 0;
        })));
      };
      var keys = Object.keys(store).sort(function (x, y) {
        return latest(store[y]) - latest(store[x]);
      });
      for (var i = MAX_RACES; i < keys.length; i++) delete store[keys[i]];
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    }
  } catch (_) {
    if (current.type && hasOdds) pages[current.type] = current;
  }

  // JSON を <script type="application/json"> に埋め込むので "<" をエスケープ（</script> 対策）
  var json = JSON.stringify({ current: current, pages: pages }).replace(/</g, '\\u003c');
  var html = RESULT_TEMPLATE.replace('__PAYLOAD__', function () {
    return json;
  });
  var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  location.href = URL.createObjectURL(blob);
})();
