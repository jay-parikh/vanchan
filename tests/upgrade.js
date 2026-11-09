/*
 * Upgrade test: a device on the last released version (from git) gets this
 * version. Books, progress and saved cards must survive the database
 * upgrade (v2 → v3), also when another tab still runs the old version.
 *   node upgrade.js [git ref of the old version, default HEAD]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

const NEW = process.env.APP || path.join(__dirname, '../app');
const REF = process.argv[2] || 'HEAD';
const B = path.join(__dirname, '../..');
const WORK = path.join(__dirname, '.work-upgrade');
const SHOTS = path.join(__dirname, 'shots');
const LIBS = path.join(__dirname, '.libs');
const PORT = 8772;
process.env.LD_LIBRARY_PATH = [LIBS + '/usr/lib/x86_64-linux-gnu', LIBS + '/lib/x86_64-linux-gnu', LIBS + '/usr/lib'].join(':');

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  — ' + JSON.stringify(info) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let SITE = null;   // which version the server hands out

(async () => {
  execSync('rm -rf ' + JSON.stringify(WORK) + ' && mkdir -p ' + JSON.stringify(WORK + '/old') + ' ' + JSON.stringify(SHOTS));
  execSync('git -C ' + JSON.stringify(path.join(__dirname, '..')) + ' archive ' + REF + ' app | tar -x -C ' + JSON.stringify(WORK + '/old'));
  execSync('cp -r ' + JSON.stringify(NEW) + ' ' + JSON.stringify(WORK + '/new'));
  for (const v of ['old/app', 'new']) fs.writeFileSync(path.join(WORK, v, 'js/config.js'), 'window.VANCHAN_SYNC = null;\n');
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
  const errors = [];
  const open = async () => {
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => d.accept());
    await p.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true });
    return p;
  };
  const dbInfo = (p) => p.evaluate(() => new Promise((res) => {
    const rq = indexedDB.open('vanchan');
    rq.onsuccess = () => {
      const d = rq.result, stores = Array.from(d.objectStoreNames);
      const g = d.transaction('books').objectStore('books').getAll();
      g.onsuccess = () => { const out = { version: d.version, stores, books: g.result.map((b) => b.title) }; d.close(); res(out); };
    };
  }));
  try {
    // the old version: add a book and save a card
    SITE = path.join(WORK, 'old/app');
    const p1 = await open();
    await p1.goto('http://localhost:' + PORT + '/', { waitUntil: 'networkidle0' });
    await (await p1.$('#file')).uploadFile(path.join(B, '10-Dadavani-Oct-2026-Guj.pdf'));
    await p1.waitForFunction(() => document.getElementById('importModal').hidden, { timeout: 120000 });
    await sleep(800);
    await p1.evaluate(() => document.querySelector('.card:not(.under) .foot .icon-btn.save').click());
    await sleep(800);
    const before = await dbInfo(p1);
    check('released version: a book on the device', before.books.length === 1, before);
    // the released version has marks: add one, it must survive the update
    if (before.stores.indexOf('marks') >= 0) {
      await p1.evaluate(() => new Promise((res) => {
        const rq = indexedDB.open('vanchan');
        rq.onsuccess = () => {
          const d = rq.result, t = d.transaction(['books', 'marks'], 'readwrite');
          t.objectStore('books').getAll().onsuccess = (e) => {
            const b = e.target.result[0];
            t.objectStore('marks').put({ id: 'mUpgrade1', b: b.id, key: b.key, type: 'cardnote', n: 1, note: { text: 'kept' }, at: Date.now() });
          };
          t.oncomplete = () => { d.close(); res(); };
        };
      }));
    }

    // a tab that can't update itself (its updater switched off) keeps the old version open
    await p1.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))));
    await sleep(500);
    // the new version opens in a second tab while that one is still open
    SITE = path.join(WORK, 'new');
    const p2 = await open();
    await p2.goto('http://localhost:' + PORT + '/?v=new', { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    const waiting = await p2.evaluate(() => document.getElementById('toastText').textContent);
    const NEW_DB = 3;
    if (before.version < NEW_DB) {
      check('with the old tab open, the new version waits and says to close it (no empty library)', /Close other Vanchan tabs/.test(waiting) && await p2.evaluate(() => document.getElementById('welcome').hidden !== false || document.querySelectorAll('.card').length === 0), waiting);
    } else console.log('SKIP  same database version (' + before.version + '): no upgrade to wait for');
    await p1.close();
    await sleep(2500);
    const after = await dbInfo(p2);
    check('the new version has the book (database ' + after.version + ')', after.version === NEW_DB && after.stores.indexOf('marks') >= 0 && after.books.length === 1, after);
    if (before.stores.indexOf('marks') >= 0) {
      const kept = await p2.evaluate(() => new Promise((res) => { const rq = indexedDB.open('vanchan'); rq.onsuccess = () => { const g = rq.result.transaction('marks').objectStore('marks').get('mUpgrade1'); g.onsuccess = () => { rq.result.close(); res(g.result && g.result.note.text); }; }; }));
      check('a note made in the released version is still there', kept === 'kept', kept);
    }
    const shown = await p2.evaluate(() => ({ cards: document.querySelectorAll('.card').length, welcome: !document.getElementById('welcome').hidden }));
    check('… and the book shows', shown.cards > 0 && !shown.welcome, shown);
    await p2.evaluate(() => document.getElementById('btnSaved').click()); await sleep(400);
    check('the saved card is still saved', await p2.evaluate(() => document.querySelectorAll('#savedList .saved-item').length === 1));
    await p2.screenshot({ path: path.join(SHOTS, 'u01-upgraded.png') });
    check('no script errors', errors.length === 0, errors.slice(0, 3));
  } catch (e) {
    check('test run finished', false, e.stack.split('\n').slice(0, 3).join(' | '));
  }
  await browser.close();
  srv.close();
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' / ' + results.length + ' upgrade checks passed' + (failed.length ? '\nFAILED: ' + failed.map((r) => r.name).join('; ') : ''));
  process.exit(failed.length ? 1 : 0);
})();
