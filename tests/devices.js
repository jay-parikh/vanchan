/*
 * Sync test: two devices (two separate browser profiles) and a fake
 * Supabase (auth, the two tables, file storage) inside the test server.
 * Checks that sync is off and silent by default, that switching it on signs
 * in, that books, saved/read/hidden cards, titles and deletions cross over,
 * the "Continue" offer, offline changes, switching off and signing out.
 *   node devices.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

const APP = process.env.APP || path.join(__dirname, '../app');
const B = path.join(__dirname, '../..');
const WORK = path.join(__dirname, '.work-devices');
const SITE = path.join(WORK, 'site');
const SHOTS = path.join(__dirname, 'shots');
const LIBS = path.join(__dirname, '.libs');
const PORT = 8768;
const ORIGIN = 'http://localhost:' + PORT;
// the fake Supabase is on another origin, like the real one (so CORS applies)
const FAKE_PORT = 8769;
const FAKE = 'http://127.0.0.1:' + FAKE_PORT + '/fake-supabase';
process.env.LD_LIBRARY_PATH = [LIBS + '/usr/lib/x86_64-linux-gnu', LIBS + '/lib/x86_64-linux-gnu', LIBS + '/usr/lib'].join(':');

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  — ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- fake Supabase ---------- */

const USER = '6f1c2a5e-0000-4000-8000-000000000001';
const db = { vanchan_books: [], vanchan_progress: [], vanchan_marks: [] }, files = {}, hits = [];
let marksMissing = false, clock = Date.now();
let tokenN = 0, ttl = 3600, validFrom = 0;
const liveRefresh = new Set(), reused = [];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function token() { tokenN++; liveRefresh.add('rt' + tokenN); return b64({ alg: 'none' }) + '.' + b64({ sub: USER, email: 'reader@example.com', exp: Math.floor(Date.now() / 1000) + ttl, n: tokenN }) + '.sig'; }
function userOf(req) {
  const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
  if (!m || !req.headers.apikey) return null;
  try { return JSON.parse(Buffer.from(m[1].split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).sub; } catch (e) { return null; }
}
function tokenNo(req) {
  try { return JSON.parse(Buffer.from((req.headers.authorization || '').split(' ')[1].split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).n || 0; } catch (e) { return 0; }
}
function body(req) { return new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); }); }
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-upsert',
  'Access-Control-Max-Age': '600'
};
function send(res, code, obj, type) {
  res.writeHead(code, Object.assign({ 'Content-Type': type || 'application/json' }, CORS));
  res.end(obj == null ? '' : Buffer.isBuffer(obj) ? obj : JSON.stringify(obj));
}

