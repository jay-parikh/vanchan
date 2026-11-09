/*
 * Unit tests for the merge rules in ../app/js/sync.js.
 *   node unit.js
 */
'use strict';
const path = require('path');
const APP = process.env.APP || path.join(__dirname, '../app');
const Sync = require(APP + '/js/sync.js').Sync || global.Sync;
const merge = Sync._merge;

let fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '\n      got  ' + JSON.stringify(got) + '\n      want ' + JSON.stringify(want)));
}
const P = (o) => Object.assign({ parser: 2, read: {}, readReset: 0, marks: {}, hidden: {}, pos: null }, o);

eq('read cards: union, latest time kept per card',
  merge(P({ read: { 1: 10, 2: 20 } }), P({ read: { 2: 5, 3: 30 } })).read, { 1: 10, 2: 20, 3: 30 });
eq('"mark all unread" clears what was read before it, keeps later reads',
  merge(P({ read: { 1: 10, 2: 50 } }), P({ readReset: 40 })).read, { 2: 50 });
eq('saved: newest change wins (removal newer)',
  merge(P({ marks: { 5: 100 } }), P({ marks: { 5: -200 } })).marks, { 5: -200 });
eq('saved: newest change wins (save newer)',
  merge(P({ marks: { 5: -100 } }), P({ marks: { 5: 200 } })).marks, { 5: 200 });
eq('saved: cards from both sides kept',
  merge(P({ marks: { 1: 10 } }), P({ marks: { 2: 20 } })).marks, { 1: 10, 2: 20 });
eq('a card never synced (time 1) loses to a real change elsewhere',
  merge(P({ hidden: { 7: 1 } }), P({ hidden: { 7: -300 } })).hidden, { 7: -300 });
eq('last read card: newest wins',
  merge(P({ pos: { n: '3', at: 100, device: 'a' } }), P({ pos: { n: '9', at: 200, device: 'b' } })).pos, { n: '9', at: 200, device: 'b' });
eq('last read card: one side only',
  merge(P({ pos: { n: '3', at: 100, device: 'a' } }), P({})).pos, { n: '3', at: 100, device: 'a' });
eq('merging is the same both ways',
  merge(P({ read: { 1: 10 }, marks: { 2: -5 }, pos: { n: '1', at: 9 } }), P({ read: { 3: 4 }, marks: { 2: 6 }, readReset: 2 })),
  merge(P({ read: { 3: 4 }, marks: { 2: 6 }, readReset: 2 }), P({ read: { 1: 10 }, marks: { 2: -5 }, pos: { n: '1', at: 9 } })));
eq('merging with nothing gives the same',
  merge(P({ read: { 1: 10 }, marks: { 2: 3 } }), null), P({ read: { 1: 10 }, marks: { 2: 3 } }));

/* ---------- marks ---------- */
const Marks = require(APP + '/js/marks.js');
const Ink = require(APP + '/js/ink.js');
const Cards = require(APP + '/js/cards.js');

// pen strokes: stored relative to the surface, so another size draws the same shape
const pts = [[10, 20], [11.6, 23.2], [40, 80], [40, 80], [100, 5]];
const d = Ink.encode(pts, 200, 400);
const back = Ink.decode(d, 200, 400).map((p) => p.map((v) => Math.round(v * 10) / 10));
eq('pen stroke survives encode/decode (repeated points dropped)', back, [[10, 20], [11.6, 23.2], [40, 80], [100, 5]]);
eq('pen stroke scales with the surface', Ink.decode(d, 400, 800).map((p) => p.map(Math.round))[2], [80, 160]);
eq('pen stroke is small (integers, delta-encoded)', d.every((v) => Number.isInteger(v)) && JSON.stringify(d).length < 60, true);

