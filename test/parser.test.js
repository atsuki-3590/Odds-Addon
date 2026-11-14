'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('./helpers/mini-dom.js');
const { parseOddsText, parseOdds, parseRaceMeta, VENUES } = require('../src/parser.js');
const { computeRows, boatPairs } = require('../src/calc.js');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const load = (name) => parseHTML(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

// fixtures のファイル名: odds2tf_<日付>_<jcd>_<レース番号>_<状態>.html
const ODDS2TF = fs.readdirSync(FIXTURES)
  .map((f) => /^odds2tf_(\d{8})_(\d{2})_(\d{2})_(\w+)\.html$/.exec(f))
  .filter(Boolean)
  .map(([file, date, jcd, rno, state]) => ({ file, date, jcd, raceNo: Number(rno), state }));

test('parseOddsText: 数値として読めるもの', () => {
  assert.equal(parseOddsText('5.3'), 5.3);
  assert.equal(parseOddsText(' 12.0 \n'), 12);
  assert.equal(parseOddsText('1244'), 1244); // 1000倍以上は小数点なしで表示される
  assert.equal(parseOddsText('1,234.5'), 1234.5);
  assert.equal(parseOddsText('1.0'), 1);
});

test('parseOddsText: 数値でないものは null', () => {
  for (const t of ['-', '欠場', '発売なし', '', '  ', '0', '0.0', '1.0-1.5', '特払', null, undefined, 5.3]) {
    assert.equal(parseOddsText(t), null, JSON.stringify(t));
  }
});

test('fixtures が揃っている（複数場・発売中・締切後・欠場・データなし）', () => {
  const states = new Set(ODDS2TF.map((f) => f.state));
  for (const s of ['live', 'closed', 'kekkajo', 'nodata']) assert.ok(states.has(s), s);
  assert.ok(new Set(ODDS2TF.map((f) => f.jcd)).size >= 10);
});

// ---- 全 fixture 共通の性質（場・レースによらず同じパーサーで読めること） ----
for (const fx of ODDS2TF.filter((f) => f.state !== 'nodata')) {
  test(`全場共通: ${fx.file}`, () => {
    const doc = load(fx.file);
    const { a, c } = parseOdds(doc);
    const meta = parseRaceMeta(doc);

    // メタ情報はファイル名（＝URL）と一致する
    assert.equal(meta.jcd, fx.jcd);
    assert.equal(meta.raceNo, fx.raceNo);
    assert.equal(meta.date, fx.date);
    assert.equal(meta.venue, VENUES[fx.jcd]);
    assert.match(meta.deadline, /^\d{1,2}:\d{2}$/);
    if (fx.state === 'live') {
      assert.equal(meta.oddsLabel, 'オッズ更新時間');
      assert.match(meta.updatedAt, /^\d{1,2}:\d{2}$/);
    } else {
      assert.equal(meta.oddsLabel, '締切時オッズ');
      assert.equal(meta.updatedAt, null);
    }

    // キーの形式と値
    for (const [k, v] of Object.entries(a)) {
      const m = /^([1-6])-([1-6])$/.exec(k);
      assert.ok(m && m[1] !== m[2], k);
      assert.ok(typeof v === 'number' && v >= 1, `${k}=${v}`);
    }
    for (const [k, v] of Object.entries(c)) {
      const m = /^([1-6])=([1-6])$/.exec(k);
      assert.ok(m && Number(m[1]) < Number(m[2]), k);
      assert.ok(typeof v === 'number' && v >= 1, `${k}=${v}`);
    }
    assert.ok(Object.keys(a).length <= 30);
    assert.ok(Object.keys(c).length <= 15);
    if (fx.state === 'closed') {
      // 欠場・発売票数0のない締切後レースは全組そろう
      assert.equal(Object.keys(a).length, 30);
      assert.equal(Object.keys(c).length, 15);
    }

    // 計算までエラーなく通る
    const rows = computeRows({ a, c });
    assert.equal(rows.length, 15);
  });
}

// ---- 個別のケース ----
test('発売中（大村9R）: 値と列の対応', () => {
  const doc = load('odds2tf_20261114_24_09_live.html');
  const { a, c } = parseOdds(doc);
  // 1列目=1着が1号艇、行ラベル=2着
  assert.equal(a['1-2'], 15.4);
  assert.equal(a['2-1'], 16.4);
  assert.equal(a['1-3'], 2.1);
  assert.equal(a['6-5'], 747.7);
  assert.equal(c['1=2'], 21.4);
  assert.equal(c['1=3'], 1.6);
  assert.equal(c['5=6'], 171.3);
  // 発売票数0の「0.0」は除外
  assert.equal('6-2' in a, false);
  assert.equal(Object.keys(a).length, 29);
  assert.equal(Object.keys(c).length, 15);

  assert.deepEqual(parseRaceMeta(doc), {
    venue: '大村',
    jcd: '24',
    raceNo: 9,
    date: '20261114',
    updatedAt: '18:55',
    oddsLabel: 'オッズ更新時間',
    deadline: '19:14',
    raceTitle: '予選 1800m',
    notice: null,
  });
});

test('発売中（大村9R）: 計算結果', () => {
  const rows = computeRows(parseOdds(load('odds2tf_20261114_24_09_live.html')));
  const r12 = rows.find((r) => r.pair === '1=2');
  const s = 1 / (1 / 15.4 + 1 / 16.4);
  assert.ok(Math.abs(r12.s - s) < 1e-9);
  assert.ok(Math.abs(r12.r - 21.4 / s) < 1e-9);
  // 2-6 は 6-2 が 0.0 なので計算不可 → 末尾
  assert.equal(rows[14].pair, '2=6');
  assert.equal(rows[14].r, null);
});

test('締切後（大村1R）: 1000倍以上の整数表示・締切予定時刻は表示中レースの列', () => {
  const doc = load('odds2tf_20261114_24_01_closed.html');
  assert.equal(parseOdds(doc).a['6-4'], 1244);
  const meta = parseRaceMeta(doc);
  assert.equal(meta.oddsLabel, '締切時オッズ');
  assert.equal(meta.deadline, '15:16'); // 発売中の9R（19:14）ではない
});

test('欠場（江戸川12R・6号艇欠場）: 欠場艇を含む組は出力しない', () => {
  const { a, c } = parseOdds(load('odds2tf_20261114_03_12_kekkajo.html'));
  assert.equal(Object.keys(a).length, 20);
  assert.equal(Object.keys(c).length, 10);
  for (const k of [...Object.keys(a), ...Object.keys(c)]) assert.ok(!k.includes('6'), k);
  const rows = computeRows({ a, c });
  assert.equal(rows.filter((r) => r.r === null).length, 5);
  assert.ok(rows.slice(10).every((r) => r.j === 6));
});

test('データなし（翌日・発売前）: 空の結果とお知らせ', () => {
  const doc = load('odds2tf_20261115_24_01_nodata.html');
  assert.deepEqual(parseOdds(doc), { a: {}, c: {} });
  assert.equal(parseRaceMeta(doc).notice, 'データがありません。');
});

test('別の賭式のページ（3連単）では何も拾わない', () => {
  assert.deepEqual(parseOdds(load('odds3t_20261114_24_09_live.html')), { a: {}, c: {} });
});

test('レース情報は doc.URL からも読める（タブのリンクが無い場合）', () => {
  const doc = parseHTML('<html><body></body></html>', 'https://www.boatrace.jp/owpc/pc/race/odds2tf?rno=7&jcd=05&hd=20261201');
  const meta = parseRaceMeta(doc);
  assert.equal(meta.raceNo, 7);
  assert.equal(meta.jcd, '05');
  assert.equal(meta.venue, '多摩川');
});

test('VENUES: 24場すべて', () => {
  assert.equal(Object.keys(VENUES).length, 24);
  for (let i = 1; i <= 24; i++) assert.ok(VENUES[String(i).padStart(2, '0')]);
  assert.equal(boatPairs().length, 15);
});
