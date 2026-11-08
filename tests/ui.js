/*
 * Browser smoke test for ../app, in headless Chromium (phone size).
 *
 * Walks through every main flow, in both random and book order, on a fresh
 * profile: import of each file type, swiping, saving, hiding, contents,
 * search, settings, the PDF page viewer, rename/delete, persistence, offline
 * start and the automatic update. Prints PASS/FAIL per check and screenshots
 * to shots/. Run before every build:  node ui.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

const APP = process.env.APP || path.join(__dirname, '../app');
const B = path.join(__dirname, '../..');   // the sample books sit next to the vanchan folder
const WORK = path.join(__dirname, '.work');
const SITE = path.join(WORK, 'site');
const SHOTS = path.join(__dirname, 'shots');
const LIBS = path.join(__dirname, '.libs');
const PORT = 8766;

process.env.LD_LIBRARY_PATH = [LIBS + '/usr/lib/x86_64-linux-gnu', LIBS + '/lib/x86_64-linux-gnu', LIBS + '/usr/lib'].join(':');

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  — ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a tiny static server, so the service worker runs (localhost counts as secure)
function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain', '.md': 'text/markdown' };
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(SITE, p);
      if (!f.startsWith(SITE) || !fs.existsSync(f)) { resp.writeHead(404); return resp.end(); }
      resp.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(f).pipe(resp);
    }).listen(PORT, '127.0.0.1', () => res(srv));
  });
}

(async () => {
  execSync('rm -rf ' + JSON.stringify(WORK) + ' ' + JSON.stringify(SHOTS) + ' && mkdir -p ' + JSON.stringify(WORK) + ' ' + JSON.stringify(SHOTS));
  execSync('cp -r ' + JSON.stringify(APP) + ' ' + JSON.stringify(SITE));
  fs.writeFileSync(path.join(WORK, 'notes.txt'), 'Plain notes\n\nA plain text file is read like Markdown, so this paragraph with enough words becomes one card in the app.\n\nThe app needs at least forty words in a book before it accepts it, so here is a second paragraph that makes the whole file long enough to pass that check.\n');
  const srv = await serve();
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-gpu'], userDataDir: path.join(WORK, 'profile') });
  const page = await browser.newPage();
  const errors = [], dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|clipboard|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
  const supabaseCalls = [];
  page.on('request', (r) => { if (/supabase\.co/.test(r.url())) supabaseCalls.push(r.method() + ' ' + r.url()); });
  page.on('dialog', async (d) => { dialogs.push(d.message()); if (d.type() === 'prompt') await d.accept('Renamed book'); else await d.accept(); });
  await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const URL = 'http://localhost:' + PORT + '/';
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + '.png') });
  const $text = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText : null; }, sel);
  const cur = '.card:not(.under)';
  const pos = () => $text(cur + ' .foot .pos');
  const curId = () => page.evaluate((c) => { const e = document.querySelector(c); return e && e.dataset.id; }, cur);
  // long cards scroll their text first; a swipe moves on only at the end of the text
  const scrollCard = (where) => page.evaluate((c, w) => { const b = document.querySelector(c + ' .body'); b.scrollTop = w === 'end' ? b.scrollHeight : 0; }, cur, where);
  // Footer buttons, named by the icon they draw (not by their label, which the
  // app changes): e.g. ['shuffle:Back to random cards', 'save*:Remove from saved', 'share:Share', 'more:More'].
  // A * marks a lit button.
  const footState = () => page.evaluate((c) => Array.from(document.querySelectorAll(c + ' .foot .icon-btn')).map((b) => {
    const d = (b.querySelector('path') || {}).getAttribute ? b.querySelector('path').getAttribute('d') : '';
    const kind = /^M7 4h10/.test(d) ? 'save' : /^M4 7h3/.test(d) ? 'shuffle' : /^M12 3v12/.test(d) ? 'share' : b.querySelector('circle') ? 'more' : '?';
    return kind + (b.classList.contains('on') ? '*' : '') + ':' + b.getAttribute('aria-label');
  }), cur);
  const LABELS = { save: 'Save card', 'save*': 'Remove from saved', shuffle: 'Back to random cards', share: 'Share', more: 'More' };
  // every button has its own label, and only the bookmark is lit (when saved)
  const footOk = (f, saved) => f.every((x) => { const [k, l] = x.split(':'); return LABELS[k] === l; }) &&
    f.filter((x) => x.indexOf('*') >= 0).join() === (saved ? 'save*:Remove from saved' : '');
  const inBookOrder = (f) => f[0] === 'shuffle:Back to random cards';
  const isSaved = (f) => f.indexOf('save*:Remove from saved') >= 0;
  const tap = async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 5000 }); await page.tap(sel); await sleep(350); };
  const sheetOpen = (id) => page.evaluate((i) => !document.getElementById(i).hidden, id);
  const next = async () => { await page.keyboard.press('ArrowDown'); await sleep(600); };
  const prev = async () => { await page.keyboard.press('ArrowUp'); await sleep(600); };
  const back = async () => { await page.evaluate(() => history.back()); await sleep(400); };

  try {
    // ---------- first start ----------
    await page.goto(URL, { waitUntil: 'networkidle0' });
    check('first start shows the welcome screen', await page.evaluate(() => !document.getElementById('welcome').hidden));
    await page.waitForFunction(() => navigator.serviceWorker.controller, { timeout: 30000 }).catch(() => {});
    check('service worker controls the page', await page.evaluate(() => !!navigator.serviceWorker.controller));
    await shot('01-welcome');

    // ---------- import every kind of file ----------
    const imp = async (file) => {
      const before = await page.evaluate(() => document.getElementById('toastText').textContent);
      await (await page.$('#file')).uploadFile(file);
      await page.waitForFunction(() => document.getElementById('importModal').hidden, { timeout: 300000 });
      await sleep(600);
      const t = await page.evaluate(() => document.getElementById('toastText').textContent);
      return t !== before ? t : '';
    };
    const imports = [
      ['Markdown', path.join(__dirname, 'sample.md')],
      ['plain text', path.join(WORK, 'notes.txt')],
      ['EPUB', path.join(B, 'Aptavani-01.epub')],
      ['Gujarati PDF', path.join(B, '10-Dadavani-Oct-2026-Guj.pdf')],
      ['English PDF', path.join(B, 'Anticancer Living by Cohen and Jefferies_ Summary, Lessons and P.pdf')]
    ];
    for (const [kind, f] of imports) {
      const t = await imp(f);
      check('import ' + kind, /^Added /.test(t), t);
    }
    const kinds = await page.evaluate(() => new Promise((res) => {
      const rq = indexedDB.open('vanchan');
      rq.onsuccess = () => { const g = rq.result.transaction('books').objectStore('books').getAll(); g.onsuccess = () => res(g.result.map((b) => b.kind).sort().join(',')); };
    }));
    check('five books stored with their kinds', kinds === 'epub,md,md,pdf,pdf', kinds);
    check('after import the app shows the new book', /Anticancer/.test(await $text('#scopeName')), await $text('#scopeName'));
    const engText = await $text(cur + ' .body');
    check('English PDF text has no broken ligatures', engText && !/[ﬀ-ﬆ]|ન[a-z]/.test(engText));
    await shot('02-english-card');

    // ---------- library and scope ----------
    await tap('#btnLib');
    const rows = await page.evaluate(() => document.querySelectorAll('#bookList .book-row').length);
    check('library lists all books + "All books"', rows === 6, rows);
    await shot('03-library');
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('#bookList .book-main')).find((b) => /Dadavani|dadavani|DADAVANI|10-Dadavani/i.test(b.innerText)); r.click(); });
    await sleep(500);
    console.log('      dialogs so far: ' + JSON.stringify(dialogs));
    check('choosing a book in the library switches to it', /Dadavani/i.test(await $text('#scopeName')) && !(await sheetOpen('sheetLib')), await $text('#scopeName'));

    // ---------- moving between cards ----------
    check('up/down buttons are hidden on a phone', await page.evaluate(() => getComputedStyle(document.getElementById('navBtns')).display === 'none'));
    // a real touch swipe up
    const cdp = await page.target().createCDPSession();
    const swipe = async (y0, y1) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: y0 }] });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: y0 + (y1 - y0) * i / 8 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(700);
    };
    // find a card whose text is longer than the screen (random order differs each run)
    const isLong = () => page.evaluate((c) => { const b = document.querySelector(c + ' .body'); return b.scrollHeight > b.clientHeight + 40; }, cur);
    for (let i = 0; i < 10 && !(await isLong()); i++) await next();
    let s0 = await curId();
    if (await isLong()) {
      await scrollCard('top');
      await swipe(500, 380);
      check('a swipe at the top of a long card scrolls its text, not the card', (await curId()) === s0);
    } else check('a swipe at the top of a long card scrolls its text, not the card', false, 'no long card found');
    s0 = await curId();
    await scrollCard('end');
    await swipe(600, 150);
    const s1 = await curId();
    check('swipe up at the end of the text shows the next card', s1 && s1 !== s0, await pos());
    await scrollCard('top');
    await swipe(150, 650);
    check('swipe down goes back', (await curId()) === s0, await pos());
    await next();
    check('arrow keys move between cards', (await curId()) !== s0);
    await prev();
    check('arrow up goes back', (await curId()) === s0);

    // ---------- save in random order ----------
    const saveTest = async (mode) => {
      const f0 = await footState();
      await tap(cur + ' .foot .icon-btn:nth-last-child(3)');   // the bookmark: third from the right
      const f1 = await footState();
      check('[' + mode + '] save lights only the bookmark', footOk(f1, true), f1);
      return f0;
    };
    await saveTest('random order');
    const savedId = await page.evaluate((c) => document.querySelector(c).dataset.id, cur);
    await tap('#btnSaved');
    const savedN = await page.evaluate(() => document.querySelectorAll('#savedList .saved-item').length);
    check('saved list shows the saved card', savedN === 1, savedN);
    await shot('04-saved');
    await back();
    await next(); await next();
    await tap('#btnSaved'); await tap('#savedList .saved-item');
    check('tapping a saved card opens it', (await page.evaluate((c) => document.querySelector(c).dataset.id, cur)) === savedId);
    await tap(cur + ' .foot .icon-btn:nth-last-child(3)');
    check('[random order] unsave clears the bookmark', footOk(await footState(), false), await footState());

    // ---------- hide and undo ----------
    const hidId = await page.evaluate((c) => document.querySelector(c).dataset.id, cur);
    await tap(cur + ' .foot .icon-btn[aria-label="More"]');
    check('card menu opens', await sheetOpen('sheetMenu'));
    await tap('#mHide');
    const afterHide = await page.evaluate((c) => document.querySelector(c).dataset.id, cur);
    check('hide removes the card', afterHide !== hidId);
    await page.evaluate(() => document.getElementById('toastAction').click()); await sleep(400);
    check('undo brings it back', (await page.evaluate((c) => document.querySelector(c).dataset.id, cur)) === hidId);

    // ---------- copy ----------
    await tap(cur + ' .foot .icon-btn[aria-label="More"]');
    await tap('#mCopy');
    const ct = await page.evaluate(() => document.getElementById('toastText').textContent);
    check('copy text gives feedback', /copied|Could not copy/.test(ct), ct);

    // ---------- contents and book order ----------
    await tap(cur + ' .band');
    const tocN = await page.evaluate(() => document.querySelectorAll('#tocList .toc-item').length);
    check('contents opens from the book band', (await sheetOpen('sheetToc')) && tocN > 3, tocN);
    await shot('05-contents');
    const tocPick = await page.evaluate(() => { const items = document.querySelectorAll('#tocList .toc-item'); const b = items[Math.min(3, items.length - 1)]; const t = b.querySelector('.toc-t').innerText; b.click(); return t; });
    await sleep(600);
    const title = await $text(cur + ' .title');
    check('contents entry opens that sub-topic', title && tocPick.indexOf(title.slice(0, 15)) === 0 || (title || '').indexOf(tocPick.replace('…', '').slice(0, 15)) === 0, [tocPick, title]);
    const fb = await footState();
    check('book order shows "Back to random cards"', inBookOrder(fb) && footOk(fb, false), fb);
    await saveTest('book order');
    await tap(cur + ' .foot .icon-btn:nth-last-child(3)');
    check('[book order] unsave clears the bookmark', footOk(await footState(), false), await footState());
    const bp0 = await pos();
    await next();
    check('[book order] next card', (await pos()) !== bp0);
    await shot('06-book-order');
    await tap(cur + ' .foot .icon-btn[aria-label="Back to random cards"]');
    check('shuffle button returns to random order', !inBookOrder(await footState()));
    // book order from the card menu
    await tap(cur + ' .foot .icon-btn[aria-label="More"]');
    await tap('#mBookOrder');
    check('"Read this book in order" from the menu', inBookOrder(await footState()));
    await tap(cur + ' .foot .icon-btn[aria-label="More"]');
    check('"Back to random cards" shown in the menu in book order', await page.evaluate(() => !document.getElementById('mRandom').hidden));
    await tap('#mRandom');
    check('menu returns to random order', !inBookOrder(await footState()));

    // ---------- settings ----------
    await tap('#btnAa');
    await page.evaluate(() => { const r = document.getElementById('fs'); r.value = 24; r.dispatchEvent(new Event('input')); });
    check('text size slider', await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim() === '24px'));
    await tap('.seg[data-setting="theme"] button[data-v="dark"]');
    check('dark theme', await page.evaluate(() => document.documentElement.dataset.theme === 'dark'));
    await tap('.seg[data-setting="font"] button[data-v="sans"]');
    check('sans font', await page.evaluate(() => document.documentElement.dataset.font === 'sans'));
    const onBtns = await page.evaluate(() => Array.from(document.querySelectorAll('.seg[data-setting] button.on')).map((b) => b.dataset.v).join(','));
    check('settings show the chosen options', onBtns === 'sans,dark,random', onBtns);
    await page.evaluate(() => document.fonts.ready); await sleep(300);
    const sansOk = await page.evaluate(() => document.fonts.check('700 20px "Noto Sans Gujarati"', 'અ'));
    check('Sans Gujarati font loaded', sansOk);
    await shot('07-settings-dark');
    const sw = await page.evaluate(() => ({ shown: !document.getElementById('syncField').hidden, on: document.getElementById('syncOn').checked, available: window.Sync.available() }));
    check('sync switch shown in Settings and off by default', sw.shown && !sw.on && sw.available, sw);
    await tap('.seg[data-setting="order"] button[data-v="book"]');
    await back();
    check('settings → book order', inBookOrder(await footState()));
    await tap(cur + ' .foot .icon-btn:nth-last-child(3)');
    check('[book order via settings] save lights only the bookmark', footOk(await footState(), true), await footState());
    await tap(cur + ' .foot .icon-btn:nth-last-child(3)');
    await tap('#btnAa'); await tap('.seg[data-setting="order"] button[data-v="random"]');
    await tap('.seg[data-setting="theme"] button[data-v="light"]'); await tap('.seg[data-setting="font"] button[data-v="serif"]');
    await page.evaluate(() => { const r = document.getElementById('fs'); r.value = 18; r.dispatchEvent(new Event('input')); });
    await back();
    check('back button closes a sheet', !(await sheetOpen('sheetAa')));

    // ---------- PDF page viewer ----------
    let chip = await page.$(cur + ' button.page-chip');
    for (let i = 0; !chip && i < 6; i++) { await next(); chip = await page.$(cur + ' button.page-chip'); }
    if (chip) {
      await chip.tap(); await sleep(2500);
      const v = await page.evaluate(() => { const c = document.getElementById('vCanvas'); return { open: !document.getElementById('viewer').hidden, w: c.width, title: document.getElementById('vTitle').innerText }; });
      check('page chip opens the original PDF page', v.open && v.w > 100, v);
      await shot('08-viewer');
      await tap('#vNext'); await sleep(1500);
      const t2 = await $text('#vTitle');
      check('viewer next page', t2 !== v.title, [v.title, t2]);
      await tap('#vClose');
      check('viewer closes', await page.evaluate(() => document.getElementById('viewer').hidden));
    } else check('page chip opens the original PDF page', false, 'no PDF card with a page chip found');

    // ---------- search ----------
    await tap('#btnLib');
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('#bookList .book-main')).find((b) => /Aptavani|આપ્તવાણી/i.test(b.innerText)); r.click(); });
    await sleep(500);
    await tap('#btnSearch');
    check('search opens with the scope switch', (await sheetOpen('sheetSearch')) && await page.evaluate(() => !document.getElementById('qScope').hidden));
    const typeQ = async (q) => { await page.evaluate((v) => { const i = document.getElementById('q'); i.value = v; i.dispatchEvent(new Event('input')); }, q); await sleep(450); return $text('#qCount'); };
    const c1 = await typeQ('દાદાશ્રી');
    check('search this book finds cards', /\d+ card|First/.test(c1), c1);
    await tap('#qScope button[data-v="all"]');
    const c2 = await $text('#qCount');
    check('search all books finds at least as many', parseInt(c2.replace(/\D+/g, ' ').trim().split(' ').pop(), 10) >= parseInt(c1.replace(/\D+/g, ' ').trim().split(' ').pop(), 10), [c1, c2]);
    const c3 = await typeQ('FINDINGS');
    check('search ignores case (English)', /card/.test(c3) && !/No cards/.test(c3), c3);
    check('no-match message', /No cards/.test(await typeQ('zzqxj')));
    await typeQ('શાસ્ત્ર');
    await shot('09-search');
    const resN = await page.evaluate(() => document.querySelectorAll('#qList .search-item').length);
    if (resN) {
      await tap('#qList .search-item');
      const marks = await page.evaluate((c) => document.querySelectorAll(c + ' .body mark').length, cur);
      check('search result opens the card with the words marked', !(await sheetOpen('sheetSearch')) && marks > 0, marks);
      await shot('10-search-hit');
      await next();
      check('marks go when moving on', (await page.evaluate((c) => document.querySelectorAll(c + ' .body mark').length, cur)) === 0);
    } else check('search result opens the card with the words marked', false, 'no results for શાસ્ત્ર');
    await tap('#btnSearch');
    check('search keeps the last words', (await page.evaluate(() => document.getElementById('q').value)) === 'શાસ્ત્ર');
    await back();

    // ---------- rename and delete ----------
    await tap('#btnLib');
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('#bookList .book-row')).find((x) => /Plain notes|notes/i.test(x.innerText)); r.querySelector('[aria-label="Rename"]').click(); });
    await sleep(500);
    check('rename a book', /Renamed book/.test(await $text('#bookList')));
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('#bookList .book-row')).find((x) => /Renamed book/.test(x.innerText)); r.querySelector('[aria-label="Delete"]').click(); });
    await sleep(800);
    const rows2 = await page.evaluate(() => document.querySelectorAll('#bookList .book-row').length);
    check('delete a book', rows2 === 5 && !/Renamed book/.test(await $text('#bookList')), rows2);
    await back();

    // ---------- persistence ----------
    await tap(cur + ' .foot .icon-btn:nth-last-child(3)');
    const keepId = await page.evaluate((c) => document.querySelector(c).dataset.id, cur);
    const scopeBefore = await $text('#scopeName');
    await sleep(800);
    await page.reload({ waitUntil: 'networkidle0' }); await sleep(800);
    check('after reload: same book and card', (await $text('#scopeName')) === scopeBefore && (await page.evaluate((c) => document.querySelector(c).dataset.id, cur)) === keepId);
    check('after reload: card still saved', isSaved(await footState()));

    // ---------- offline start ----------
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(1500);
    check('opens offline with the books', (await page.evaluate(() => document.querySelectorAll('.card').length)) > 0 && (await $text('#scopeName')) === scopeBefore);
    await page.setOfflineMode(false);

    // ---------- automatic update ----------
    const swFile = path.join(SITE, 'sw.js');
    fs.writeFileSync(swFile, fs.readFileSync(swFile, 'utf8').replace(/const VERSION = '([^']+)'/, "const VERSION = '$1-smoketest'"));
    let navs = 0;
    page.on('framenavigated', (fr) => { if (fr === page.mainFrame()) navs++; });
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    await sleep(6000);
    const up = await page.evaluate(async () => ({ keys: await caches.keys(), toast: document.getElementById('toastText').textContent }));
    check('new version installs and the app reloads itself once', navs === 1 && up.keys.length === 1 && /smoketest/.test(up.keys[0]), { navs, keys: up.keys });
    check('"App updated" shown', up.toast === 'App updated', up.toast);
    check('books and saved card kept after the update', (await $text('#scopeName')) === scopeBefore && isSaved(await footState()));

    // ---------- books read by an older parser are fixed without re-adding ----------
    // Fake an old, broken copy of three books, then restart the app.
    const idb = (fn, arg) => page.evaluate((src, a) => new Promise((res, rej) => {
      const rq = indexedDB.open('vanchan');
      rq.onsuccess = () => { const d = rq.result; Promise.resolve(new Function('d', 'a', src)(d, a)).then((v) => { d.close(); res(v); }, rej); };
    }), fn, arg);
    const prep = await idb(`
      const get = (st) => new Promise((r) => { const g = d.transaction(st).objectStore(st).getAll(); g.onsuccess = () => r(g.result); });
      return Promise.all([get('books'), get('cards'), get('kv')]).then(([books, cards, kv]) => {
        const eng = books.find((b) => /Anticancer/.test(b.title));
        const guj = books.find((b) => /Dadavani/i.test(b.title));
        const epub = books.find((b) => b.kind === 'epub');
        const t = d.transaction(['books', 'cards', 'kv', 'files'], 'readwrite');
        const bs = t.objectStore('books'), cs = t.objectStore('cards'), ks = t.objectStore('kv');
        // English: same cards, broken text
        delete eng.parser; bs.put(eng);
        cards.filter((c) => c.b === eng.id).forEach((c) => { c.p = c.p.map((x) => x.replace(/fi/g, 'ન')); cs.put(c); });
        // Gujarati: five cards fewer than the new parser makes
        delete guj.parser;
        const gc = cards.filter((c) => c.b === guj.id).sort((a, b) => a.n - b.n);
        gc.slice(-5).forEach((c) => cs.delete(c.id));
        guj.count = gc.length - 5; bs.put(guj);
        // EPUB added by an old version: no stored original
        delete epub.parser; delete epub.hasFile; bs.put(epub); t.objectStore('files').delete(epub.id);
        // save and mark read one card of each, and stand on the English one
        const engCard = eng.id + ':5', gujCard = gc[10].id;
        const marks = (kv.find((x) => x.k === 'marks') || { v: [] }).v.concat([engCard, gujCard]);
        ks.put({ k: 'marks', v: marks });
        ks.put({ k: 'read', v: [engCard, gujCard] });
        return new Promise((r) => { t.oncomplete = () => r({ eng: eng.id, guj: guj.id, epub: epub.id, engCard, gujCard, gujTitle: gc[10].t, gujCount: gc.length }); });
      });`);
    await page.evaluate((id) => { localStorage.setItem('vanchan:scope', JSON.stringify(id)); }, prep.eng);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => /Text updated/.test(document.getElementById('toastText').textContent), { timeout: 60000 }).catch(() => {});
    const toastUp = await page.evaluate(() => document.getElementById('toastText').textContent);
    check('old books are read again on start', /Text updated in 2 books/.test(toastUp), toastUp);
    const after2 = await idb(`
      const get = (st) => new Promise((r) => { const g = d.transaction(st).objectStore(st).getAll(); g.onsuccess = () => r(g.result); });
      return Promise.all([get('books'), get('cards'), get('kv')]).then(([books, cards, kv]) => ({
        books: books.map((b) => ({ id: b.id, parser: b.parser, count: b.count, n: cards.filter((c) => c.b === b.id).length, title: b.title })),
        engBroken: cards.filter((c) => c.b === a.eng && c.p.join(' ').indexOf('ન') >= 0).length,
        marks: (kv.find((x) => x.k === 'marks') || {}).v, read: (kv.find((x) => x.k === 'read') || {}).v,
        gujMarkTitle: (cards.find((c) => (kv.find((x) => x.k === 'marks') || { v: [] }).v.indexOf(c.id) >= 0 && c.b === a.guj) || {}).t }));`, prep);
    const bEng = after2.books.find((b) => b.id === prep.eng), bGuj = after2.books.find((b) => b.id === prep.guj), bEpub = after2.books.find((b) => b.id === prep.epub);
    check('same-size book: text fixed in place', after2.engBroken === 0 && bEng.parser >= 2 && bEng.n === bEng.count, { broken: after2.engBroken, bEng });
    check('same-size book: saved and read card kept', after2.marks.indexOf(prep.engCard) >= 0 && after2.read.indexOf(prep.engCard) >= 0);
    check('changed-size book: all cards back', bGuj.n === prep.gujCount && bGuj.count === prep.gujCount, bGuj);
    check('changed-size book: saved card follows its title', after2.gujMarkTitle === prep.gujTitle, [after2.gujMarkTitle, prep.gujTitle]);
    check('book without its original is left as it was', bEpub && !bEpub.parser && bEpub.n === bEpub.count, bEpub);
    check('the screen shows the fixed text', !/ન[a-z]/.test(await $text(cur + ' .body') || ''));
    await page.reload({ waitUntil: 'networkidle0' }); await sleep(3000);
    check('fixed books are not read again on the next start', !/Text updated/.test(await page.evaluate(() => document.getElementById('toastText').textContent)));

    check('with sync off, not one request went to Supabase', supabaseCalls.length === 0, supabaseCalls.slice(0, 3));
    check('no script errors', errors.length === 0, errors.slice(0, 5));
  } catch (e) {
    check('test run finished', false, e.message);
    await shot('99-crash').catch(() => {});
  }
  await browser.close();
  srv.close();
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' / ' + results.length + ' checks passed' + (failed.length ? '\nFAILED: ' + failed.map((r) => r.name).join('; ') : ''));
  process.exit(failed.length ? 1 : 0);
})();
