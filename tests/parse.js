/*
 * Parser regression test for ../app.
 *
 * Runs every sample book through the app's own parsers (PDF, EPUB, Markdown)
 * and Cards.build, then compares the cards word by word with the saved
 * baseline in baseline/. Any changed word is listed, so a fix for one book
 * can't quietly change another.
 *
 *   node parse.js              compare with the baseline
 *   node parse.js --update     accept the current output as the new baseline
 *   APP=/path/to/app node parse.js   test another copy of the app
 */
'use strict';
const fs = require('fs');
const path = require('path');

// pdf.js warns about canvas, which text extraction does not need
const warn = console.warn, log = console.log;
console.warn = console.log = () => {};
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
console.warn = warn; console.log = log;

const { JSDOM } = require('jsdom');
global.DOMParser = new JSDOM('').window.DOMParser;
global.Image = class { set src(v) { setTimeout(() => this.onerror && this.onerror()); } };   // no covers in Node

const APP = process.env.APP || path.join(__dirname, '../app');
const PdfBook = require(APP + '/js/pdfbook.js');
const EpubBook = require(APP + '/js/epubbook.js');
const MdBook = require(APP + '/js/mdbook.js');
const Cards = require(APP + '/js/cards.js');
const JSZip = require('jszip');

const B = path.join(__dirname, '../..');   // the sample books sit next to the vanchan folder
const BOOKS = [
  { file: '10-Dadavani-Oct-2026-Guj.pdf' },
  { file: 'Aptvani-1.pdf' },
  { file: 'Aptvani-10U.pdf' },
  { file: 'Brahmcharya(P).pdf' },
  { file: 'Anticancer Living by Cohen and Jefferies_ Summary, Lessons and P.pdf' },
  { file: 'The 5AM Club by Robin Sharma_ Summary, Practical Guide and Evide.pdf' },
  { file: 'Aptavani-01.epub' },
  { file: 'aaptsutra-01.epub' },
  { file: 'dv102026guj.epub' },
  { file: 'vanchan/tests/sample.md' }
];

// words that must (or must not) appear: each one is a bug fixed earlier
const MUST = {
  'Aptvani-10U.pdf': ['શાસ્ત્રોનો', 'પ્રશ્નોનાં', 'વર્કીંગ'],
  'Brahmcharya(P).pdf': ['બન્ને', 'ઉત્પન્ન', 'તમન્ના', 'સ્ત્રીઓએ', 'સ્ટાર્ટીંગ', 'ક્યાં'],
  'Aptvani-1.pdf': ['ટ્રુથ', 'ૐ', '૨૦%', 'ટર્નીંગ'],
  'Anticancer Living by Cohen and Jefferies_ Summary, Lessons and P.pdf': ['findings', 'confirmation', 'fight'],
  'The 5AM Club by Robin Sharma_ Summary, Practical Guide and Evide.pdf': ['first hour', 'Own the first hour']
};
const MUST_NOT = [/[ﬀ-ﬆ]/, /[-]/, /\bnndings\b|\brst hour\b/];
// Latin-1 / glyph-code leftovers inside Gujarati words mean an unmapped legacy glyph
// (curly quotes are real punctuation in the output, so they don't count)
const LEFTOVER = /[\u0A80-\u0AFF][A-Za-z`\u00F8\u201E\u0178\u0080-\u00FF]|[A-Za-z`\u00F8\u201E\u0178\u0080-\u00FF][\u0A80-\u0AFF]/;

// Books with a printed index: share of entries that must open a card, and
// entries that must open a card with this exact title.
const INDEX_MIN = { 'Aptvani-10U.pdf': 0.95, 'Brahmcharya(P).pdf': 0.95, 'Aptvani-1.pdf': 0.95, 'dv102026guj.epub': 1, 'Aptavani-01.epub': 1 };
const INDEX_CHECK = {
  'Aptvani-10U.pdf': [['બુદ્ધિ કેટલી ‘અમારામાં ?’', 'બુદ્ધિ કેટલી ‘અમારામાં’ ?'], ['અબુધ - પ્રબુદ્ધ - અબુધ', 'અબુધ - પ્રબુદ્ધ - અબુધ']],
  'Brahmcharya(P).pdf': [['કીચડમાં ઠંડકની મઝા', 'કીચડમાં ઠંડકની મઝા']],
  'Aptvani-1.pdf': [['જગત સર્જન', 'જગત સર્જન']],
  'Aptavani-01.epub': [['આપ્ત વિજ્ઞાપન', 'આપ્ત વિજ્ઞાપન']]
};

// odd words that are in the publisher's own file, not made by the app
const SOURCE_TYPOS = { 'dv102026guj.epub': ['Fયારે'] };

function cardsText(cards) {
  return cards.map((c) => ['#' + c.n, c.ch && '[' + c.ch + ']', c.k && '{' + c.k + '}', c.num, c.t && '## ' + c.t,
    c.pg && 'p' + c.pg + (c.pe !== c.pg ? '-' + c.pe : ''), c.lb && 'L' + c.lb, c.kind === 'index' && 'INDEX'].filter(Boolean).join(' ') + '\n' +
    (c.kind === 'index' ? c.idx.map((s) => (s.h ? '### ' + s.h + '\n' : '') + s.e.map((e) => '- ' + e.t + ' … ' + (e.p || '')).join('\n')).join('\n') : c.p.join('\n'))).join('\n\n');
}

