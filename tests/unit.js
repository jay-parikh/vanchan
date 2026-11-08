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

console.log(fail ? '\n' + fail + ' unit test(s) failed' : '\nAll unit tests pass');
process.exit(fail ? 1 : 0);
