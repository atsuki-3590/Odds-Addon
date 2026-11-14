/*
 * mini-dom.js — テスト専用の最小限の HTML パーサー（依存パッケージなし）
 *
 * src/parser.js が使う DOM API だけを実装する:
 *   getElementsByClassName / getElementsByTagName / children / parentElement /
 *   nextElementSibling / textContent / getAttribute / classList.contains / tagName
 * ブラウザの HTML パーサーの完全な再現ではない（暗黙の閉じタグなどは簡略化）。
 * 実ブラウザとの一致は test/browser-check.js（Playwright・任意実行）で確認する。
 */
'use strict';

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
// 開始タグが来たら、開いている同名（または指定）要素を暗黙に閉じるもの
const AUTO_CLOSE = {
  li: ['li'], dt: ['dt', 'dd'], dd: ['dt', 'dd'], tr: ['tr', 'td', 'th'], td: ['td', 'th'], th: ['td', 'th'],
  option: ['option'], thead: ['tbody', 'tfoot', 'tr', 'td', 'th'], tbody: ['thead', 'tbody', 'tr', 'td', 'th'],
  tfoot: ['thead', 'tbody', 'tr', 'td', 'th'],
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', yen: '¥', copy: '©' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const v = ENTITIES[e.toLowerCase()];
    return v !== undefined ? v : m;
  });
}

class Node {
  constructor() {
    this.parentElement = null;
    this.childNodes = [];
  }
  get textContent() {
    return this.childNodes.map((n) => n.textContent).join('');
  }
}

class Text extends Node {
  constructor(data) {
    super();
    this.data = data;
  }
  get textContent() {
    return this.data;
  }
}

class Element extends Node {
  constructor(tag, attrs) {
    super();
    this.tagName = tag.toUpperCase();
    this.localName = tag;
    this.attributes = attrs;
    const cls = (attrs.class || '').split(/\s+/).filter(Boolean);
    this.classList = { contains: (c) => cls.includes(c), length: cls.length };
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }
  get children() {
    return this.childNodes.filter((n) => n instanceof Element);
  }
  get nextElementSibling() {
    const p = this.parentElement;
    if (!p) return null;
    const sibs = p.children;
    const i = sibs.indexOf(this);
    return i >= 0 && i + 1 < sibs.length ? sibs[i + 1] : null;
  }
  *_descendants() {
    for (const c of this.children) {
      yield c;
      yield* c._descendants();
    }
  }
  getElementsByTagName(tag) {
    const t = tag.toUpperCase();
    return [...this._descendants()].filter((e) => t === '*' || e.tagName === t);
  }
  getElementsByClassName(names) {
    const list = names.split(/\s+/).filter(Boolean);
    return [...this._descendants()].filter((e) => list.every((c) => e.classList.contains(c)));
  }
}

class Document extends Element {
  constructor() {
    super('#document', {});
    this.URL = '';
  }
}

function parseAttrs(src) {
  const attrs = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase();
    const raw = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
    if (!(name in attrs)) attrs[name] = decodeEntities(raw);
  }
  return attrs;
}

/** HTML 文字列 → Document */
function parseHTML(html, url = '') {
  const doc = new Document();
  doc.URL = url;
  const stack = [doc];
  const top = () => stack[stack.length - 1];
  const append = (node) => {
    node.parentElement = top() === doc ? null : top();
    top().childNodes.push(node);
  };

  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      append(new Text(decodeEntities(html.slice(i))));
      break;
    }
    if (lt > i) append(new Text(decodeEntities(html.slice(i, lt))));

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt);
      const name = html.slice(lt + 2, end === -1 ? n : end).trim().toLowerCase();
      // 開いている同名要素まで閉じる（無ければ無視）
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].localName === name) {
          stack.length = k;
          break;
        }
      }
      i = end === -1 ? n : end + 1;
      continue;
    }
    const m = /^<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(html.slice(lt, lt + 4096));
    if (!m) {
      append(new Text('<'));
      i = lt + 1;
      continue;
    }
    const tag = m[1].toLowerCase();
    let attrSrc = m[2];
    const selfClosing = /\/\s*$/.test(attrSrc);
    if (selfClosing) attrSrc = attrSrc.replace(/\/\s*$/, '');
    i = lt + m[0].length;

    const closes = AUTO_CLOSE[tag];
    if (closes) {
      // 直近のテーブル/リスト境界より内側にある対象要素だけを閉じる
      for (let k = stack.length - 1; k > 0; k--) {
        const name = stack[k].localName;
        if (['table', 'ul', 'ol', 'dl', 'select'].includes(name)) break;
        if (closes.includes(name)) {
          stack.length = k;
          break;
        }
      }
    }

    const el = new Element(tag, parseAttrs(attrSrc));
    append(el);
    if (VOID.has(tag) || selfClosing) continue;
    if (RAW_TEXT.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, i);
      const end = close === -1 ? n : close;
      const text = html.slice(i, end);
      el.childNodes.push(new Text(tag === 'title' || tag === 'textarea' ? decodeEntities(text) : text));
      const gt = close === -1 ? n : html.indexOf('>', close);
      i = gt === -1 ? n : gt + 1;
      continue;
    }
    stack.push(el);
  }
  return doc;
}

module.exports = { parseHTML };
