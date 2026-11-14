/*
 * background.js — コンテンツスクリプトの解析結果を chrome.storage.session に保存する
 *
 * 保存キー:
 *   "tab:<tabId>"    → そのタブで最後に読み取ったページの結果 { ok, type, meta, odds, absent, parsedAt } など
 *   "race:<raceKey>" → レースごとに、読み取ったページの種類別の結果 { '2tf': …, '3t': …, '3f': …, 'k': … }
 *                      raceKey = <日付>_<場コード>_<レース番号>
 * 3連単と3連複のように別ページどうしの比較は、ユーザーが両方のページを開いたときに race:<raceKey> で突き合わせる。
 * 外部への送信やページの取得は一切しない。storage.session はブラウザを閉じると消える。
 */
'use strict';

const MAX_RACES = 40; // 保存しておくレース数の上限（古いものから消す）

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

const raceKeyOf = (p) => {
  const m = p && p.meta;
  return m && m.date && m.jcd && m.raceNo != null ? `${m.date}_${m.jcd}_${m.raceNo}` : null;
};

const hasOdds = (p) => Object.values((p && p.odds) || {}).some((o) => o && Object.keys(o).length);

// 複数タブから同時に届いても読み書きが混ざらないよう、保存を順番に処理する
let queue = Promise.resolve();

async function save(tabId, payload) {
  await chrome.storage.session.set({ [`tab:${tabId}`]: payload });

  const key = raceKeyOf(payload);
  if (!payload.ok || !payload.type || !key || !hasOdds(payload)) return;
  const raceStorageKey = `race:${key}`;
  const all = await chrome.storage.session.get(null);
  const record = all[raceStorageKey] || {};
  record[payload.type] = payload;
  await chrome.storage.session.set({ [raceStorageKey]: record });

  // 古いレースを消す（最後に読み取った時刻が古い順）
  const races = Object.entries(all)
    .filter(([k]) => k.startsWith('race:') && k !== raceStorageKey)
    .map(([k, v]) => [k, Math.max(0, ...Object.values(v || {}).map((p) => (p && p.parsedAt) || 0))])
    .sort((x, y) => y[1] - x[1]);
  const stale = races.slice(MAX_RACES - 1).map(([k]) => k);
  if (stale.length) await chrome.storage.session.remove(stale);
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'odds-result' || !sender.tab || sender.tab.id == null) return;
  const tabId = sender.tab.id;
  queue = queue.then(() => save(tabId, msg.payload)).catch(() => {});
});

// タブが閉じられた／別ページへ移動し始めたら、そのタブの結果を消す（レースごとの記録は残す）
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`tab:${tabId}`);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') chrome.storage.session.remove(`tab:${tabId}`);
});
