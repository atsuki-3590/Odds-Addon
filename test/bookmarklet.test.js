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
function runBookmarklet(href, html) {
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
    Date,
    JSON,
  };
  vm.runInNewContext(code, sandbox);
  // ページのグローバルを汚していない
  assert.equal('OddsParser' in sandbox, false);
  assert.equal('RESULT_TEMPLATE' in sandbox, false);
  return result;
}

const payloadOf = (html) => JSON.parse(/<script type="application\/json" id="payload">([\s\S]*?)<\/script>/.exec(html)[1]);

test('2連単・2連複ページ: 結果ページ（Blob）へ移動し、解析結果を埋め込む', () => {
  const href = 'https://www.boatrace.jp/owpc/pc/race/odds2tf?rno=9&jcd=24&hd=20261114';
  const html = fs.readFileSync(path.join(FIXTURES, 'odds2tf_20261114_24_09_live.html'), 'utf8');
  const r = runBookmarklet(href, html);
  assert.deepEqual(r.dialogs, []);
  assert.equal(r.navigatedTo, 'blob:https://www.boatrace.jp/test');
  const payload = payloadOf(r.blobHtml);
  assert.equal(payload.ok, true);
  assert.equal(payload.url, href);
  assert.equal(payload.meta.venue, '大村');
  assert.equal(payload.meta.raceNo, 9);
  assert.equal(Object.keys(payload.odds.a).length, 29);
  assert.equal(Object.keys(payload.odds.c).length, 15);
  assert.equal(payload.odds.a['1-2'], 15.4);
  // 結果ページはサイドパネルと同じ要素を持つ
  for (const id of ['race', 'times', 'status', 'table', 'rows', 'th-high', 'th-low', 'th-reset', 'back']) {
    assert.ok(r.blobHtml.includes(`id="${id}"`), id);
  }
});

test('スマホ版や別の賭式のページ: 同じレースの PC 版 2連単・2連複ページへ案内する', () => {
  for (const href of [
    'https://www.boatrace.jp/owsp/sp/race/odds2tf?rno=3&jcd=07&hd=20261114',
    'https://www.boatrace.jp/owpc/pc/race/odds3t?rno=3&jcd=07&hd=20261114',
  ]) {
    const r = runBookmarklet(href);
    assert.equal(r.dialogs.length, 1);
    assert.equal(r.dialogs[0][0], 'confirm');
    assert.equal(r.navigatedTo, 'https://www.boatrace.jp/owpc/pc/race/odds2tf?rno=3&jcd=07&hd=20261114');
  }
});

test('対象外のページ: 警告だけで何もしない', () => {
  const r = runBookmarklet('https://example.com/');
  assert.equal(r.dialogs.length, 1);
  assert.equal(r.dialogs[0][0], 'alert');
  assert.equal(r.navigatedTo, null);
});
