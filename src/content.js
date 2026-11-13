/*
 * content.js — 開いているオッズページの DOM を読み、結果をバックグラウンド経由でサイドパネルへ渡す
 *
 * - 読むのはこのページの DOM だけ。fetch や定期取得はしない
 * - ページの DOM は一切書き換えない
 * - 「オッズ更新」などで表が変わったら MutationObserver で検知して再解析する
 */
(function () {
  'use strict';

  const { parseOdds, parseRaceMeta } = globalThis.OddsParser;
  const DEBOUNCE_MS = 300;

  let lastSignature = null;
  let timer = null;

  function buildPayload() {
    try {
      return {
        ok: true,
        url: location.href,
        meta: parseRaceMeta(document),
        odds: parseOdds(document),
      };
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

  // TODO: fixtures を見てオッズ表のコンテナに絞る（現状は body 全体を監視）
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  run();
})();
