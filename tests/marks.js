/*
 * Browser test for marking: highlights (colours, underline, across
 * paragraphs), notes (typed and hand-written, on words and on a card), the
 * pen on a card and on a PDF page, the Saved → Highlights & notes list and
 * its share text, the printed index card, and marks surviving a reload, a
 * text-size change and a re-read of the book.   node marks.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

const APP = process.env.APP || path.join(__dirname, '../app');
const B = path.join(__dirname, '../..');
const WORK = path.join(__dirname, '.work-marks');
const SITE = path.join(WORK, 'site');
const SHOTS = path.join(__dirname, 'shots');
const LIBS = path.join(__dirname, '.libs');
const PORT = 8771;
process.env.LD_LIBRARY_PATH = [LIBS + '/usr/lib/x86_64-linux-gnu', LIBS + '/lib/x86_64-linux-gnu', LIBS + '/usr/lib'].join(':');

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  — ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' };
  return new Promise((ok) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(SITE, p);
      if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(f).pipe(res);
    }).listen(PORT, '127.0.0.1', () => ok(srv));
  });
}

(async () => {
  execSync('rm -rf ' + JSON.stringify(WORK) + ' && mkdir -p ' + JSON.stringify(WORK) + ' ' + JSON.stringify(SHOTS));
  execSync('cp -r ' + JSON.stringify(APP) + ' ' + JSON.stringify(SITE));
  fs.writeFileSync(path.join(SITE, 'js/config.js'), 'window.VANCHAN_SYNC = null;\n');
  const srv = await serve();
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-gpu'], userDataDir: path.join(WORK, 'profile') });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const URL = 'http://localhost:' + PORT + '/';
  const cur = '.card:not(.under)';
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + '.png') });
  const tap = async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 6000 }); await page.tap(sel); await sleep(350); };
  // a real tap: the control must be on screen and not covered, or the test fails naming it
  const click = async (sel) => {
    const r = await page.evaluate((s) => {
      const e = document.querySelector(s); if (!e) return { why: 'missing' };
      let b = e.getBoundingClientRect(); if (!b.width || !b.height) return { why: 'not shown' };
      // further down the card or list: scroll to it, as a reader would
      if (b.top < 0 || b.bottom > innerHeight) { e.scrollIntoView({ block: 'center' }); b = e.getBoundingClientRect(); }
      const x = b.left + b.width / 2, y = b.top + b.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { why: 'off screen' };
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === e || e.contains(hit))) return { why: 'covered by ' + (hit && (hit.id || hit.className || hit.tagName)) };
      return { x, y };
    }, sel);
    if (r.why) throw new Error('cannot tap ' + sel + ': ' + r.why);
    await page.mouse.click(r.x, r.y);
  };
  const back = async () => { await page.evaluate(() => history.back()); await sleep(400); };
  const curId = () => page.evaluate((c) => document.querySelector(c).dataset.id, cur);
  const marks = () => page.evaluate(() => new Promise((res) => {
    const rq = indexedDB.open('vanchan');
    rq.onsuccess = () => { const g = rq.result.transaction('marks').objectStore('marks').getAll(); g.onsuccess = () => { rq.result.close(); res(g.result.filter((m) => !m.del)); }; };
  }));
  // selects text in the current card: paragraph i, from the start of `from` to the end of `to`
  const select = (i, from, to, j) => page.evaluate((c, i, from, to, j) => {
    const text = (k) => document.querySelector(c + ' .text p[data-i="' + k + '"]');
    const pointAt = (p, offset) => {
      const w = document.createTreeWalker(p, 4); let n, pos = 0;
      while ((n = w.nextNode())) { if (offset <= pos + n.nodeValue.length) return [n, offset - pos]; pos += n.nodeValue.length; }
      return [n, 0];
    };
    const p1 = text(i), p2 = text(j === undefined ? i : j);
    p1.scrollIntoView({ block: 'center' });   // a reader selects words they can see
    const s = p1.textContent.indexOf(from), e = p2.textContent.indexOf(to) + to.length;
    const r = document.createRange();
    r.setStart(...pointAt(p1, s)); r.setEnd(...pointAt(p2, e));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
    return sel.toString();
  }, cur, i, from, to, j);
  const hlText = () => page.evaluate((c) => {
    const out = {}, order = [];
    document.querySelectorAll(c + ' .text .hl').forEach((e) => {
      const id = e.dataset.mark;
      if (!out[id]) { out[id] = e.className.replace(/^hl ?/, '').trim() + ':'; order.push(id); }
      out[id] += e.textContent;
    });
    return order.map((id) => out[id]);
  }, cur);
  const draw = async (sel, pts) => {
    const box = await (await page.$(sel)).boundingBox();
    await page.mouse.move(box.x + pts[0][0] * box.width, box.y + pts[0][1] * box.height);
    await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(box.x + p[0] * box.width, box.y + p[1] * box.height, { steps: 4 });
    await page.mouse.up();
    await sleep(250);
  };
  const inked = (sel) => page.evaluate((s) => {
    const c = document.querySelector(s); if (!c || !c.width) return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  }, sel);

  // top of the drawing on a canvas, in CSS px from the canvas top
  const inkTop = (sel) => page.evaluate((s) => {
    const c = document.querySelector(s); if (!c || !c.width) return -1;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, scale = c.height / c.clientHeight;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3]) return Math.round(y / scale);
    return -1;
  }, sel);

  try {
    await page.goto(URL, { waitUntil: 'networkidle0' });
    for (const f of ['10-Dadavani-Oct-2026-Guj.pdf', 'Aptvani-1.pdf']) {
      await (await page.$('#file')).uploadFile(path.join(B, f));
      await page.waitForFunction(() => document.getElementById('importModal').hidden, { timeout: 300000 });
      await sleep(800);
    }
    // read Dadavani in book order from its first sayings card
    await tap('#btnLib');
    await page.evaluate(() => Array.from(document.querySelectorAll('#bookList .book-main')).find((b) => /Dadavani/i.test(b.innerText)).click());
    await sleep(500);
    await page.evaluate(() => { const b = document.querySelector('.card:not(.under) .band'); b.click(); });
    await sleep(400);
    await page.evaluate(() => { const it = Array.from(document.querySelectorAll('#tocList .toc-item')).find((x) => /સૂત્ર/.test(x.innerText)) || document.querySelectorAll('#tocList .toc-item')[2]; it.click(); });
    await sleep(700);
    const startId = await curId();
    const p0 = await page.evaluate((c) => { const ps = document.querySelectorAll(c + ' .text p'); return Array.from(ps).map((p) => p.textContent); }, cur);
    check('a card with at least three paragraphs to mark', p0.length >= 3, p0.length);
    const words0 = p0[0].split(' ').slice(1, 4).join(' ');

    /* ---------- highlight ---------- */
    const selected = await select(0, words0, words0);
    await sleep(400);
    check('selecting words shows the bar with Highlight and Note', await page.evaluate(() => !document.getElementById('selBar').hidden && /Highlight/.test(document.getElementById('selBar').innerText) && /Note/.test(document.getElementById('selBar').innerText)), selected);
    await tap('#selHighlight');
    check('Highlight marks exactly the selected words (yellow)', JSON.stringify(await hlText()) === JSON.stringify(['hl-yellow:' + words0]), await hlText());
    check('the selection and the bar are gone', await page.evaluate(() => document.getElementById('selBar').hidden && getSelection().isCollapsed));
    await shot('m01-highlight');

    /* ---------- tap a highlight: colours, underline, remove ---------- */
    await page.evaluate((c) => document.querySelector(c + ' .text .hl').click(), cur); await sleep(300);
    check('tapping a highlight shows colours, U, note and remove', await page.evaluate(() => !document.getElementById('markBar').hidden && document.querySelectorAll('#markBar .mb-color').length === 4));
    await shot('m02-markbar');
    await click('#markBar .mb-color[data-c="green"]'); await sleep(300);
    check('changing the colour to green', (await hlText())[0] === 'hl-green:' + words0, await hlText());
    await page.evaluate((c) => document.querySelector(c + ' .text .hl').click(), cur); await sleep(200);
    await click('#mbUnder'); await sleep(300);
    check('underline added', (await hlText())[0] === 'hl-green ul:' + words0, await hlText());
    await page.evaluate((c) => document.querySelector(c + ' .text .hl').click(), cur); await sleep(200);
    await click('#markBar .mb-color[data-c="green"]'); await sleep(300);
    check('tapping its own colour with underline on leaves underline only', (await hlText())[0] === 'ul:' + words0, await hlText());

    /* ---------- across two paragraphs ---------- */
    const a1 = p0[1].split(' ').slice(-3).join(' '), a2 = p0[2].split(' ').slice(0, 2).join(' ');
    await select(1, a1, a2, 2); await sleep(400);
    await tap('#selHighlight');
    const two = await page.evaluate((c) => Array.from(document.querySelectorAll(c + ' .text .hl')).filter((e) => e.closest('p').dataset.i !== '0').map((e) => e.closest('p').dataset.i + ':' + e.textContent), cur);
    check('a highlight across two paragraphs marks both parts', two.length === 2 && two[0] === '1:' + a1 && two[1] === '2:' + a2, two);
    const grp = (await marks()).filter((m) => m.type === 'text' && m.grp);
    check('… as one highlight (both parts share a group)', grp.length === 2 && grp[0].grp === grp[1].grp, grp.length);

    /* ---------- note on words ---------- */
    await page.evaluate((c) => Array.from(document.querySelectorAll(c + ' .text .hl')).find((e) => e.closest('p').dataset.i === '2').click(), cur); await sleep(200);
    await click('#mbNote'); await sleep(500);
    check('Note opens the note sheet with the quoted words', await page.evaluate((q) => !document.getElementById('sheetNote').hidden && document.getElementById('noteQuote').textContent.indexOf(q) >= 0, a1));
    await page.evaluate(() => { document.querySelector('#noteTabs [data-v="type"]').click(); });
    await page.type('#noteText', 'આ ફરી વાંચવું');
    await click('#noteSave'); await sleep(600);
    check('the note shows as a small mark after the words', await page.evaluate((c) => document.querySelectorAll(c + ' .note-dot').length === 1, cur));
    await click(cur + ' .note-dot'); await sleep(500);
    check('tapping the mark opens the note', await page.evaluate(() => document.getElementById('noteText').value === 'આ ફરી વાંચવું'));
    await shot('m03-note-type');
    await click('#noteDelete'); await sleep(600);
    check('Delete removes the note but keeps the highlight', await page.evaluate((c) => document.querySelectorAll(c + ' .note-dot').length === 0, cur) && (await hlText()).length === 3, await hlText());

    /* ---------- note on the card: typed, then by hand ---------- */
    await page.evaluate((c) => document.querySelector(c + ' .foot .icon-btn[aria-label="More"]').click(), cur); await sleep(300);
    await click('#mNote'); await sleep(600);
    await page.evaluate(() => document.querySelector('#noteTabs [data-v="type"]').click());
    await page.type('#noteText', 'Card note');
    await click('#noteSave'); await sleep(600);
    check('a typed note on the card shows at its end', await page.evaluate((c) => /Card note/.test((document.querySelector(c + ' .card-note') || {}).innerText || ''), cur));
    await click(cur + ' .card-note'); await sleep(600);
    await page.evaluate(() => document.querySelector('#noteTabs [data-v="write"]').click()); await sleep(400);
    check('Write by hand shows the writing pad with pen, eraser and undo', await page.evaluate(() => !document.getElementById('notePad').hidden && !document.getElementById('noteTools').hidden && document.getElementById('noteText').hidden));
    await draw('#noteInk', [[0.1, 0.2], [0.3, 0.3], [0.5, 0.2], [0.7, 0.35]]);
    await draw('#noteInk', [[0.2, 0.6], [0.6, 0.62]]);
    check('writing on the pad draws', (await inked('#noteInk')) > 50);
    await click('#noteEraser'); await draw('#noteInk', [[0.2, 0.6], [0.4, 0.61], [0.6, 0.62]]);
    await click('#noteUndo'); await sleep(200);
    check('eraser and undo work on the pad', (await inked('#noteInk')) > 50);
    await shot('m04-note-write');
    await click('#noteSave'); await sleep(700);
    const cn = (await marks()).find((m) => m.type === 'cardnote');
    check('the card note keeps both the typed text and the writing', cn && cn.note.text === 'Card note' && cn.note.ink.length === 2, cn && cn.note);
    check('the card shows the hand-written note as a picture', await page.evaluate((c) => !!document.querySelector(c + ' .card-note img'), cur));
    // a new note opens the way notes were last written (by hand, just now)
    const last2 = p0[3] ? p0[3].split(' ').slice(-2).join(' ') : null;
    if (last2) {
      await select(3, last2, last2); await sleep(400);
      await tap('#selNote'); await sleep(500);
      check('a new note opens the way the last one was written (by hand)', await page.evaluate(() => document.querySelector('#noteTabs .on').dataset.v === 'write'));
      await back();
      await page.evaluate((c) => { const sp = Array.from(document.querySelectorAll(c + ' .text .hl')).find((e) => e.closest('p').dataset.i === '3'); sp.click(); }, cur); await sleep(200);
      await click('#mbRemove'); await sleep(400);
    }

    /* ---------- pen on the card ---------- */
    await page.evaluate((c) => { document.querySelector(c + ' .body').scrollTop = 0; }, cur); await sleep(200);
    await page.evaluate((c) => document.querySelector(c + ' .foot .icon-btn[aria-label="Pen"]').click(), cur); await sleep(600);
    check('Pen turns the card footer into the pen bar', await page.evaluate((c) => { const k = document.querySelector(c); return k.classList.contains('inking') && !!k.querySelector('.pen-bar') && !k.querySelector('.foot'); }, cur));
    await shot('m05-pen-card');
    await draw(cur + ' .ink-layer.live', [[0.05, 0.05], [0.4, 0.07], [0.8, 0.06]]);
    let ink = (await marks()).find((m) => m.type === 'ink-card');
    check('a pen stroke on the card is saved right away', ink && ink.strokes.length === 1 && ink.layout && ink.layout.fs === 18, ink && ink.layout);
    await page.evaluate((c) => document.querySelector(c + ' .pen-tool[data-tool="p"]').click(), cur); await sleep(200);
    check('tapping Pen again shows its 3 colours', await page.evaluate((c) => { const p = document.querySelector(c + ' .pen-colors'); return p && !p.hidden && p.querySelectorAll('.pen-color').length === 3; }, cur));
    await page.evaluate((c) => document.querySelectorAll(c + ' .pen-color')[2].click(), cur); await sleep(200);
    await page.evaluate((c) => document.querySelector(c + ' .pen-tool[data-tool="h"]').click(), cur); await sleep(100);
    await draw(cur + ' .ink-layer.live', [[0.05, 0.15], [0.6, 0.15]]);
    await page.evaluate((c) => document.querySelector(c + ' .pen-tool[data-tool="p"]').click(), cur); await sleep(100);
    await draw(cur + ' .ink-layer.live', [[0.1, 0.25], [0.2, 0.3]]);
    ink = (await marks()).find((m) => m.type === 'ink-card');
    check('red pen and highlighter strokes are kept', ink.strokes.length === 3 && ink.strokes[1].t === 'h' && ink.strokes[2].c === '#C8382B', ink.strokes.map((s) => s.t + s.c));
    await page.evaluate((c) => document.querySelector(c + ' .pen-tool[data-tool="u"]').click(), cur); await sleep(300);
    ink = (await marks()).find((m) => m.type === 'ink-card');
    check('Undo takes the last stroke back', ink.strokes.length === 2);
    await page.evaluate((c) => document.querySelector(c + ' .pen-tool[data-tool="e"]').click(), cur); await sleep(100);
    await draw(cur + ' .ink-layer.live', [[0.3, 0.15], [0.32, 0.15]]);
    ink = (await marks()).find((m) => m.type === 'ink-card');
    check('the eraser removes a stroke it touches', ink.strokes.length === 1);
    const before = await curId();
    await page.keyboard.press('ArrowDown'); await sleep(600);
    check('the card does not move on while drawing', (await curId()) === before);
    await page.evaluate((c) => document.querySelector(c + ' .pen-done').click(), cur); await sleep(600);
    check('Done brings the footer back and the pen marks stay on the card', await page.evaluate((c) => !!document.querySelector(c + ' .foot') && !!document.querySelector(c + ' .lock .ink-layer'), cur));
    check('the pen marks are drawn', (await inked(cur + ' .ink-layer')) > 30);
    const top1 = await inkTop(cur + ' .ink-layer');

    /* ---------- marks survive a reload and a text-size change ---------- */
    const hlBefore = await hlText();
    await page.reload({ waitUntil: 'networkidle0' }); await sleep(1200);
    check('after a reload: the same card with the same highlights', (await curId()) === startId && JSON.stringify(await hlText()) === JSON.stringify(hlBefore), [await curId(), startId]);
    await sleep(500);
    const top2 = await inkTop(cur + ' .ink-layer');
    check('after a reload the pen marks sit exactly where they were drawn', top1 > 0 && Math.abs(top1 - top2) <= 1, [top1, top2]);
    await tap('#btnAa');
    await page.evaluate(() => { const r = document.getElementById('fs'); r.value = 24; r.dispatchEvent(new Event('input')); });
    await back();
    await page.evaluate(() => window.dispatchEvent(new Event('resize'))); await sleep(300);
    const lockFs = await page.evaluate((c) => { const l = document.querySelector(c + ' .lock'); return l && l.style.getPropertyValue('--fs'); }, cur);
    check('a card with pen marks keeps the text size they were drawn at', lockFs === '18px', lockFs);
    await page.evaluate(() => { const r = document.getElementById('fs'); r.value = 18; r.dispatchEvent(new Event('input')); });
    await shot('m06-card-marked');

    /* ---------- pen on a PDF page ---------- */
    let chip = await page.$(cur + ' button.page-chip');
    check('the card opens its PDF page', !!chip);
    await chip.tap(); await sleep(2500);
    await click('#vPen'); await sleep(400);
    check('the page viewer has a pen with the same bar', await page.evaluate(() => !document.getElementById('vPenBar').hidden && document.getElementById('vInk').classList.contains('live')));
    await draw('#vInk', [[0.3, 0.2], [0.5, 0.25], [0.7, 0.2]]);
    let pm = (await marks()).find((m) => m.type === 'ink-page');
    check('a pen stroke on the page is saved for that page', pm && pm.strokes.length === 1, pm && pm.pg);
    await shot('m07-pen-page');
    const w1 = await page.evaluate(() => document.getElementById('vInk').clientWidth);
    await click('#vZoom'); await sleep(2500);
    const w2 = await page.evaluate(() => document.getElementById('vInk').clientWidth);
    check('zooming in keeps the pen marks on the page (layer grows with it)', w2 > w1 * 1.3 && (await inked('#vInk')) > 30, [w1, w2]);
    await click('#vZoom'); await sleep(1500);
    await click('#vNext'); await sleep(2000);
    check('the next page has no pen marks', (await inked('#vInk')) === 0);
    await click('#vPrev'); await sleep(2000);
    check('back on the page, its marks are there', (await inked('#vInk')) > 30);
    await click('#vClose'); await sleep(500);

    /* ---------- Saved → Highlights & notes ---------- */
    await tap('#btnSaved');
    await click('#savedTabs [data-v="marks"]'); await sleep(300);
    const items = await page.evaluate(() => Array.from(document.querySelectorAll('#marksList .mark-item')).map((b) => b.innerText.split('\n')[0]));
    check('the list shows highlights, the card note, and pen marks on card and page', items.length === 5 && items.some((t) => /Pen marks on the page/.test(t)) && items.some((t) => /Pen marks on the card/.test(t)) && items.some((t) => /Note on the card/.test(t)), items);
    await shot('m08-marks-list');
    await page.evaluate(() => { navigator.share = (d) => { window.__shared = d; return Promise.resolve(); }; });
    await click('#marksList .marks-share'); await sleep(300);
    const shared = await page.evaluate(() => window.__shared && window.__shared.text);
    check('Send to Notes shares the highlights and notes as text', shared && shared.indexOf(words0) >= 0 && /Card note/.test(shared) && /\(hand-written note\)/.test(shared) && /\(pen marks\)/.test(shared), shared && shared.slice(0, 120));
    await page.evaluate(() => Array.from(document.querySelectorAll('#marksList .mark-item')).find((b) => /Pen marks on the page/.test(b.innerText)).click());
    await sleep(2500);
    check('tapping "Pen marks on the page" opens that page', await page.evaluate(() => !document.getElementById('viewer').hidden) && (await inked('#vInk')) > 30);
    await click('#vClose'); await sleep(500);

    /* ---------- the printed index card ---------- */
    // back to random order first (opening a topic from Contents switched to book order)
    await page.evaluate((c) => { const b = document.querySelector(c + ' .foot .icon-btn[aria-label="Back to random cards"]'); if (b) b.click(); }, cur); await sleep(600);
    // start drawing, then switch books from the Library: drawing must end, not get stuck
    await page.evaluate((c) => document.querySelector(c + ' .foot .icon-btn[aria-label="Pen"]').click(), cur); await sleep(500);
    await tap('#btnLib');
    await page.evaluate(() => Array.from(document.querySelectorAll('#bookList .book-main')).find((b) => /Aptvani-1|Aptavani/i.test(b.innerText)).click());
    await sleep(600);
    await page.keyboard.press('ArrowDown'); await sleep(700);   // the first card shows a swipe hint, not the count
    const randomCount = await page.evaluate((c) => +document.querySelector(c + ' .foot .pos').innerText.split('/').pop(), cur);
    check('switching books while drawing ends the pen (cards move on again)', await page.evaluate((c) => !document.querySelector('.card.inking') && !!document.querySelector(c + ' .foot'), cur) && !Number.isNaN(randomCount), randomCount);
    await page.evaluate(() => document.querySelector('.card:not(.under) .band').click()); await sleep(400);
    await page.evaluate(() => Array.from(document.querySelectorAll('#tocList .toc-item')).find((x) => /અનુક્રમણિકા/.test(x.innerText)).click());
    await sleep(700);
    const ix = await page.evaluate((c) => ({ title: (document.querySelector(c + ' .title') || {}).innerText, n: document.querySelectorAll(c + ' .index-e').length, bookCount: +document.querySelector(c + ' .foot .pos').innerText.split('/').pop() }), cur);
    check('the book\'s printed index is a card with its entries', ix.title === 'અનુક્રમણિકા' && ix.n > 100, ix);
    check('… only in book order (not among the random cards)', ix.bookCount === randomCount + 1, [ix.bookCount, randomCount]);
    await shot('m09-index');
    await page.evaluate((c) => Array.from(document.querySelectorAll(c + ' .index-e')).find((b) => b.querySelector('.index-t').innerText === 'જગત સર્જન').click(), cur);
    await sleep(700);
    check('tapping an index entry opens that topic', (await page.evaluate((c) => (document.querySelector(c + ' .title') || {}).innerText, cur)) === 'જગત સર્જન');

    /* ---------- a re-read (new parser) keeps the highlights ---------- */
    await tap('#btnLib');
    await page.evaluate(() => Array.from(document.querySelectorAll('#bookList .book-main')).find((b) => /Dadavani/i.test(b.innerText)).click());
    await sleep(500);
    await page.evaluate(() => new Promise((res) => {
      const rq = indexedDB.open('vanchan');
      rq.onsuccess = () => {
        const t = rq.result.transaction('books', 'readwrite'), st = t.objectStore('books');
        st.getAll().onsuccess = (e) => { e.target.result.forEach((b) => { if (/Dadavani/i.test(b.title)) { b.parser = 2; st.put(b); } }); };
        t.oncomplete = () => { rq.result.close(); res(); };
      };
    }));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => /Text updated/.test(document.getElementById('toastText').textContent), { timeout: 60000 }).catch(() => {});
    const after = (await marks()).filter((m) => m.type === 'text');
    check('after the book is read again, every highlight still has its words', after.length === 3 && after.every((m) => !m.lost), after.map((m) => m.q + (m.lost ? ' (lost)' : '')));

    /* ---------- wide screens: contents left, this card's marks right ---------- */
    await page.evaluate(() => Array.from(document.querySelectorAll('#tocList .toc-item')).length);
    await page.evaluate(() => document.querySelector('.card:not(.under) .band').click()); await sleep(300);
    await page.evaluate(() => { const it = Array.from(document.querySelectorAll('#tocList .toc-item')).find((x) => /સૂત્ર/.test(x.innerText)); it.click(); }); await sleep(600);
    check('phone width: no side panels', await page.evaluate(() => document.getElementById('sideToc').hidden && document.getElementById('sideMarks').hidden));
    await page.setViewport({ width: 1280, height: 800, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
    await sleep(800);
    const wide = await page.evaluate((c) => {
      const L = document.getElementById('sideToc'), R = document.getElementById('sideMarks'), card = document.querySelector(c).getBoundingClientRect();
      const lr = L.getBoundingClientRect(), rr = R.getBoundingClientRect();
      return { shown: !L.hidden && !R.hidden, here: (L.querySelector('.toc-item.here') || {}).innerText, marks: R.querySelectorAll('.side-mark').length,
        noOverlap: lr.right <= card.left && card.right <= rr.left, cardW: Math.round(card.width) };
    }, cur);
    check('desktop width: contents on the left, this card\'s marks on the right, not over the card', wide.shown && wide.noOverlap && wide.marks >= 1 && !!wide.here, wide);
    await shot('m10-desktop');
    const beforeId = await curId();
    await page.evaluate(() => { const items = document.querySelectorAll('#sideToc .toc-item'); const here = document.querySelector('#sideToc .toc-item.here'); const all = Array.from(items); all[Math.min(all.indexOf(here) + 2, all.length - 1)].click(); });
    await sleep(700);
    check('tapping a topic in the side contents opens it, and the panel follows', (await curId()) !== beforeId && await page.evaluate(() => { const h = document.querySelector('#sideToc .toc-item.here'); return !!h; }));
    await page.evaluate(() => document.getElementById('sideNote').click()); await sleep(500);
    check('the side Note button opens the note sheet for this card', await page.evaluate(() => !document.getElementById('sheetNote').hidden));
    await back();

    /* ---------- folding the side panels into rails ---------- */
    // the card with highlights, a note and pen marks
    await page.evaluate(() => document.getElementById('btnSaved').click()); await sleep(400);
    await page.evaluate(() => document.querySelector('#savedTabs [data-v="marks"]').click()); await sleep(300);
    await page.evaluate(() => Array.from(document.querySelectorAll('#marksList .mark-item')).find((b) => /Pen marks on the card/.test(b.innerText)).click()); await sleep(800);
    const inkBefore = await inkTop(cur + ' .ink-layer');
    // back to the card with marks, which also has pen marks
    const geo = () => page.evaluate((c) => {
      const L = document.getElementById('sideToc').getBoundingClientRect(), R = document.getElementById('sideMarks').getBoundingClientRect(), k = document.querySelector(c).getBoundingClientRect();
      return { lw: Math.round(L.width), rw: Math.round(R.width), card: Math.round(k.width), clear: L.right <= k.left && k.right <= R.left,
        lf: document.getElementById('sideToc').classList.contains('folded'), rf: document.getElementById('sideMarks').classList.contains('folded'),
        count: document.getElementById('railCount').hidden ? 0 : +document.getElementById('railCount').textContent };
    }, cur);
    // the fold buttons must be reachable by a real tap, even when the contents list
    // is scrolled far down to the current topic
    const tapAt = async (sel) => {
      const r = await page.evaluate((s) => { const e = document.querySelector(s).getBoundingClientRect(); const x = e.left + e.width / 2, y = e.top + e.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, ok: !!hit && (hit.id === s.slice(1) || !!hit.closest(s)) }; }, sel);
      if (r.ok) { await page.mouse.click(r.x, r.y); await sleep(500); }
      return r.ok;
    };
    await page.evaluate(() => { const all = document.querySelectorAll('#sideToc .toc-item'); all[all.length - 1].click(); }); await sleep(700);
    const deep = await page.evaluate(() => document.querySelector('#sideToc .toc').scrollTop || document.getElementById('sideToc').scrollTop);
    check('far down the contents, the fold button can still be tapped', deep > 100 && await tapAt('#foldToc') && await page.evaluate(() => document.getElementById('sideToc').classList.contains('folded')), deep);
    await tapAt('#railToc');
    check('… and the rail opens it again with a real tap', await page.evaluate(() => !document.getElementById('sideToc').classList.contains('folded')));
    // back to the card with the marks for the checks below
    await page.evaluate(() => document.getElementById('btnSaved').click()); await sleep(400);
    await page.evaluate(() => document.querySelector('#savedTabs [data-v="marks"]').click()); await sleep(300);
    await page.evaluate(() => Array.from(document.querySelectorAll('#marksList .mark-item')).find((b) => /Pen marks on the card/.test(b.innerText)).click()); await sleep(800);
    const g0 = await geo();
    const marksShown = await page.evaluate(() => document.querySelectorAll('#sideMarks .side-mark, #sideMarks .card-note').length + (/Pen marks/.test(document.getElementById('sideMarks').innerText) ? 1 : 0));
    await tapAt('#foldToc');
    const g1 = await geo();
    check('folding Contents leaves a slim rail and gives the card more room (up to 860px)', g1.lf && g1.lw <= 50 && g1.card > g0.card && g1.card <= 860 && g1.clear, [g0, g1]);
    await tapAt('#foldMarks');
    const g2 = await geo();
    check('folding This card leaves a rail with the number of marks on the card', g2.rf && g2.rw <= 50 && g2.count === marksShown && g2.count > 0 && g2.clear && g2.card <= 860, [g2, marksShown]);
    await shot('m12-folded');
    await page.reload({ waitUntil: 'networkidle0' }); await sleep(1200);
    const g3 = await geo();
    check('the folded panels stay folded after a reload', g3.lf && g3.rf, g3);
    check('the pen marks stay on their words with the panels folded', inkBefore > 0 && Math.abs((await inkTop(cur + ' .ink-layer')) - inkBefore) <= 1, [inkBefore, await inkTop(cur + ' .ink-layer')]);
    await tapAt('#railToc');
    await tapAt('#railMarks');
    const g4 = await geo();
    check('tapping a rail opens its panel again', !g4.lf && !g4.rf && g4.lw > 200 && g4.rw > 200 && g4.clear, g4);
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await sleep(600);
    check('phone width: no panels and no rails', await page.evaluate(() => document.getElementById('sideToc').hidden && document.getElementById('sideMarks').hidden && getComputedStyle(document.getElementById('railToc')).display === 'none'));

    // dark theme: highlights stay readable
    await tap('#btnAa'); await tap('.seg[data-setting="theme"] button[data-v="dark"]'); await back();
    await page.evaluate(() => document.querySelector('.card:not(.under) .band').click()); await sleep(300);
    await page.evaluate(() => { const it = Array.from(document.querySelectorAll('#tocList .toc-item')).find((x) => /સૂત્ર/.test(x.innerText)); it.click(); }); await sleep(700);
    await shot('m11-dark');
    await tap('#btnAa'); await tap('.seg[data-setting="theme"] button[data-v="light"]'); await back();

    /* ---------- deleting the book deletes its marks ---------- */
    await tap('#btnLib');
    await page.evaluate(() => Array.from(document.querySelectorAll('#bookList .book-row')).find((x) => /Dadavani/i.test(x.innerText)).querySelector('[aria-label="Delete"]').click());
    await sleep(800); await back();
    check('deleting a book deletes its highlights, notes and pen marks', (await marks()).length === 0, (await marks()).length);

    check('no script errors', errors.length === 0, errors.slice(0, 5));
  } catch (e) {
    check('test run finished', false, e.stack.split('\n').slice(0, 3).join(' | '));
    await page.screenshot({ path: path.join(SHOTS, 'm99-crash.png') }).catch(() => {});
  }
  await browser.close();
  srv.close();
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' / ' + results.length + ' marking checks passed' + (failed.length ? '\nFAILED: ' + failed.map((r) => r.name).join('; ') : ''));
  process.exit(failed.length ? 1 : 0);
})();
