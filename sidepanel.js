/*
 * sidepanel.js — アクティブなタブの解析結果と、同じレースで読み取り済みの他ページの結果を
 * chrome.storage.session から読み、比較を描画する。
 * 描画と設定フォームは src/view.js（スマホ用ブックマークレットと共通）。
 *
 * 保存キー（src/background.js が書く）:
 *   "tab:<tabId>"   … そのタブで最後に読み取ったページの結果
 *   "race:<raceKey>" … レースごとの { '2tf': 結果, '3t': 結果, '3f': 結果, 'k': 結果 }
 */
(function () {
  'use strict';

  const { getEls, render, bindSettings } = globalThis.OddsView;
  const els = getEls(document);

  let settings = null;
  let currentTabId = null;
  let current = null;
  let pages = {};

  const raceKeyOf = (p) => {
    const m = p && p.meta;
    return m && m.date && m.jcd && m.raceNo != null ? `${m.date}_${m.jcd}_${m.raceNo}` : null;
  };

  const redraw = () => {
    if (!settings) return;
    render(els, { current, pages }, settings, {
      // 「〇〇を開く」は今のタブで開く（ユーザーの操作によるページ移動。拡張から取得はしない）
      openPage: (url) => {
        if (currentTabId != null) chrome.tabs.update(currentTabId, { url });
      },
    });
  };

  async function loadPages() {
    const key = raceKeyOf(current);
    if (!key) {
      pages = {};
      return;
    }
    const data = await chrome.storage.session.get(`race:${key}`);
    pages = data[`race:${key}`] || {};
  }

  async function loadForActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    currentTabId = tab ? tab.id : null;
    if (currentTabId == null) {
      current = null;
    } else {
      const key = `tab:${currentTabId}`;
      const data = await chrome.storage.session.get(key);
      current = data[key] || null;
    }
    await loadPages();
    redraw();
  }

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'session' || currentTabId == null) return;
    const tabKey = `tab:${currentTabId}`;
    const raceKey = raceKeyOf(current);
    if (tabKey in changes) {
      current = changes[tabKey].newValue || null;
      await loadPages();
      redraw();
    } else if (raceKey && `race:${raceKey}` in changes) {
      pages = changes[`race:${raceKey}`].newValue || {};
      redraw();
    }
  });
  chrome.tabs.onActivated.addListener(loadForActiveTab);
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) loadForActiveTab();
  });

  bindSettings(
    els,
    {
      load: async () => (await chrome.storage.local.get('settings')).settings,
      save: (s) => chrome.storage.local.set({ settings: s }),
    },
    (s) => {
      settings = s;
      redraw();
    },
  ).then(loadForActiveTab);
})();
