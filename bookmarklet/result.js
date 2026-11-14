/*
 * bookmarklet/result.js — ブックマークレットの結果ページ（Blob）で動くスクリプト
 * 描画と設定フォームは src/view.js（拡張のサイドパネルと共通）。
 * 設定はこの端末のブラウザ（localStorage）にだけ保存する。
 */
(function () {
  'use strict';

  var KEY = 'oddsDistortionChecker.settings';
  var view = globalThis.OddsView;
  var els = view.getEls(document);
  var state = JSON.parse(document.getElementById('payload').textContent);
  var backUrl = state.current && state.current.url;

  document.getElementById('back').addEventListener('click', function (e) {
    e.preventDefault();
    if (history.length > 1) history.back();
    else if (backUrl) location.href = backUrl;
  });

  view.bindSettings(
    els,
    {
      load: function () {
        try {
          return Promise.resolve(JSON.parse(localStorage.getItem(KEY) || 'null') || undefined);
        } catch (_) {
          return Promise.resolve(undefined);
        }
      },
      save: function (s) {
        try {
          localStorage.setItem(KEY, JSON.stringify(s));
        } catch (_) {
          // 保存できなくても表示は続ける
        }
      },
    },
    function (settings) {
      // 「〇〇を開く」は普通のリンク（タップで公式ページへ移動。開いたらもう一度ブックマークを実行）
      view.render(els, state, settings);
    },
  );
})();