async function extract(file) {
  const buf = fs.readFileSync(path.join(B, file));
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  if (/\.pdf$/i.test(file)) {
    const r = await PdfBook.extract(pdfjs, data);
    r.doc.destroy();
    return r;
  }
  if (/\.epub$/i.test(file)) return EpubBook.extract(JSZip, data);
  return MdBook.extract(data);
}

function wordDiff(a, b) {
  // changed words, found by a line-level LCS-free scan: compare word multisets per card
  const A = a.split(/\s+/), Bw = b.split(/\s+/);
  const count = (arr) => arr.reduce((m, w) => (m.set(w, (m.get(w) || 0) + 1), m), new Map());
  const ca = count(A), cb = count(Bw), gone = [], added = [];
  ca.forEach((n, w) => { const d = n - (cb.get(w) || 0); for (let i = 0; i < d; i++) gone.push(w); });
  cb.forEach((n, w) => { const d = n - (ca.get(w) || 0); for (let i = 0; i < d; i++) added.push(w); });
  return { gone, added };
}

(async () => {
  const update = process.argv.includes('--update');
  const dir = path.join(__dirname, 'baseline');
  fs.mkdirSync(dir, { recursive: true });
  let fail = 0;
  for (const bk of BOOKS) {
    const name = path.basename(bk.file);
    if (!fs.existsSync(path.join(B, bk.file))) { log('SKIP  ' + name + ' (file missing)'); continue; }
    const t0 = Date.now();
    let r;
    try { r = await extract(bk.file); } catch (e) { log('FAIL  ' + name + ': ' + e.message); fail++; continue; }
    const cards = Cards.build(r.blocks);
    const text = cardsText(cards);
    const problems = [];
    if (!cards.length) problems.push('no cards');
    (MUST[name] || []).forEach((w) => { if (text.indexOf(w) < 0) problems.push('missing "' + w + '"'); });
    MUST_NOT.forEach((re) => { const m = text.match(re); if (m) problems.push('found ' + JSON.stringify(m[0])); });
    // the printed index: entries must open a card
    const ixCards = cards.filter((c) => c.kind === 'index');
    if (INDEX_MIN[name] !== undefined) {
      const ents = [].concat(...ixCards.map((c) => [].concat(...c.idx.map((x) => x.e))));
      const res = ents.map((e) => ({ e, c: Cards.indexTarget(cards, r.labels, e) }));
      const ok = res.filter((x) => x.c).length;
      if (!ents.length) problems.push('no index card');
      else if (ok / ents.length < INDEX_MIN[name]) problems.push('index: only ' + ok + ' of ' + ents.length + ' entries open a card');
      (INDEX_CHECK[name] || []).forEach(([entry, title]) => {
        const hit = res.find((x) => x.e.t === entry);
        if (!hit) problems.push('index: no entry "' + entry + '"');
        else if (!hit.c || hit.c.t !== title) problems.push('index: "' + entry + '" opens "' + (hit.c && hit.c.t) + '"');
      });
      if (process.env.SHOW_INDEX) res.slice(0, +process.env.SHOW_INDEX).forEach((x) => log('      ' + x.e.t + ' (' + (x.e.p || x.e.a) + ') → ' + (x.c ? x.c.t || x.c.p[0].slice(0, 40) : '-')));
    }
    const left = cards.map((c) => c.p.join(' ')).join(' ').split(/\s+/).filter((w) => LEFTOVER.test(w) && (SOURCE_TYPOS[name] || []).indexOf(w) < 0);
    if (left.length) problems.push(left.length + ' words with glyph leftovers, e.g. ' + left.slice(0, 5).join(' '));
    const bfile = path.join(dir, name + '.txt');
    if (update || !fs.existsSync(bfile)) {
      fs.writeFileSync(bfile, text);
      log((problems.length ? 'FAIL  ' : 'BASE  ') + name + ': ' + cards.length + ' cards, baseline written' + (problems.length ? ' — ' + problems.join('; ') : ''));
      if (problems.length) fail++;
      continue;
    }
    const base = fs.readFileSync(bfile, 'utf8');
    if (base !== text) {
      const d = wordDiff(base, text);
      const nb = (base.match(/^#\d+/gm) || []).length;
      problems.push('differs from baseline (' + nb + ' → ' + cards.length + ' cards; ' + d.gone.length + ' words gone, ' + d.added.length + ' new)' +
        (d.gone.length + d.added.length ? ': -' + d.gone.slice(0, 6).join(' -') + ' +' + d.added.slice(0, 6).join(' +') : ' (order or layout only)'));
    }
    if (problems.length) { fail++; log('FAIL  ' + name + ': ' + problems.join('; ')); }
    else log('PASS  ' + name + ': ' + cards.length + ' cards (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
  }
  log(fail ? '\n' + fail + ' book(s) failed' : '\nAll books pass');
  process.exit(fail ? 1 : 0);
})();
