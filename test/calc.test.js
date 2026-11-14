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
  assert.deepEqual(classify(1.2, t), { better: 'single', strong: true });
  assert.deepEqual(classify(1.1, t), { better: 'single', strong: true });
  assert.deepEqual(classify(1.03, t), { better: 'single', strong: false });
  assert.deepEqual(classify(1, t), { better: 'even', strong: false });
  assert.deepEqual(classify(0.97, t), { better: 'multi', strong: false });
  assert.deepEqual(classify(0.9, t), { better: 'multi', strong: true });
  assert.deepEqual(classify(null, t), { better: null, strong: false });
});

test('normalizeThresholds: 不正値は初期値に戻す', () => {
  assert.deepEqual(normalizeThresholds(undefined), DEFAULT_THRESHOLDS);
  assert.deepEqual(normalizeThresholds({ high: 1.2, low: 0.8 }), { high: 1.2, low: 0.8 });
  assert.deepEqual(normalizeThresholds({ high: 0.9, low: 1.1 }), { high: 1.1, low: 0.9 });
  assert.deepEqual(normalizeThresholds({ high: NaN, low: 0 }), { high: 1.1, low: 0.9 });
});

// ---- 3連単・3連複・拡連複の比較 ----
const {
  boatTriples, orderedPairs, compareTrifectaTrio, compareExactaTrifecta, compareWideTrio, absentBoats, timeGapWarning,
  SECTIONS,
} = require('../src/calc.js');

/** すべての3連単を同じオッズにした表 */
function flatTrifecta(v) {
  const t = {};
  for (const [i, j] of orderedPairs()) for (let k = 1; k <= 6; k++) if (k !== i && k !== j) t[`${i}-${j}-${k}`] = v;
  return t;
}

test('組の数: 3連複20組・2連単30組', () => {
  assert.equal(boatTriples().length, 20);
  assert.equal(orderedPairs().length, 30);
});

test('3連単6点 vs 3連複: S = 1/Σ(1/o)（6点）、R = 3連複 / S', () => {
  const t = flatTrifecta(60); // 6点合成 = 10
  const f = {};
  for (const b of boatTriples()) f[b.join('=')] = 10;
  f['1=2=3'] = 12;
  t['3-2-1'] = 30; // 1=2=3 の合成: 1/(5/60 + 1/30) = 1/(7/60) = 60/7
  const rows = compareTrifectaTrio(t, f);
  assert.equal(rows.length, 20);
  assert.equal(rows[0].key, '1=2=3');
  close(rows[0].s, 60 / 7);
  close(rows[0].r, 12 / (60 / 7));
  assert.equal(rows[0].n, 6);
  close(rows[1].r, 1);
});

test('3連単4点 vs 2連単: i→j→k の4点と比べる', () => {
  const t = flatTrifecta(40); // 4点合成 = 10
  const a = {};
  for (const [i, j] of orderedPairs()) a[`${i}-${j}`] = 10;
  a['2-1'] = 15;
  const rows = compareExactaTrifecta(a, t);
  assert.equal(rows.length, 30);
  assert.equal(rows[0].key, '2-1');
  close(rows[0].s, 10);
  close(rows[0].r, 1.5);
  assert.equal(rows[0].n, 4);
});

test('3連複4点 vs 拡連複: R は幅 [下限/S, 上限/S]', () => {
  const f = {};
  for (const b of boatTriples()) f[b.join('=')] = 40; // 4点合成 = 10
  const k = {};
  for (const [i, j] of boatPairs()) k[`${i}=${j}`] = [9, 11];
  k['1=2'] = [12, 15];
  k['5=6'] = [5, 8];
  const rows = compareWideTrio(k, f);
  assert.equal(rows.length, 15);
  assert.equal(rows[0].key, '1=2');
  close(rows[0].rRange[0], 1.2);
  close(rows[0].rRange[1], 1.5);
  assert.equal(rows[0].r, null);
  assert.equal(rows[14].key, '5=6');
  const t = { high: 1.1, low: 0.9 };
  assert.deepEqual(classify(rows[0].rRange, t), { better: 'single', strong: true });
  assert.deepEqual(classify(rows[14].rRange, t), { better: 'multi', strong: true }); // 0.5〜0.8
  assert.deepEqual(classify([0.9, 1.1], t), { better: 'mixed', strong: false });
  assert.deepEqual(classify([1.05, 1.2], t), { better: 'single', strong: false }); // 下限がしきい値未満
});

test('欠場艇: その艇を含む組は absent、相手の点からは除く', () => {
  const absent = [6];
  const t = flatTrifecta(30);
  const a = {};
  for (const [i, j] of orderedPairs()) a[`${i}-${j}`] = 10;
  const rows = compareExactaTrifecta(a, t, absent);
  const r12 = rows.find((r) => r.key === '1-2');
  assert.equal(r12.n, 3); // 1-2-3, 1-2-4, 1-2-5
  close(r12.s, 10);
  close(r12.r, 1);
  const r16 = rows.find((r) => r.key === '1-6');
  assert.equal(r16.absent, true);
  assert.equal(r16.r, null);
  assert.ok(rows.slice(-10).every((r) => r.absent));
});

test('発売票数0などで1点でも欠けたら計算不可（欠場とは区別）', () => {
  const t = flatTrifecta(60);
  delete t['1-2-3'];
  const f = { '1=2=3': 10 };
  const row = compareTrifectaTrio(t, f).find((r) => r.key === '1=2=3');
  assert.equal(row.s, null);
  assert.equal(row.r, null);
  assert.equal(row.absent, false);
});

test('absentBoats: 各ページの欠場艇の和集合', () => {
  assert.deepEqual(absentBoats({ '2tf': { absent: [6] }, '3t': { absent: [2, 6] }, k: {} }), [2, 6]);
  assert.deepEqual(absentBoats(undefined), []);
});

test('timeGapWarning: 更新時刻のずれ・締切後との混在を警告', () => {
  const live = (t) => ({ updatedAt: t, oddsLabel: 'オッズ更新時間' });
  const closed = { updatedAt: null, oddsLabel: '締切時オッズ' };
  assert.equal(timeGapWarning([live('19:41')]), null);
  assert.equal(timeGapWarning([live('19:41'), live('19:42')]), null);
  assert.match(timeGapWarning([live('19:41'), live('19:45')]), /4分/);
  assert.equal(timeGapWarning([closed, closed]), null);
  assert.match(timeGapWarning([closed, live('19:41')]), /混ざって/);
});

test('SECTIONS: 4つの比較と必要なページ', () => {
  assert.deepEqual(SECTIONS.map((s) => [s.id, s.needs]), [
    ['2t2f', ['2tf']], ['3t3f', ['3t', '3f']], ['2t3t', ['2tf', '3t']], ['k3f', ['k', '3f']],
  ]);
});
