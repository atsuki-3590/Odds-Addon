/*
 * sidepanel.js — アクティブなタブの解析結果を chrome.storage.session から読み、表を描画する
 * 描画としきい値フォームは src/view.js（スマホ用ブックマークレットと共通）。
 */
(function () {
  'use strict';

  const { getEls, render, bindThresholds } = globalThis.OddsView;
  const els = getEls(document);

  let thresholds = null;
  let currentTabId = null;
  let currentPayload = null;

  const redraw = () => {
    if (thresholds) render(els, currentPayload, thresholds);
  };

  async function loadForActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    currentTabId = tab ? tab.id : null;
    if (currentTabId == null) {
      currentPayload = null;
    } else {
      const key = `tab:${currentTabId}`;
      const data = await chrome.storage.session.get(key);
      currentPayload = data[key] || null;
    }
    redraw();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || currentTabId == null) return;
    const key = `tab:${currentTabId}`;
    if (key in changes) {
      currentPayload = changes[key].newValue || null;
      redraw();
    }
  });
  chrome.tabs.onActivated.addListener(loadForActiveTab);
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) loadForActiveTab();
  });

  bindThresholds(
    els,
    {
      load: async () => (await chrome.storage.local.get('thresholds')).thresholds,
      save: (t) => chrome.storage.local.set({ thresholds: t }),
    },
    (t) => {
      thresholds = t;
      redraw();
    },
  ).then(loadForActiveTab);
})();