async function fake(req, res, url) {
  const p = url.pathname.replace('/fake-supabase', '');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  hits.push(req.method + ' ' + p);
  if (p === '/auth/v1/authorize') {
    const back = url.searchParams.get('redirect_to');
    res.writeHead(302, { Location: back + '#access_token=' + token() + '&refresh_token=rt' + tokenN + '&expires_in=3600&token_type=bearer' });
    return res.end();
  }
  if (p === '/auth/v1/token') {
    // like Supabase: a refresh token works once, then it is replaced
    const rt = JSON.parse((await body(req)).toString() || '{}').refresh_token;
    if (!liveRefresh.has(rt)) { reused.push(rt); return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Already Used' }); }
    liveRefresh.delete(rt);
    return send(res, 200, { access_token: token(), refresh_token: 'rt' + tokenN, expires_in: ttl });
  }
  if (p === '/auth/v1/logout') return send(res, 204, null);
  const uid = userOf(req);
  if (!uid) return send(res, 401, { message: 'no token' });
  if (tokenNo(req) < validFrom) return send(res, 401, { message: 'JWT expired' });
  let m;
  if (marksMissing && /vanchan_marks/.test(p)) return send(res, 404, { code: 'PGRST205', message: "Could not find the table 'public.vanchan_marks'" });
  if ((m = p.match(/^\/rest\/v1\/(vanchan_books|vanchan_progress|vanchan_marks)$/))) {
    const t = db[m[1]];
    if (req.method === 'GET') {
      const since = (url.searchParams.get('updated_at') || '').replace(/^gte\./, '');
      return send(res, 200, t.filter((r) => r.user_id === uid && (!since || (r.updated_at || '') >= since)));
    }
    if (req.method === 'POST') {
      const rows = JSON.parse((await body(req)).toString());
      for (const r of [].concat(rows)) {
        if (r.user_id !== uid) return send(res, 403, { message: 'row-level security' });   // like RLS
        const same = (x) => x.user_id === uid && (m[1] === 'vanchan_marks' ? x.id === r.id : x.book_key === r.book_key);
        const at = t.findIndex(same);
        const row = Object.assign({}, r, { updated_at: new Date(++clock).toISOString() });   // like the trigger
        if (at >= 0) Object.assign(t[at], row); else t.push(row);
      }
      return send(res, 201, null);
    }
    if (req.method === 'DELETE') {
      const key = (url.searchParams.get('book_key') || '').replace(/^eq\./, '');
      db[m[1]] = t.filter((x) => !(x.user_id === uid && x.book_key === key));
      return send(res, 204, null);
    }
  }
  if ((m = p.match(/^\/storage\/v1\/object\/(?:authenticated\/)?vanchan-books\/([^/]+)\/([0-9a-f]{64})$/))) {
    if (m[1] !== uid) return send(res, 403, { message: 'not yours' });
    const k = m[1] + '/' + m[2];
    if (req.method === 'POST') { files[k] = await body(req); return send(res, 200, { Key: k }); }
    if (req.method === 'GET') return files[k] ? send(res, 200, files[k], 'application/octet-stream') : send(res, 400, { message: 'Object not found' });
    if (req.method === 'DELETE') { delete files[k]; return send(res, 200, []); }
  }
  return send(res, 404, { message: 'unknown ' + p });
}

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' };
  return new Promise((ok) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, ORIGIN);
      let p = decodeURIComponent(url.pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(SITE, p);
      if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(f).pipe(res);
    }).listen(PORT, '127.0.0.1', () => {
      const api = http.createServer((req, res) => fake(req, res, new URL(req.url, FAKE)).catch((e) => send(res, 500, { message: e.message })));
      api.listen(FAKE_PORT, '127.0.0.1', () => ok({ close: () => { srv.close(); api.close(); } }));
    });
  });
}

/* ---------- devices ---------- */

async function device(browser, name) {
  const ctx = await browser.createIncognitoBrowserContext();   // own storage, like another phone
  const page = await ctx.newPage();
  page.errors = []; page.dialogs = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) page.errors.push(m.text()); });
  page.on('dialog', async (d) => { page.dialogs.push(d.message()); if (d.type() === 'prompt') await d.accept('Renamed on A'); else await d.accept(); });
  await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => {
    window.__toasts = [];
    document.addEventListener('DOMContentLoaded', () => {
      const t = document.getElementById('toastText');
      new MutationObserver(() => window.__toasts.push(t.textContent)).observe(t, { childList: true, characterData: true, subtree: true });
    });
  });
  page.label = name;
  return page;
}

