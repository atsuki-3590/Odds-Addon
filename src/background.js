/*
 * background.js — コンテンツスクリプトの解析結果を chrome.storage.session にタブ単位で保存する
 *
 * 保存キー: "tab:<tabId>" → { ok, url, meta, odds, parsedAt } または { ok:false, error }
 *
 * 将来（3連単6点 vs 3連複）: 別ページの結果をレース単位のキー
 *   "race:<日付>_<場>_<R>:<賭式>" にも保存し、サイドパネルで突き合わせる想定。
 * 外部への送信やページの取得は一切しない。
 */
'use strict';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'odds-result' || !sender.tab || sender.tab.id == null) return;
  chrome.storage.session.set({ [`tab:${sender.tab.id}`]: msg.payload });
});

// タブが閉じられた／別ページへ移動し始めたら古い結果を消す（対象ページなら読み込み後に再送される）
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`tab:${tabId}`);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') chrome.storage.session.remove(`tab:${tabId}`);
});
