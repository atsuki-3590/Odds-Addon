'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  syntheticOdds, boatPairs, compareRow, computeRows, classify, normalizeThresholds, DEFAULT_THRESHOLDS,
} = require('../src/calc.js');

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} ≈ ${expected}`);

test('syntheticOdds: 2点の合成オッズ', () => {
  close(syntheticOdds([2, 2]), 1);
  close(syntheticOdds([5.3, 8.1]), 1 / (1 / 5.3 + 1 / 8.1));
});

test('syntheticOdds: 任意点数（将来の3連単6点用）', () => {
  close(syntheticOdds([6, 6, 6, 6, 6, 6]), 1);
});

test('syntheticOdds: 無効値が1つでもあれば null', () => {
  for (const bad of [null, undefined, NaN, Infinity, 0, -1, '5.3']) {
    assert.equal(syntheticOdds([5.3, bad]), null, String(bad));
  }
  assert.equal(syntheticOdds([]), null);
  assert.equal(syntheticOdds(null), null);
});

test('boatPairs: 15組', () => {
  const pairs = boatPairs();
  assert.equal(pairs.length, 15);
  assert.deepEqual(pairs[0], [1, 2]);
  assert.deepEqual(pairs[14], [5, 6]);
});

test('compareRow: R = C / S', () => {
  const row = compareRow(1, 2, { a: { '1-2': 4, '2-1': 4 }, c: { '1=2': 2.2 } });
  close(row.s, 2);
  close(row.r, 1.1);
  assert.equal(row.pair, '1=2');
});

test('compareRow: 欠けている値があれば s / r は null でエラーにならない', () => {
  assert.equal(compareRow(1, 2, { a: { '1-2': 4 }, c: { '1=2': 2 } }).r, null);
  assert.equal(compareRow(1, 2, { a: { '1-2': 4, '2-1': 4 }, c: {} }).r, null);
  const row = compareRow(1, 2, { a: { '1-2': 4, '2-1': 4 }, c: {} });
  close(row.s, 2);
  assert.equal(compareRow(1, 2, {}).r, null);
  assert.equal(compareRow(1, 2, undefined).r, null);
});

test('computeRows: 15行・R降順・計算不可は末尾', () => {
  const a = {};
  const c = {};
  for (const [i, j] of boatPairs()) {
    a[`${i}-${j}`] = 10;
    a[`${j}-${i}`] = 10;
    c[`${i}=${j}`] = 5; // R = 1
  }
  c['3=5'] = 6;      // R = 1.2（最上位）
  c['2=4'] = 4;      // R = 0.8（計算可能な中で最下位）
  delete a['6-1'];   // 1=6 は計算不可
  const rows = computeRows({ a, c });
  assert.equal(rows.length, 15);
  assert.equal(rows[0].pair, '3=5');
  assert.equal(rows[13].pair, '2=4');
  assert.equal(rows[14].pair, '1=6');
  assert.equal(rows[14].r, null);
  for (let k = 1; k < 14; k++) assert.ok(rows[k - 1].r >= rows[k].r);
});

test('classify: しきい値で強調を判定', () => {
  const t = { high: 1.1, low: 0.9 };
  assert.deepEqual(classify(1.2, t), { better: 'quinella', strong: true });
  assert.deepEqual(classify(1.1, t), { better: 'quinella', strong: true });
  assert.deepEqual(classify(1.03, t), { better: 'quinella', strong: false });
  assert.deepEqual(classify(1, t), { better: 'even', strong: false });
  assert.deepEqual(classify(0.97, t), { better: 'exacta', strong: false });
  assert.deepEqual(classify(0.9, t), { better: 'exacta', strong: true });
  assert.deepEqual(classify(null, t), { better: null, strong: false });
});

test('normalizeThresholds: 不正値は初期値に戻す', () => {
  assert.deepEqual(normalizeThresholds(undefined), DEFAULT_THRESHOLDS);
  assert.deepEqual(normalizeThresholds({ high: 1.2, low: 0.8 }), { high: 1.2, low: 0.8 });
  assert.deepEqual(normalizeThresholds({ high: 0.9, low: 1.1 }), { high: 1.1, low: 0.9 });
  assert.deepEqual(normalizeThresholds({ high: NaN, low: 0 }), { high: 1.1, low: 0.9 });
});
