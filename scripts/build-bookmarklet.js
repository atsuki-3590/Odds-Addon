#!/usr/bin/env node
/*
 * build-bookmarklet.js — スマホ用ブックマークレットを生成する（依存パッケージなし）
 *
 *   node scripts/build-bookmarklet.js          dist/bookmarklet.txt と dist/install.html を書き出す
 *   node scripts/build-bookmarklet.js --check  dist/ が最新か確認（差分があれば終了コード 1）
 *
 * 構成: javascript:(function(){ parser.js ; RESULT_TEMPLATE ; bookmarklet/main.js })()
 * RESULT_TEMPLATE は結果ページの HTML（sidepanel.html のマークアップ + sidepanel.css +
 * calc.js / view.js / bookmarklet/result.js をインライン化したもの）。
 * ページのグローバル変数を汚さないよう、関数スコープ内で globalThis / module をローカル変数で隠す。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** 行頭から始まるコメント行・ブロックコメントと字下げを取り除く（行内のコードには手を付けない） */
function strip(src) {
  const out = [];
  let inBlock = false;
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlock = true;
      continue;
    }
    if (line === '' || line.startsWith('//') || line.startsWith('#!')) continue;
    out.push(line);
  }
  return out.join('\n');
}

function resultTemplate() {
  const panel = read('sidepanel.html');
  const body = /<body>([\s\S]*?)<\/body>/.exec(panel)[1].replace(/<script[^>]*><\/script>\s*/g, '').trim();
  const css = read('sidepanel.css') + `
.back { margin: -12px -12px 10px; padding: 10px 12px; border-bottom: 1px solid var(--border); background: var(--head-bg); }
.back a { color: inherit; font-weight: 600; text-decoration: none; }
.hint { color: var(--muted); font-size: 11px; margin: 10px 0 0; }
`;
  const js = [read('src/calc.js'), read('src/view.js'), read('bookmarklet/result.js')].map(strip).join('\n');
  for (const [name, s] of [['css', css], ['js', js]]) {
    if (/<\/(script|style)/i.test(s)) throw new Error(`${name} に </script> または </style> が含まれています`);
  }
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>オッズ歪みチェッカー</title>
<style>${css}</style>
</head>
<body>
<nav class="back"><a href="#" id="back">← オッズページに戻る</a></nav>
${body}
<p class="hint">最新のオッズで計算し直すには、戻ってページの「更新」を押し、もう一度ブックマークを実行してください。3連単と3連複のように別ページどうしの比較は、それぞれのページで1回ずつ実行すると表示されます。</p>
<script type="application/json" id="payload">__PAYLOAD__</script>
<script>
${js}
</script>
</body>
</html>
`;
}

function buildCode() {
  return [
    '(function(){',
    'var globalThis={};var module;',
    strip(read('src/parser.js')),
    `var RESULT_TEMPLATE=${JSON.stringify(resultTemplate())};`,
    strip(read('bookmarklet/main.js')),
    '})();',
  ].join('\n');
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function installPage(url) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>オッズ歪みチェッカー（スマホ用）の登録</title>
<style>
:root { --bg:#fff; --fg:#1f2328; --muted:#6b7280; --border:#d0d7de; --accent:#1e40af; --chip:#dbeafe; }
@media (prefers-color-scheme: dark) { :root { --bg:#1b1d21; --fg:#e6e8eb; --muted:#9aa1ab; --border:#3a3f47; --accent:#bfdbfe; --chip:#1e3a5f; } }
body { margin:0 auto; max-width:720px; padding:16px; background:var(--bg); color:var(--fg);
  font:15px/1.7 system-ui,-apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif; }
h1 { font-size:20px; } h2 { font-size:16px; margin-top:28px; }
.bm { display:inline-block; padding:8px 14px; border-radius:8px; background:var(--chip); color:var(--accent);
  font-weight:700; text-decoration:none; border:1px dashed var(--accent); }
textarea { width:100%; height:6em; font:12px monospace; box-sizing:border-box; }
button { font:inherit; padding:6px 14px; }
.note { color:var(--muted); font-size:13px; }
ol li { margin-bottom:6px; }
code { background:var(--chip); padding:0 4px; border-radius:4px; }
</style>
</head>
<body>
<h1>オッズ歪みチェッカー（スマホ用ブックマークレット）</h1>
<p>オッズページ（2連単・2連複／3連単／3連複／拡連複）で実行すると、同じ的中条件になる買い方の合成オッズを比べた表を別ページに表示します。
ページの DOM を読むだけで、通信や外部送信はしません。読み取った結果はこの端末のブラウザにレースごとに保存され、
3連単と3連複のように別ページどうしの比較は、それぞれのページで1回ずつ実行すると表示されます。</p>

<h2>1. PC の Chrome でブックマークに登録</h2>
<ol>
<li>ブックマークバーを表示（Ctrl+Shift+B / Mac は ⌘+Shift+B）</li>
<li>下のボタンをブックマークバーへ<b>ドラッグ＆ドロップ</b><br>
<a class="bm" href="${escapeHtml(url)}">オッズ比較</a></li>
<li>名前は「<b>オッズ比較</b>」のままにしておく（スマホで呼び出すときに入力します）</li>
</ol>
<p class="note">ドラッグできない場合：Ctrl+D で適当なページをブックマークし、編集で名前を「オッズ比較」、URL を下のテキストに置き換える。</p>
<textarea id="code" readonly>${escapeHtml(url)}</textarea>
<button type="button" id="copy">URL をコピー</button> <span id="copied" class="note"></span>

<h2>2. スマホ（Android の Chrome）に同期</h2>
<ol>
<li>PC とスマホの Chrome で同じ Google アカウントにログインし、同期の「ブックマーク」をオンにする</li>
<li>少し待つと、スマホのブックマークにも「オッズ比較」が出てくる</li>
</ol>

<h2>3. スマホで使う</h2>
<ol>
<li>Chrome でオッズページを開く（2連単・2連複／3連単／3連複／拡連複。スマホ版のページから実行すると、同じレースの PC 版ページへ移動するか聞かれます）</li>
<li><b>アドレスバーをタップ</b>して <code>オッズ比較</code> と入力し、候補に出る<b>★ブックマーク</b>の「オッズ比較」をタップ<br>
<span class="note">※ ブックマーク一覧画面からタップしても動きません（Android の Chrome の仕様）。必ずアドレスバーから呼び出してください。</span></li>
<li>結果ページが開きます。「← オッズページに戻る」かブラウザの戻るで元のページへ</li>
<li>結果ページの「3連複を開く」などのボタンで同じレースの別のオッズページへ移動し、そこでもう一度実行すると、3連単×3連複などの比較も表示されます</li>
<li>オッズを更新したいときは、オッズページの「更新」を押してから、もう一度実行</li>
</ol>
<p class="note">しきい値（初期値 1.10 / 0.90）と「しきい値を超えた組だけ表示」は結果ページの「表示の設定」で変更でき、その端末に保存されます。</p>

<script>
document.getElementById('copy').addEventListener('click', function () {
  var t = document.getElementById('code');
  t.select();
  var done = function () { document.getElementById('copied').textContent = 'コピーしました'; };
  if (navigator.clipboard) navigator.clipboard.writeText(t.value).then(done, function () { document.execCommand('copy'); done(); });
  else { document.execCommand('copy'); done(); }
});
</script>
</body>
</html>
`;
}

function build() {
  const code = buildCode();
  const url = `javascript:${encodeURIComponent(code)}`;
  return { code, url, files: { 'dist/bookmarklet.txt': `${url}\n`, 'dist/install.html': installPage(url) } };
}

module.exports = { build, strip };

if (require.main === module) {
  const { files, url } = build();
  const check = process.argv.includes('--check');
  let stale = false;
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(ROOT, rel);
    if (check) {
      const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
      if (current !== content) {
        stale = true;
        console.error(`古くなっています: ${rel}（node scripts/build-bookmarklet.js を実行してください）`);
      }
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      console.log(`書き出し: ${rel}`);
    }
  }
  if (!check) console.log(`ブックマークレットの長さ: ${url.length} 文字`);
  process.exit(stale ? 1 : 0);
}
