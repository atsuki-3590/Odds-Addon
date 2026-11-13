'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOddsText } = require('../src/parser.js');

test('parseOddsText: 数値として読めるもの', () => {
  assert.equal(parseOddsText('5.3'), 5.3);
  assert.equal(parseOddsText(' 12.0 \n'), 12);
  assert.equal(parseOddsText('1,234.5'), 1234.5);
  assert.equal(parseOddsText('1.0'), 1);
});

test('parseOddsText: 数値でないものは null', () => {
  for (const t of ['-', '欠場', '発売なし', '', '  ', '0', '0.0', '1.0-1.5', '特払', null, undefined, 5.3]) {
    assert.equal(parseOddsText(t), null, JSON.stringify(t));
  }
});

// fixtures/ の実ページ HTML を使ったテストは、HTML を受け取ってパーサーを実装する際に追加する
test('parseOdds（fixtures）', { todo: 'fixtures/ に保存HTMLを置いてから実装' }, () => {});