(async () => {
  execSync('rm -rf ' + JSON.stringify(WORK) + ' && mkdir -p ' + JSON.stringify(WORK) + ' ' + JSON.stringify(SHOTS));
  execSync('cp -r ' + JSON.stringify(APP) + ' ' + JSON.stringify(SITE));
  fs.writeFileSync(path.join(SITE, 'js/config.js'), 'window.VANCHAN_SYNC = { url: ' + JSON.stringify(FAKE) + ", key: 'sb_publishable_test' };\n");
  const srv = await serve();
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-gpu'] });
  const cur = '.card:not(.under)';
  const A = await device(browser, 'A'), Bd = await device(browser, 'B');

  const text = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText : null; }, sel);
  const toastText = (pg) => pg.evaluate(() => document.getElementById('toastText').textContent);
  const waitToast = (pg, re, ms) => pg.waitForFunction((src) => new RegExp(src).test(document.getElementById('toastText').textContent), { timeout: ms || 20000 }, re.source).then(() => true, () => false);
  const tap = async (pg, sel) => { await pg.waitForSelector(sel, { visible: true, timeout: 8000 }); await pg.tap(sel); await sleep(350); };
  const back = async (pg) => { await pg.evaluate(() => history.back()); await sleep(400); };
  // the next card; at the end of a (random) order, the card before instead
  const next = async (pg) => {
    await pg.keyboard.press('ArrowDown'); await sleep(700);
    if (!(await pg.$('.card:not(.under) .foot'))) { await pg.keyboard.press('ArrowUp'); await sleep(500); await pg.keyboard.press('ArrowUp'); await sleep(700); }
  };
  const syncNow = (pg) => pg.evaluate(() => window.Sync.syncNow());
  const status = (pg) => pg.evaluate(() => window.Sync.status());
  const curLabel = (pg) => pg.evaluate((c) => { const e = document.querySelector(c); const t = e && e.querySelector('.title'); return t ? t.innerText : e && e.querySelector('.text p') ? e.querySelector('.text p').innerText.slice(0, 60) : null; }, cur);
  const savedTitles = async (pg) => { await tap(pg, '#btnSaved'); const t = await pg.evaluate(() => Array.from(document.querySelectorAll('#savedList .saved-item .t')).map((e) => e.innerText)); await back(pg); return t; };
  const libTitles = async (pg) => { await tap(pg, '#btnLib'); const t = await pg.evaluate(() => Array.from(document.querySelectorAll('#bookList .book-title')).map((e) => e.innerText)); await back(pg); return t; };
  const imp = async (pg, file) => {
    await (await pg.$('#file')).uploadFile(file);
    await pg.waitForFunction(() => document.getElementById('importModal').hidden, { timeout: 120000 });
    await sleep(600);
  };
  const switchOn = async (pg) => {
    await tap(pg, '#btnAa');
    const nav = pg.waitForNavigation({ timeout: 8000 }).catch(() => null);
    await pg.tap('#syncOn');
    return nav;
  };

  try {
    /* ---------- device A: sync is off and silent by default ---------- */
    await A.goto(ORIGIN + '/', { waitUntil: 'networkidle0' });
    await imp(A, path.join(__dirname, 'sample.md'));
    await imp(A, path.join(B, 'Anticancer Living by Cohen and Jefferies_ Summary, Lessons and P.pdf'));
    await tap(A, '#btnAa');
    const field = await A.evaluate(() => ({ shown: !document.getElementById('syncField').hidden, on: document.getElementById('syncOn').checked, text: document.getElementById('syncStatus').innerText }));
    check('sync switch is in Settings and off by default', field.shown && !field.on, field.text);
    await back(A);
    await next(A); await next(A);
    check('while off, the app sends nothing to Supabase', hits.length === 0, hits);

    /* ---------- switching on signs in ---------- */
    await switchOn(A);
    await A.waitForFunction(() => window.Sync && window.Sync.status().lastSync > 0, { timeout: 30000 }).catch(() => {});
    const stA = await status(A);
    check('switching on goes through Google sign-in and back', hits.includes('GET /auth/v1/authorize') && stA.on && stA.signedIn, stA);
    check('the address no longer shows the sign-in tokens', !(await A.evaluate(() => location.hash)));
    check('both books uploaded', db.vanchan_books.length === 2 && Object.keys(files).length === 2, { rows: db.vanchan_books.length, files: Object.keys(files).length });
    await tap(A, '#btnAa');
    const stText = await text(A, '#syncStatus');
    check('Settings shows who is signed in', /Signed in as reader@example\.com/.test(stText), stText);
    await A.screenshot({ path: path.join(SHOTS, 'sync-1-settings-on.png') });
    await back(A);

    /* ---------- progress on A ---------- */
    await A.evaluate(() => { localStorage.setItem('vanchan:scope', '"all"'); });
    await tap(A, cur + ' .foot .icon-btn:nth-last-child(3)');           // save
    const savedOnA = await curLabel(A);
    await next(A);
    await tap(A, cur + ' .foot .icon-btn[aria-label="More"]');
    const hiddenOnA = await curLabel(A);
    await tap(A, '#mHide');
    await sleep(1700); await next(A);                                      // the card shown 1.7 s counts as read
    let posOnA = await curLabel(A);
    await syncNow(A);
    const prog = db.vanchan_progress.reduce((o, r) => ({ marks: o.marks + Object.values(r.marks).filter((t) => t > 0).length, hidden: o.hidden + Object.values(r.hidden).filter((t) => t > 0).length, read: o.read + Object.keys(r.read).length, pos: o.pos || !!r.pos }), { marks: 0, hidden: 0, read: 0, pos: false });
    check('saved, hidden, read card and place reach Supabase', prog.marks === 1 && prog.hidden === 1 && prog.read >= 1 && prog.pos, prog);

    /* ---------- device B: books and progress arrive ---------- */
    await Bd.goto(ORIGIN + '/', { waitUntil: 'networkidle0' });
    check('a new device starts empty', !(await Bd.evaluate(() => document.getElementById('welcome').hidden)));
    await switchOn(Bd);
    await Bd.waitForFunction(() => window.Sync && window.Sync.status().lastSync > 0, { timeout: 60000 }).catch(() => {});
    await sleep(800);
    const libB = await libTitles(Bd);
    const toastsB = await Bd.evaluate(() => window.__toasts);
    check('B shows progress while the books come in', toastsB.some((t) => /^Getting books from your other devices… 1 of 2/.test(t)) && toastsB.some((t) => /^Added 2 books from your other devices/.test(t)), toastsB.filter((t) => /book/.test(t)));
    check('signing in on B brings A\'s books', libB.length === 3 && libB.some((t) => /Anticancer/.test(t)) && libB.some((t) => /Sample Notes/.test(t)), libB);
    const savedB = await savedTitles(Bd);
    // saved-list labels may start with the card's number ("6. …")
    const plain = (t) => t.replace(/^\d+\. /, '').replace(/…$/, '');
    const sameCard = (label, l2) => !!label && !!l2 && plain(label).slice(0, 20) === plain(l2).slice(0, 20);
    check('the card saved on A is saved on B', savedB.length === 1 && sameCard(savedB[0], savedOnA), [savedB, savedOnA]);
    const kvB = (k) => Bd.evaluate((key) => new Promise((res) => { const rq = indexedDB.open('vanchan'); rq.onsuccess = () => { const g = rq.result.transaction('kv').objectStore('kv').get(key); g.onsuccess = () => res(g.result ? g.result.v : null); }; }), k);
    const hiddenB = await kvB('hidden');
    check('the card hidden on A is hidden on B', Array.isArray(hiddenB) && hiddenB.length === 1, hiddenB);
    await syncNow(Bd);
    await Bd.screenshot({ path: path.join(SHOTS, 'sync-2-device-b.png') });

    /* ---------- "Continue" offer ---------- */
    // B has not read anything yet, so A's place is newer. A moves on until it
    // stands on a card B isn't showing (B is not offered the card it is on).
    for (let i = 0; i < 4 && posOnA === await curLabel(Bd); i++) { await next(A); posOnA = await curLabel(A); await syncNow(A); }
    await Bd.evaluate(() => document.getElementById('toast').hidden = true);
    await syncNow(Bd);
    const offered = await waitToast(Bd, /^Continue from /, 3000) || (await syncNow(Bd), await waitToast(Bd, /^Continue from /, 3000));
    const offerText = await toastText(Bd);
    const beforeContinue = await curLabel(Bd);
    check('B offers to continue where A was', offered && offerText.indexOf(posOnA ? posOnA.slice(0, 15) : '###') >= 0, [offerText, posOnA]);
    await Bd.evaluate(() => document.getElementById('toastAction').click()); await sleep(600);
    const labelB = await curLabel(Bd);
    check('Continue opens that card', labelB === posOnA, [labelB, posOnA]);
    check('B did not jump by itself before Continue was tapped', beforeContinue !== posOnA, [beforeContinue, posOnA]);

    /* ---------- B saves offline; it reaches A later ---------- */
    await Bd.setOfflineMode(true);
    await next(Bd);
    const savedOnB = await curLabel(Bd);
    await tap(Bd, cur + ' .foot .icon-btn:nth-last-child(3)');
    await syncNow(Bd);
    const offSt = await status(Bd);
    check('offline: sync says it will catch up', /Offline/.test(offSt.error), offSt.error);
    await Bd.setOfflineMode(false);
    await Bd.evaluate(() => window.dispatchEvent(new Event('online')));
    await sleep(2500); await syncNow(Bd);
    await syncNow(A); await sleep(500);
    const savedA2 = await savedTitles(A);
    check('a card saved offline on B shows on A once B is back online', savedA2.length === 2 && savedA2.some((t) => sameCard(t, savedOnB)), [savedA2, savedOnB]);

    /* ---------- highlights, notes and pen marks cross over ---------- */
    const selectFirstWords = (pg) => pg.evaluate((c) => {
      const p = document.querySelector(c + ' .text p'); const w = document.createTreeWalker(p, 4); const n = w.nextNode();
      const r = document.createRange(); r.setStart(n, 0); r.setEnd(n, Math.min(n.nodeValue.length, 14));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.dispatchEvent(new Event('selectionchange'));
      return sel.toString().trim();
    }, cur);
    const marksOf = (pg) => pg.evaluate(() => new Promise((res) => { const rq = indexedDB.open('vanchan'); rq.onsuccess = () => { const g = rq.result.transaction('marks').objectStore('marks').getAll(); g.onsuccess = () => { rq.result.close(); res(g.result); }; }; }));
    // A: a highlight with a typed note, and a pen stroke on the card
    let words = '';
    for (let i = 0; i < 6 && !(words = await selectFirstWords(A)); i++) await next(A);
    await sleep(400);
    await tap(A, '#selNote'); await sleep(400);
    await A.evaluate(() => document.querySelector('#noteTabs [data-v="type"]').click());
    await A.type('#noteText', 'note from A');
    await A.evaluate(() => document.getElementById('noteSave').click()); await sleep(500);
    await A.evaluate((c) => document.querySelector(c + ' .foot .icon-btn[aria-label="Pen"]').click(), cur); await sleep(500);
    const box = await (await A.$(cur + ' .ink-layer.live')).boundingBox();
    await A.mouse.move(box.x + 20, box.y + 30); await A.mouse.down(); await A.mouse.move(box.x + 120, box.y + 40, { steps: 5 }); await A.mouse.up(); await sleep(300);
    await A.evaluate((c) => document.querySelector(c + ' .pen-done').click(), cur); await sleep(400);
    await syncNow(A);
    check('marks reach Supabase (highlight with note, pen marks)', db.vanchan_marks.filter((r) => !r.deleted).length === 2, db.vanchan_marks.map((r) => r.kind));
    await syncNow(Bd); await sleep(400);
    const mB = (await marksOf(Bd)).filter((m) => !m.del);
    const hB = mB.find((m) => m.type === 'text'), iB = mB.find((m) => m.type === 'ink-card');
    check('B gets the highlight, its note and the pen marks', hB && hB.q === words && hB.note && hB.note.text === 'note from A' && iB && iB.strokes.length === 1, mB.map((m) => m.type + ':' + (m.q || '')));
    // B removes the highlight; A loses it too
    await tap(Bd, '#btnSaved'); await Bd.evaluate(() => document.querySelector('#savedTabs [data-v="marks"]').click()); await sleep(300);
    await Bd.evaluate(() => Array.from(document.querySelectorAll('#marksList .mark-item')).find((b) => /“/.test(b.innerText)).click()); await sleep(800);
    await Bd.evaluate((c) => document.querySelector(c + ' .text .hl').click(), cur); await sleep(300);
    await Bd.evaluate(() => document.getElementById('mbRemove').click()); await sleep(400);
    await syncNow(Bd); await syncNow(A); await sleep(400);
    const mA = (await marksOf(A)).filter((m) => m.type === 'text');
    check('removing the highlight on B removes it on A', mA.length && mA.every((m) => m.del) && !(await A.evaluate((c) => document.querySelector(c + ' .text .hl'), cur)), mA.map((m) => m.del));
    // without the marks table: the rest still syncs, and Settings says why
    marksMissing = true;
    await syncNow(A);
    const stM = await status(A);
    check('without the marks table, sync still works and says the database needs updating', !stM.error && stM.marksMissing, stM);
    marksMissing = false;
    await syncNow(A);

    /* ---------- rename and delete everywhere ---------- */
    await tap(A, '#btnLib');
    await A.evaluate(() => { const r = Array.from(document.querySelectorAll('#bookList .book-row')).find((x) => /Sample Notes/.test(x.innerText)); r.querySelector('[aria-label="Rename"]').click(); });
    await sleep(500); await back(A);
    await syncNow(A); await syncNow(Bd); await sleep(300);
    check('a rename on A shows on B', (await libTitles(Bd)).includes('Renamed on A'), await libTitles(Bd));
    await tap(A, '#btnLib');
    await A.evaluate(() => { const r = Array.from(document.querySelectorAll('#bookList .book-row')).find((x) => /Renamed on A/.test(x.innerText)); r.querySelector('[aria-label="Delete"]').click(); });
    await sleep(800); await back(A);
    check('delete asks about all devices', /from all your devices\?/.test(A.dialogs[A.dialogs.length - 1] || ''), A.dialogs[A.dialogs.length - 1]);
    await syncNow(A); await syncNow(Bd); await sleep(500);
    const libB2 = await libTitles(Bd);
    check('a book deleted on A goes from B too', libB2.length === 2 && !libB2.includes('Renamed on A'), libB2);
    check('its file is removed from storage', Object.keys(files).length === 1, Object.keys(files).length);

    /* ---------- switching off ---------- */
    await tap(Bd, '#btnAa'); await Bd.tap('#syncOn'); await sleep(400); await back(Bd);
    const before = hits.length;
    await next(Bd);
    await tap(Bd, cur + ' .foot .icon-btn:nth-last-child(3)');
    await Bd.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await sleep(5000);
    check('switched off: nothing more is sent', hits.length === before, hits.slice(before));
    const authBefore = hits.filter((h) => h === 'GET /auth/v1/authorize').length;
    const nav = await switchOn(Bd);
    await sleep(1500);
    check('switching on again needs no new sign-in', !nav && hits.filter((h) => h === 'GET /auth/v1/authorize').length === authBefore && (await status(Bd)).on);
    await back(Bd);

    /* ---------- token renewal: one at a time, shared between tabs ---------- */
    await tap(A, cur + ' .foot .icon-btn:nth-last-child(3)');   // something to send
    const tab2 = await A.browserContext().newPage();
    await tab2.goto(ORIGIN + '/', { waitUntil: 'networkidle0' });
    await sleep(1500);
    validFrom = tokenN + 1;                           // every token in use now expires: both tabs must renew
    const renewalsBefore = hits.filter((h) => h === 'POST /auth/v1/token').length;
    await Promise.all([
      syncNow(A), syncNow(tab2),
      A.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); })
    ]);
    await sleep(1500);
    await A.evaluate(() => { delete document.hidden; });
    const s1 = await status(A), s2 = await status(tab2);
    const renewals = hits.filter((h) => h === 'POST /auth/v1/token').length - renewalsBefore;
    check('renewing tokens at the same moment (leaving the app, a second tab) keeps the device signed in',
      renewals >= 1 && reused.length === 0 && s1.signedIn && s2.signedIn && !s1.error && !s2.error, { renewals, reused, s1: s1.error, s2: s2.error });
    await tab2.close();

    /* ---------- a book from an older version, without its original ---------- */
    await Bd.evaluate(() => new Promise((res) => {
      const rq = indexedDB.open('vanchan');
      rq.onsuccess = () => {
        const t = rq.result.transaction('books', 'readwrite'), st = t.objectStore('books');
        st.put({ id: 'old1', title: 'Old EPUB', kind: 'epub', added: 1, count: 0 });
        t.oncomplete = () => res();
      };
    }));
    await Bd.reload({ waitUntil: 'networkidle0' }); await sleep(1500);
    await tap(Bd, '#btnAa');
    const oldText = await text(Bd, '#syncStatus');
    check('Settings says which books can\'t sync', /1 book was added by an older version and can't sync/.test(oldText), oldText);
    await back(Bd);

    /* ---------- sign out ---------- */
    const booksBefore = (await libTitles(A)).length;
    await tap(A, '#btnAa'); await tap(A, '#syncOut'); await sleep(800);
    const stOut = await status(A);
    check('sign out: sync off, account forgotten, books kept', !stOut.on && !stOut.signedIn && hits.includes('POST /auth/v1/logout') && (await libTitles(A)).length === booksBefore, stOut);

    check('no script errors', A.errors.length + Bd.errors.length === 0, A.errors.concat(Bd.errors).slice(0, 5));
  } catch (e) {
    check('test run finished', false, e.stack.split('\n').slice(0, 3).join(' | '));
    await A.screenshot({ path: path.join(SHOTS, 'sync-crash-a.png') }).catch(() => {});
    await Bd.screenshot({ path: path.join(SHOTS, 'sync-crash-b.png') }).catch(() => {});
  }
  await browser.close();
  srv.close();
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' / ' + results.length + ' sync checks passed' + (failed.length ? '\nFAILED: ' + failed.map((r) => r.name).join('; ') : ''));
  process.exit(failed.length ? 1 : 0);
})();
