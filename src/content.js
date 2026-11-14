/*
 * content.js — 開いているオッズページの DOM を読み、結果をバックグラウンド経由でサイドパネルへ渡す
 *
 * 対象: 2連単・2連複 / 3連単 / 3連複 / 拡連複 のオッズページ（manifest.json の matches）
 * - 読むのはこのページの DOM だけ。fetch や定期取得はしない
 * - ページの DOM は一切書き換えない
 * - 「オッズ更新」などで表が変わったら MutationObserver で検知して再解析する
 */
(function () {
  'use strict';

  const { parsePage } = globalThis.OddsParser;
  const DEBOUNCE_MS = 300;

  let lastSignature = null;
  let timer = null;

  function buildPayload() {
    try {
      return { ok: true, url: location.href, ...parsePage(document) };
    } catch (e) {
      return { ok: false, url: location.href, error: String((e && e.message) || e) };
    }
  }

  function run() {
    timer = null;
    const payload = buildPayload();
    const signature = JSON.stringify(payload);
    if (signature === lastSignature) return; // 内容が変わっていなければ送らない
    lastSignature = signature;
    payload.parsedAt = Date.now();
    try {
      chrome.runtime.sendMessage({ type: 'odds-result', payload }).catch(() => {});
    } catch (_) {
      // 拡張の再読み込み後など、コンテキストが無効になっている場合は黙って止める
      observer.disconnect();
    }
  }

  function schedule() {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  }

  // 「更新」ボタンは現状ページ全体の再読み込み（その場合はこのスクリプトが再実行される）。
  // 将来ページ内で表だけ差し替わる作りになっても追従できるよう、メイン領域を監視しておく。
  const target = document.querySelector('main.l-main') || document.body;
  const observer = new MutationObserver(schedule);
  observer.observe(target, { childList: true, subtree: true, characterData: true });

  run();
})();
