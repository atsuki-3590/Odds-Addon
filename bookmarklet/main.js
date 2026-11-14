/*
 * bookmarklet/main.js — ブックマークレット本体（スマホの Chrome など、拡張機能が使えない環境向け）
 *
 * scripts/build-bookmarklet.js が parser.js と結果ページのテンプレート（RESULT_TEMPLATE）を前に連結して
 * 1つの javascript: URL にする。ここでは globalThis.OddsParser（関数スコープ内のローカル）と RESULT_TEMPLATE が使える前提。
 *
 * - 読むのは今開いているページの DOM だけ（fetch しない、外部へ送信しない）
 * - 公式ページの DOM は書き換えない。結果は Blob の別ページに表示し、ブラウザの「戻る」でオッズページへ戻る
 * - スマホ版（/owsp/sp/）や別の賭式のページで実行したら、同じレースの PC 版 2連単・2連複ページへ移動する
 */
(function () {
  'use strict';

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
    alert('ボートレースのオッズページ（2連単・2連複）を開いてから実行してください。');
    return;
  }

  if (page[1] !== 'owpc/pc' || page[2] !== 'odds2tf') {
    var pcUrl = 'https://www.boatrace.jp/owpc/pc/race/odds2tf?rno=' + rno + '&jcd=' + jcd + '&hd=' + hd;
    if (confirm('このレースの2連単・2連複オッズ（PC版ページ）を開きます。\n開いたら、もう一度このブックマークを実行してください。')) {
      location.href = pcUrl;
    }
    return;
  }

  var payload;
  try {
    payload = {
      ok: true,
      url: href,
      meta: globalThis.OddsParser.parseRaceMeta(document),
      odds: globalThis.OddsParser.parseOdds(document),
      parsedAt: Date.now(),
    };
  } catch (e) {
    payload = { ok: false, url: href, error: String((e && e.message) || e), parsedAt: Date.now() };
  }

  // JSON を <script type="application/json"> に埋め込むので "<" をエスケープ（</script> 対策）
  var json = JSON.stringify(payload).replace(/</g, '\\u003c');
  var html = RESULT_TEMPLATE.replace('__PAYLOAD__', function () {
    return json;
  });
  var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  location.href = URL.createObjectURL(blob);
})();
