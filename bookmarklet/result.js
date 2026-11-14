/*
 * bookmarklet/result.js — ブックマークレットの結果ページ（Blob）で動くスクリプト
 * 描画としきい値フォームは src/view.js（拡張のサイドパネルと共通）。
 * しきい値はこの端末のブラウザ（localStorage）にだけ保存する。
 */
(function () {
  'use strict';

  var KEY = 'oddsDistortionChecker.thresholds';
  var view = globalThis.OddsView;
  var els = view.getEls(document);
  var payload = JSON.parse(document.getElementById('payload').textContent);

  document.getElementById('back').addEventListener('click', function (e) {
    e.preventDefault();
    if (history.length > 1) history.back();
    else location.href = payload.url;
  });

  view.bindThresholds(
    els,
    {
      load: function () {
        try {
          return Promise.resolve(JSON.parse(localStorage.getItem(KEY) || 'null') || undefined);
        } catch (_) {
          return Promise.resolve(undefined);
        }
      },
      save: function (t) {
        try {
          localStorage.setItem(KEY, JSON.stringify(t));
        } catch (_) {
          // 保存できなくても表示は続ける
        }
      },
    },
    function (t) {
      view.render(els, payload, t);
    },
  );
})();