// words found again by their quote and surroundings
const text = 'એ તો કેવી રીતે કહી શકાય ? બુદ્ધિ તો ખરી. પણ બુદ્ધિ તો ખરી જ ને ?';
const second = text.lastIndexOf('બુદ્ધિ તો ખરી');
const m = Object.assign({ s: second }, Marks.context(text, second, second + 'બુદ્ધિ તો ખરી'.length));
eq('the right one of two equal phrases is found', Marks.findQuote(text, m), [second, second + 'બુદ્ધિ તો ખરી'.length]);
eq('a phrase that is gone is not found', Marks.findQuote('કંઈ બીજું', m), null);

// re-reading by a new parser: the mark moves with its words
const card = { n: 7, p: ['પહેલો ફકરો.', 'પ્રશ્નકર્તા : એ તો કેવી રીતે કહી શકાય ? બુદ્ધિ તો ખરી.'] };
const shown = Marks.paraText(card.p[1], Cards.splitSpeaker);
eq('a paragraph with a speaker reads "who : rest", as the card shows it', shown, 'પ્રશ્નકર્તા : એ તો કેવી રીતે કહી શકાય ? બુદ્ધિ તો ખરી.');
const at = shown.indexOf('કહી શકાય');
const mk = Object.assign({ type: 'text', n: 3, p: 0, s: at }, Marks.context(shown, at, at + 'કહી શકાય'.length));
const moved = Marks.reanchor(mk, card, Cards.splitSpeaker);
eq('a highlight follows its words to their new card and paragraph', [moved.n, moved.p, shown.slice(moved.s, moved.e)], [7, 1, 'કહી શકાય']);
eq('a highlight whose words are gone is reported', Marks.reanchor(Object.assign({}, mk, { q: 'નથી એવું' }), card, Cards.splitSpeaker), null);

// newest change wins between two devices
eq('newest copy of a mark wins', Marks.newer({ id: 'a', at: 5, color: 'yellow' }, { id: 'a', at: 9, color: 'green' }).color, 'green');
eq('a deletion that is newer wins', Marks.newer({ id: 'a', at: 9, del: true }, { id: 'a', at: 5 }).del, true);

// highlight spans across a bold speaker name and the text after it
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<p id="x"><b>પ્રશ્નકર્તા :</b> એ તો કેવી રીતે</p>');
const para = dom.window.document.getElementById('x');
const full = para.textContent;
Marks.wrapRanges(para, [{ s: full.indexOf('ર્તા'), e: full.indexOf('કેવી'), make: () => { const sp = dom.window.document.createElement('span'); sp.className = 'hl'; return sp; } }]);
eq('a highlight can start inside the bold name and end in the text', Array.from(para.querySelectorAll('.hl')).map((e) => e.textContent).join('|'), 'ર્તા :| એ તો ');
eq('wrapping keeps the paragraph text the same', para.textContent, full);
const tn = para.querySelectorAll('.hl')[1].firstChild;
eq('a point inside the text maps back to its offset', Marks.offsetIn(para, tn, 2), full.indexOf(' એ તો ') + 2);

// share text
const cardsBy = { 3: { n: 3, ch: '(૧) અબુધતા', t: 'બુદ્ધિ કેટલી ?', pg: 5 } };
const txt = Marks.exportText('Aptavani-10', [
  { type: 'text', n: 3, p: 0, q: 'તમે બુદ્ધિશાળી છો', note: { text: 'ફરી વાંચવું' } },
  { type: 'cardnote', n: 3, note: { ink: [] } },
  { type: 'ink-page', pg: 22 },
  { type: 'text', n: 3, q: 'gone', del: true }
], (n) => cardsBy[n], () => 'Page ૧', () => '૨૨');
eq('share text lists quotes, notes, hand-written notes and pen pages', txt.split('\n').filter(Boolean),
  ['Aptavani-10 — highlights & notes', '(૧) અબુધતા · બુદ્ધિ કેટલી ? · Page ૧', '“તમે બુદ્ધિશાળી છો”', 'Note: ફરી વાંચવું',
   '(૧) અબુધતા · બુદ્ધિ કેટલી ? · Page ૧', '(hand-written note)', 'Page ૨૨', '(pen marks)']);

console.log(fail ? '\n' + fail + ' unit test(s) failed' : '\nAll unit tests pass');
process.exit(fail ? 1 : 0);
