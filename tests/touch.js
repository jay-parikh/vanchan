/*
 * Touch test for pen mode, with real touch events (as a phone or iPad sends
 * them, through Chromium's touch pipeline): a reader must be able to scroll
 * a long card and a zoomed PDF page while the pen is on, then draw further
 * down. The mouse-only marking test missed this.   node touch.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

const APP = process.env.APP || path.join(__dirname, '../app');
const B = path.join(__dirname, '../..');
const WORK = path.join(__dirname, '.work-touch');
const SITE = path.join(WORK, 'site');
const SHOTS = path.join(__dirname, 'shots');
const LIBS = path.join(__dirname, '.libs');
const PORT = 8773;
process.env.LD_LIBRARY_PATH = [LIBS + '/usr/lib/x86_64-linux-gnu', LIBS + '/lib/x86_64-linux-gnu', LIBS + '/usr/lib'].join(':');

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  — ' + JSON.stringify(info) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  execSync('rm -rf ' + JSON.stringify(WORK) + ' && mkdir -p ' + JSON.stringify(WORK) + ' ' + JSON.stringify(SHOTS));
  execSync('cp -r ' + JSON.stringify(APP) + ' ' + JSON.stringify(SITE));
  fs.writeFileSync(path.join(SITE, 'js/config.js'), 'window.VANCHAN_SYNC = null;\n');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(SITE, p);
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  }).listen(PORT, '127.0.0.1');
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-gpu'], userDataDir: path.join(WORK, 'profile') });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const cdp = await page.target().createCDPSession();
  const cur = '.card:not(.under)';

  // a finger (or two) moving from → to, in small steps like a real swipe
  async function touch(fingers, steps = 12) {
    const at = (k) => fingers.map((f, i) => ({ x: f[0][0] + (f[1][0] - f[0][0]) * k / steps, y: f[0][1] + (f[1][1] - f[0][1]) * k / steps, id: i + 1 }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
    for (let k = 1; k <= steps; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(k) }); await sleep(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(500);
  }
  const box = async (sel) => (await page.$(sel)).boundingBox();
  const inkMark = (type) => page.evaluate((t) => new Promise((res) => {
    const rq = indexedDB.open('vanchan');
    rq.onsuccess = () => { const g = rq.result.transaction('marks').objectStore('marks').getAll(); g.onsuccess = () => { rq.result.close(); res(g.result.filter((m) => m.type === t && !m.del)[0] || null); }; };
  }), type);
  // lowest point of all strokes, in CSS px from the top of the surface of width w
  const lowest = (m, w) => {
    let y = 0;
    (m ? m.strokes : []).forEach((s) => { let yy = 0; for (let i = 1; i < s.d.length; i += 2) { yy += s.d[i]; y = Math.max(y, yy / 10000 * w); } });
    return Math.round(y);
  };
  // the Scroll tool, where the app has one
  const pickTool = (scope, name) => page.evaluate((s, n) => { const b = document.querySelector(s + ' .pen-tool[data-tool="' + n + '"]'); if (b) { b.click(); return true; } return false; }, scope, name);

  try {
    await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'networkidle0' });
    await (await page.$('#file')).uploadFile(path.join(B, '10-Dadavani-Oct-2026-Guj.pdf'));
    await page.waitForFunction(() => document.getElementById('importModal').hidden, { timeout: 120000 });
    await sleep(800);
    // a long card: its text runs well past the screen
    for (let i = 0; i < 25; i++) {
      const long = await page.evaluate((c) => { const b = document.querySelector(c + ' .body'); return b.scrollHeight - b.clientHeight; }, cur);
      if (long > 600) break;
      await page.keyboard.press('ArrowDown'); await sleep(500);
    }
    const room = await page.evaluate((c) => { const b = document.querySelector(c + ' .body'); return b.scrollHeight - b.clientHeight; }, cur);
    check('a card longer than the screen', room > 600, room);

    /* ---------- the card stays where the reader scrolled to ---------- */
    const bodyTop = () => page.evaluate((c) => Math.round(document.querySelector(c + ' .body').scrollTop), cur);
    // scroll halfway down with a finger, as a reader would
    const bb = await box(cur + ' .body');
    await touch([[[bb.x + bb.width / 2, bb.y + bb.height * 0.85], [bb.x + bb.width / 2, bb.y + bb.height * 0.15]]]);
    const swiped = await bodyTop();
    // from here on, a known place halfway down (so the next checks don't depend on the swipe)
    await page.evaluate((c) => { document.querySelector(c + ' .body').scrollTop = 500; }, cur); await sleep(300);
    const mid = await bodyTop();
    if (process.env.DEBUG) console.log('DEBUG', await page.evaluate((c, x, y) => { const e = document.elementFromPoint(x, y); return { at: e && (e.id || e.className || e.tagName), toast: !document.getElementById('toast').hidden, sel: getSelection().toString().length, ta: getComputedStyle(document.querySelector(c + ' .body')).touchAction, ov: getComputedStyle(document.querySelector(c + ' .body')).overflowY, sh: document.querySelector(c + ' .body').scrollHeight, ch: document.querySelector(c + ' .body').clientHeight }; }, cur, bb.x + bb.width / 2, bb.y + bb.height * 0.85));
    check('reading: a finger scrolls a long card down', swiped > 200, swiped);
    // highlight words that are on screen down there
    const sel = await page.evaluate((c) => {
      const body = document.querySelector(c + ' .body'), r0 = body.getBoundingClientRect();
      const p = Array.from(body.querySelectorAll('.text p')).find((x) => { const r = x.getBoundingClientRect(); return r.top > r0.top + 40 && r.top < r0.bottom - 80; });
      const n = document.createTreeWalker(p, 4).nextNode();
      const r = document.createRange(); r.setStart(n, 0); r.setEnd(n, Math.min(n.nodeValue.length, 12));
      getSelection().removeAllRanges(); getSelection().addRange(r); document.dispatchEvent(new Event('selectionchange'));
      return r.toString();
    }, cur);
    await sleep(400);
    await page.evaluate(() => document.getElementById('selHighlight').click()); await sleep(500);
    const afterHl = await bodyTop();
    check('highlighting words further down keeps the card where it was', Math.abs(afterHl - mid) <= 2 && !!(await page.$(cur + ' .text .hl')), { mid, afterHl, sel });
    await page.evaluate((c) => document.querySelector(c + ' .foot .icon-btn[aria-label="Pen"]').click(), cur);
    await sleep(600);
    const afterPen = await bodyTop();
    check('tapping the pen keeps the card where it was (no jump to the top)', Math.abs(afterPen - mid) <= 2, { mid, afterPen });
    await page.evaluate((c) => document.querySelector(c + ' .pen-done').click(), cur); await sleep(500);
    const afterDone = await bodyTop();
    check('tapping Done keeps the card where it was', Math.abs(afterDone - mid) <= 2, { mid, afterDone });
    await page.evaluate((c) => { document.querySelector(c + ' .body').scrollTop = 0; }, cur); await sleep(200);

    /* ---------- pen on a card ---------- */
    await page.evaluate((c) => document.querySelector(c + ' .foot .icon-btn[aria-label="Pen"]').click(), cur);
    await sleep(600);
    const bodyBox = await box(cur + ' .body');
    const scrollTop = () => page.evaluate((c) => Math.round(document.querySelector(c + ' .body').scrollTop), cur);
    const cx = bodyBox.x + bodyBox.width / 2;

    const sw = await page.evaluate((c) => {
      const m = document.querySelector(c + ' .pen-mode');
      return m && { labels: Array.from(m.querySelectorAll('.pen-tool')).map((b) => b.innerText.trim()), on: (m.querySelector('.pen-tool.on') || {}).innerText,
        scrollButton: !!Array.from(document.querySelectorAll(c + ' .pen-tool')).find((b) => /Scroll/.test(b.innerText)),
        fits: document.querySelector(c + ' .pen-bar').scrollWidth <= document.querySelector(c + ' .pen-bar').clientWidth };
    }, cur);
    check('the pen bar starts with a labelled Move | Draw switch, on Draw, and fits the card', sw && sw.labels.join() === 'Move,Draw' && sw.on === 'Draw' && !sw.scrollButton && sw.fits, sw);
    await page.screenshot({ path: path.join(SHOTS, 't00-move-draw.png') });

    // 1. Move: one finger scrolls the card
    const hasScroll = await pickTool(cur, 's');
    await touch([[[cx, bodyBox.y + bodyBox.height * 0.8], [cx, bodyBox.y + bodyBox.height * 0.2]]]);
    const s1 = await scrollTop();
    check('pen mode: on Move, one finger scrolls the card', hasScroll && s1 > 150, { hasScroll, scrollTop: s1 });
    check('… and scrolling draws nothing', !(await inkMark('ink-card')));

    // 2. two fingers scroll the card while the pen is the tool
    await pickTool(cur, 'p');
    const before2 = await scrollTop();
    await touch([[[cx - 40, bodyBox.y + bodyBox.height * 0.8], [cx - 40, bodyBox.y + bodyBox.height * 0.3]], [[cx + 40, bodyBox.y + bodyBox.height * 0.8], [cx + 40, bodyBox.y + bodyBox.height * 0.3]]]);
    const s2 = await scrollTop();
    check('pen mode: two fingers scroll the card while the pen is on', s2 > before2 + 100, [before2, s2]);
    check('… and draw nothing', !(await inkMark('ink-card')));

    // 3. at the end of the card, one finger draws there
    await page.evaluate((c) => { const b = document.querySelector(c + ' .body'); b.scrollTop = b.scrollHeight; }, cur);
    await sleep(300);
    await touch([[[bodyBox.x + 40, bodyBox.y + bodyBox.height - 120], [bodyBox.x + 200, bodyBox.y + bodyBox.height - 110]]]);
    const ink = await inkMark('ink-card');
    const w = await page.evaluate((c) => +document.querySelector(c + ' .lock').dataset.w, cur);
    const low = lowest(ink, w);
    check('pen mode: drawing at the end of a long card lands there', ink && low > bodyBox.height, { stroke: ink && ink.strokes.length, lowest: low, screen: Math.round(bodyBox.height) });
    await page.screenshot({ path: path.join(SHOTS, 't01-card-end-drawn.png') });

    // 4. a mouse wheel scrolls the card in pen mode and never leaves it
    const id = await page.evaluate((c) => document.querySelector(c).dataset.id, cur);
    await page.mouse.move(cx, bodyBox.y + 200);
    for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: 400 }); await sleep(120); }
    await sleep(800);
    check('pen mode: the mouse wheel at the end of the card does not move to the next card', (await page.evaluate((c) => document.querySelector(c).dataset.id, cur)) === id && await page.evaluate(() => !!document.querySelector('.card.inking')));
    await page.evaluate((c) => document.querySelector(c + ' .pen-done').click(), cur); await sleep(500);

    /* ---------- writing a note by hand with a finger ---------- */
    await page.evaluate((c) => document.querySelector(c + ' .foot .icon-btn[aria-label="More"]').click(), cur); await sleep(300);
    await page.evaluate(() => document.getElementById('mNote').click()); await sleep(600);
    await page.evaluate(() => document.querySelector('#noteTabs [data-v="write"]').click()); await sleep(500);
    const pad = await box('#notePad');
    await touch([[[pad.x + 30, pad.y + 40], [pad.x + 200, pad.y + 60]]]);
    await touch([[[pad.x + 30, pad.y + 120], [pad.x + 160, pad.y + 110]]]);
    await page.evaluate(() => document.getElementById('noteSave').click()); await sleep(600);
    const handNote = await inkMark('cardnote');
    check('a finger writes in the hand-written note', handNote && handNote.note && handNote.note.ink && handNote.note.ink.length === 2, handNote && handNote.note);

    /* ---------- pen on a PDF page, zoomed in ---------- */
    const chip = await page.$(cur + ' button.page-chip');
    await chip.tap(); await sleep(2500);
    // zoom in twice: the page is then much taller than the screen
    await page.evaluate(() => document.getElementById('vZoom').click()); await sleep(2000);
    await page.evaluate(() => document.getElementById('vZoom').click()); await sleep(2500);
    await page.evaluate(() => document.getElementById('vPen').click()); await sleep(400);
    const vb = await box('#vBody');
    const vTop = () => page.evaluate(() => Math.round(document.getElementById('vBody').scrollTop));
    const vRoom = await page.evaluate(() => { const b = document.getElementById('vBody'); return b.scrollHeight - b.clientHeight; });
    check('a zoomed page is taller than the screen', vRoom > 300, vRoom);
    const vx = vb.x + vb.width / 2;

    const hasScrollV = await pickTool('#vPenBar', 's');
    await touch([[[vx, vb.y + vb.height * 0.8], [vx, vb.y + vb.height * 0.2]]]);
    const v1 = await vTop();
    check('page pen: on Move, one finger scrolls the page', hasScrollV && v1 > 150, { hasScrollV, scrollTop: v1 });
    await pickTool('#vPenBar', 'p');
    const vb2 = await vTop();
    // two fingers moving down: back up the page
    await touch([[[vx - 40, vb.y + vb.height * 0.3], [vx - 40, vb.y + vb.height * 0.7]], [[vx + 40, vb.y + vb.height * 0.3], [vx + 40, vb.y + vb.height * 0.7]]]);
    const v2 = await vTop();
    check('page pen: two fingers scroll the page while the pen is on', v2 < vb2 - 80, [vb2, v2]);
    check('… and draw nothing', !(await inkMark('ink-page')));
    await page.evaluate(() => { const b = document.getElementById('vBody'); b.scrollTop = b.scrollHeight; });
    await sleep(300);
    await touch([[[vb.x + 60, vb.y + vb.height - 150], [vb.x + 220, vb.y + vb.height - 140]]]);
    const pm = await inkMark('ink-page');
    const pw = await page.evaluate(() => document.getElementById('vInk').clientWidth);
    check('page pen: drawing at the bottom of a zoomed page lands there', pm && lowest(pm, pw) > vb.height, { lowest: lowest(pm, pw), screen: Math.round(vb.height) });
    await page.screenshot({ path: path.join(SHOTS, 't02-page-end-drawn.png') });

    check('no script errors', errors.length === 0, errors.slice(0, 3));
  } catch (e) {
    check('test run finished', false, e.stack.split('\n').slice(0, 3).join(' | '));
    await page.screenshot({ path: path.join(SHOTS, 't99-crash.png') }).catch(() => {});
  }
  await browser.close();
  srv.close();
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' / ' + results.length + ' touch checks passed' + (failed.length ? '\nFAILED: ' + failed.map((r) => r.name).join('; ') : ''));
  process.exit(failed.length ? 1 : 0);
})();
