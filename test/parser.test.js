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

// ---- 3連単・3連複・拡連複のページ ----
const { parsePage, raceKey, parseRangeText, detectPageType } = require('../src/parser.js');
const { SECTIONS, absentBoats } = require('../src/calc.js');

const PATHS = { '3t': 'odds3t', '3f': 'odds3f', k: 'oddsk', '2tf': 'odds2tf' };
const ALL = fs.readdirSync(FIXTURES)
  .map((f) => /^(odds2tf|odds3t|odds3f|oddsk)_(\d{8})_(\d{2})_(\d{2})_(\w+)\.html$/.exec(f))
  .filter(Boolean)
  .map(([file, path, date, jcd, rno, state]) => ({
    file, path, date, jcd, raceNo: Number(rno), state,
    type: { odds2tf: '2tf', odds3t: '3t', odds3f: '3f', oddsk: 'k' }[path],
  }));
const loadAt = (fx) => parseHTML(
  fs.readFileSync(path.join(FIXTURES, fx.file), 'utf8'),
  `https://www.boatrace.jp/owpc/pc/race/${fx.path}?rno=${fx.raceNo}&jcd=${fx.jcd}&hd=${fx.date}`,
);

test('parseRangeText: 拡連複の「下限-上限」', () => {
  assert.deepEqual(parseRangeText('2.2-3.0'), [2.2, 3]);
  assert.deepEqual(parseRangeText(' 1.1 - 1.1 '), [1.1, 1.1]);
  assert.deepEqual(parseRangeText('105.3-1244'), [105.3, 1244]);
  for (const t of ['欠場', '-', '2.2', '3.0-2.2', '0.0-1.0', '', null]) assert.equal(parseRangeText(t), null, String(t));
});

const EXPECTED_COUNTS = {
  '3t': { full: 120, kekkajo: 60, key: 't' },
  '3f': { full: 20, kekkajo: 10, key: 'f' },
  k: { full: 15, kekkajo: 10, key: 'k' },
};

for (const fx of ALL.filter((f) => f.type !== '2tf')) {
  test(`3連単・3連複・拡連複: ${fx.file}`, () => {
    const page = parsePage(loadAt(fx));
    assert.equal(page.type, fx.type);
    const exp = EXPECTED_COUNTS[fx.type];
    const odds = page.odds[exp.key];
    if (fx.state === 'nodata') {
      assert.deepEqual(odds, {});
      assert.equal(page.meta.notice, 'データがありません。');
      return;
    }
    assert.equal(raceKey(page.meta), `${fx.date}_${fx.jcd}_${fx.raceNo}`);
    assert.equal(Object.keys(odds).length, fx.state === 'kekkajo' ? exp.kekkajo : exp.full);
    assert.deepEqual(page.absent, fx.state === 'kekkajo' ? [6] : []);
    for (const [key, v] of Object.entries(odds)) {
      if (fx.type === '3t') assert.match(key, /^([1-6])-(?!\1)([1-6])-(?!\1|\2)[1-6]$/);
      else if (fx.type === '3f') {
        const b = key.split('=').map(Number);
        assert.ok(b.length === 3 && b[0] < b[1] && b[1] < b[2], key);
      } else {
        const b = key.split('=').map(Number);
        assert.ok(b.length === 2 && b[0] < b[1], key);
      }
      if (fx.type === 'k') assert.ok(Array.isArray(v) && v[0] >= 1 && v[0] <= v[1], `${key}=${v}`);
      else assert.ok(typeof v === 'number' && v >= 1, `${key}=${v}`);
    }
  });
}

test('3連単（大村12R 発売中）: 列=1着、rowspan の艇=2着、行の艇=3着', () => {
  const page = parsePage(load('odds3t_20261114_24_12_live.html'));
  assert.equal(page.type, '3t');
  assert.equal(page.odds.t['1-2-3'], 12.1);
  assert.equal(page.odds.t['1-2-4'], 27.5);
  assert.equal(page.odds.t['2-1-3'], 79);
  assert.equal(page.odds.t['3-1-2'], 58.9);
  assert.equal(page.meta.updatedAt, '19:41');
});

test('3連複・拡連複（大村12R 発売中）: 値', () => {
  const f = parsePage(load('odds3f_20261114_24_12_live.html'));
  assert.equal(f.odds.f['1=2=3'], 5.9);
  assert.equal(f.odds.f['1=2=4'], 15.7);
  const k = parsePage(load('oddsk_20261114_24_12_live.html'));
  assert.deepEqual(k.odds.k['1=2'], [2.2, 3]);
  assert.deepEqual(k.odds.k['1=3'], [1.1, 1.1]);
  assert.deepEqual(k.odds.k['2=3'], [4.3, 6.9]);
});

test('ページの種類はタブから判定（URL が無くても）', () => {
  assert.equal(detectPageType(load('odds2tf_20261114_24_09_live.html')), '2tf');
  assert.equal(detectPageType(load('odds3t_20261114_24_12_live.html')), '3t');
  assert.equal(detectPageType(load('odds3f_20261114_24_12_live.html')), '3f');
  assert.equal(detectPageType(load('oddsk_20261114_24_12_live.html')), 'k');
});

test('同じレースの4ページから4つの比較がすべて計算できる（大村12R・江戸川12R 欠場）', () => {
  for (const [race, state] of [['20261114_24_12', 'live'], ['20261114_03_12', 'kekkajo']]) {
    const pages = {};
    for (const fx of ALL.filter((f) => `${f.date}_${f.jcd}_${String(f.raceNo).padStart(2, '0')}` === race && f.state === state)) {
      pages[fx.type] = { ok: true, ...parsePage(loadAt(fx)) };
    }
    assert.deepEqual(Object.keys(pages).sort(), ['2tf', '3f', '3t', 'k']);
    const absent = absentBoats(pages);
    for (const s of SECTIONS) {
      const rows = s.compute(pages, absent);
      const computable = rows.filter((r) => r.r !== null || r.rRange);
      assert.ok(computable.length > 0, `${race} ${s.id}`);
      if (state === 'live') assert.equal(computable.length, rows.length, `${race} ${s.id}`);
      else assert.ok(rows.filter((r) => r.absent).every((r) => r.boats.includes(6)));
    }
  }
});

test('3連単6点 vs 3連複（大村12R）: 1=2=3 の合成を手計算と照合', () => {
  const t = parsePage(load('odds3t_20261114_24_12_live.html')).odds.t;
  const f = parsePage(load('odds3f_20261114_24_12_live.html')).odds.f;
  const legs = ['1-2-3', '1-3-2', '2-1-3', '2-3-1', '3-1-2', '3-2-1'].map((k) => t[k]);
  const s = 1 / legs.reduce((acc, o) => acc + 1 / o, 0);
  const row = SECTIONS[1].compute({ '3t': { odds: { t } }, '3f': { odds: { f } } }, []).find((r) => r.key === '1=2=3');
  assert.ok(Math.abs(row.s - s) < 1e-9);
  assert.ok(Math.abs(row.r - f['1=2=3'] / s) < 1e-9);
});
