'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('./helpers/mini-dom.js');
const { build } = require('../scripts/build-bookmarklet.js');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(ROOT, 'fixtures');

test('dist/ のブックマークレットがソースから生成した最新のもの', () => {
  const { files } = build();
  for (const [rel, content] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(ROOT, rel), 'utf8'), content,
      `${rel} が古いです。node scripts/build-bookmarklet.js を実行してください`);
  }
});

/** ブックマークレットを fixture の Document 上で実行し、遷移先・ダイアログ・結果 HTML を返す */
function runBookmarklet(href, html, storage = new Map()) {
  const { url } = build();
  assert.ok(url.startsWith('javascript:'));
  const code = decodeURIComponent(url.slice('javascript:'.length));
  const result = { dialogs: [], navigatedTo: null, blobHtml: null };
  const location = {
    get href() {
      return href;
    },
    set href(v) {
      result.navigatedTo = v;
    },
  };
  const sandbox = {
    document: parseHTML(html || '<html><body></body></html>', href),
    location,
    alert: (m) => result.dialogs.push(['alert', m]),
    confirm: (m) => {
      result.dialogs.push(['confirm', m]);
      return true;
    },
    Blob: class {
      constructor(parts) {
        result.blobHtml = parts.join('');
      }
    },
    URL: { createObjectURL: () => 'blob:https://www.boatrace.jp/test' },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
    },
    Date,
    JSON,
    Object,
    Math,
  };
  vm.runInNewContext(code, sandbox);
  // ページのグローバルを汚していない
  assert.equal('OddsParser' in sandbox, false);
  assert.equal('RESULT_TEMPLATE' in sandbox, false);
  return result;
}

const payloadOf = (html) => JSON.parse(/<script type="application\/json" id="payload">([\s\S]*?)<\/script>/.exec(html)[1]);

const fixtureUrl = (file) => {
  const [, p, date, jcd, rno] = /^(\w+?)_(\d{8})_(\d{2})_(\d{2})_/.exec(file);
  return `https://www.boatrace.jp/owpc/pc/race/${p}?rno=${Number(rno)}&jcd=${jcd}&hd=${date}`;
};
const runOn = (file, storage) =>
  runBookmarklet(fixtureUrl(file), fs.readFileSync(path.join(FIXTURES, file), 'utf8'), storage);

test('2連単・2連複ページ: 結果ページ（Blob）へ移動し、解析結果を埋め込む', () => {
  const r = runOn('odds2tf_20261114_24_09_live.html');
  assert.deepEqual(r.dialogs, []);
  assert.equal(r.navigatedTo, 'blob:https://www.boatrace.jp/test');
  const { current, pages } = payloadOf(r.blobHtml);
  assert.equal(current.ok, true);
  assert.equal(current.type, '2tf');
  assert.equal(current.meta.venue, '大村');
  assert.equal(current.meta.raceNo, 9);
  assert.equal(Object.keys(current.odds.a).length, 29);
  assert.equal(Object.keys(current.odds.c).length, 15);
  assert.equal(current.odds.a['1-2'], 15.4);
  assert.deepEqual(Object.keys(pages), ['2tf']);
  // 結果ページはサイドパネルと同じ要素を持つ
  for (const id of ['race', 'times', 'status', 'sections', 'th-high', 'th-low', 'th-reset', 'only-strong', 'back']) {
    assert.ok(r.blobHtml.includes(`id="${id}"`), id);
  }
});

test('別ページで実行すると、同じレースの結果を端末内に貯めて突き合わせる', () => {
  const storage = new Map();
  const files = ['odds2tf_20261114_24_12_live.html', 'odds3t_20261114_24_12_live.html', 'odds3f_20261114_24_12_live.html', 'oddsk_20261114_24_12_live.html'];
  let last;
  for (const f of files) last = runOn(f, storage);
  const { current, pages } = payloadOf(last.blobHtml);
  assert.equal(current.type, 'k');
  assert.deepEqual(Object.keys(pages).sort(), ['2tf', '3f', '3t', 'k']);
  // 別のレースは混ざらない
  const other = payloadOf(runOn('odds3t_20261114_24_01_closed.html', storage).blobHtml);
  assert.deepEqual(Object.keys(other.pages), ['3t']);
  // データなしのページは保存しない
  const before = storage.get('oddsDistortionChecker.races');
  runOn('odds3t_20261115_24_01_nodata.html', storage);
  assert.equal(storage.get('oddsDistortionChecker.races'), before);
});

test('localStorage が使えなくても、そのページの結果は表示する', () => {
  const broken = { has: () => { throw new Error('denied'); }, get: () => null, set: () => { throw new Error('denied'); } };
  const r = runOn('odds3t_20261114_24_12_live.html', broken);
  const { pages } = payloadOf(r.blobHtml);
  assert.deepEqual(Object.keys(pages), ['3t']);
});

test('スマホ版や対象外のページ: 同じレースの PC 版オッズページへ案内する', () => {
  for (const [href, to] of [
    ['https://www.boatrace.jp/owsp/sp/race/odds2tf?rno=3&jcd=07&hd=20261114', 'odds2tf'],
    ['https://www.boatrace.jp/owsp/sp/race/odds3t?rno=3&jcd=07&hd=20261114', 'odds3t'],
    ['https://www.boatrace.jp/owpc/pc/race/oddstf?rno=3&jcd=07&hd=20261114', 'odds2tf'],
    ['https://www.boatrace.jp/owpc/pc/race/racelist?rno=3&jcd=07&hd=20261114', 'odds2tf'],
  ]) {
    const r = runBookmarklet(href);
    assert.equal(r.dialogs.length, 1, href);
    assert.equal(r.dialogs[0][0], 'confirm');
    assert.equal(r.navigatedTo, `https://www.boatrace.jp/owpc/pc/race/${to}?rno=3&jcd=07&hd=20261114`);
  }
});

test('対象外のサイト: 警告だけで何もしない', () => {
  const r = runBookmarklet('https://example.com/');
  assert.equal(r.dialogs.length, 1);
  assert.equal(r.dialogs[0][0], 'alert');
  assert.equal(r.navigatedTo, null);
});
