/*
 * Sync across devices (optional, off by default).
 *
 * When the reader switches sync on in Settings, the app signs in with Google
 * through Supabase Auth and keeps these the same on every device that has
 * sync on: the books themselves (the original files), read / saved / hidden
 * cards, and the card last read in each book. Nothing is sent while sync is
 * off. Supabase is called with plain fetch (no SDK), like the inventory app.
 *
 * A book is known across devices by the SHA-256 of its original file
 * (book.key); a card by book key + its number n in the book. Card numbers
 * only match when both devices read the book with the same PARSER, so
 * progress of a book is merged only then.
 *
 * Merging (see merge()): read cards are a union (a "mark all unread" time
 * clears what was read before it); saved and hidden cards keep the newest
 * change per card (+time = on, -time = off); the last read card is the
 * newest one.
 *
 * The app passes an adapter to init() so this file never touches its state.
 */
(function (root) {
  'use strict';

  var BUCKET = 'vanchan-books';
  var PULL_GAP = 60000;        // pull at most once a minute when the app comes back
  var PUSH_DELAY = 4000;       // changes are sent in small batches

  var cfg = root.VANCHAN_SYNC && root.VANCHAN_SYNC.url && root.VANCHAN_SYNC.key ? root.VANCHAN_SYNC : null;
  var base = cfg ? cfg.url.replace(/\/+$/, '') : '';

  var A = null;                // app adapter
  var session = null;          // { access_token, refresh_token, expires_at, user: { id, email } }
  var state = {};              // book key -> progress { parser, read, readReset, marks, hidden, pos }
  var dirty = { progress: {}, books: {}, deleted: {} };
  var started = false, running = null, pushTimer = null, lastPull = 0;
  var status = { busy: false, error: '', lastSync: 0 };
  var shownPos = 0;            // newest other-device place already offered

  /* ---------- small helpers ---------- */

  function ls(k, v) {
    try {
      if (v === undefined) { var s = localStorage.getItem('vanchan:' + k); return s == null ? null : JSON.parse(s); }
      if (v === null) localStorage.removeItem('vanchan:' + k); else localStorage.setItem('vanchan:' + k, JSON.stringify(v));
    } catch (e) { /* private mode */ }
    return null;
  }

  function deviceName() {
    var ua = navigator.userAgent || '';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/iPhone|iPod/.test(ua)) return 'iPhone';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
    if (/Windows/.test(ua)) return 'Windows PC';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/CrOS/.test(ua)) return 'Chromebook';
    return 'another device';
  }

  function device() {
    var d = ls('device');
    if (!d || !d.id) { d = { id: Math.random().toString(36).slice(2, 10), name: deviceName() }; ls('device', d); }
    return d;
  }

  function jwtPayload(token) {
    try {
      var p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(p + '==='.slice((p.length + 3) % 4)))));
    } catch (e) { return {}; }
  }

  // books added before the PARSER number existed were read by version 1
  function pv(b) { return b.parser || 1; }

  function nOf(cardId) { return String(cardId).slice(String(cardId).lastIndexOf(':') + 1); }

  function sha256(buf) {
    return crypto.subtle.digest('SHA-256', buf).then(function (h) {
      return Array.from(new Uint8Array(h), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  function save() {
    return Promise.all([A.setKv('sync:state', state), A.setKv('sync:dirty', dirty)]).catch(function () {});
  }

  function setStatus(patch) {
    for (var k in patch) status[k] = patch[k];
    if (A && A.onStatus) A.onStatus();
  }

  /* ---------- merging ---------- */

  function emptyProgress(parser) { return { parser: parser || 0, read: {}, readReset: 0, marks: {}, hidden: {}, pos: null }; }

  function mergeFlags(a, b) {
    var out = {}, k;
    for (k in a) out[k] = a[k];
    for (k in b) if (!(k in out) || Math.abs(b[k]) > Math.abs(out[k])) out[k] = b[k];
    return out;
  }

  // Two progress records of one book (same parser) -> one.
  function merge(a, b) {
    a = a || emptyProgress(); b = b || emptyProgress();
    var reset = Math.max(a.readReset || 0, b.readReset || 0), read = {}, k;
    [a.read || {}, b.read || {}].forEach(function (r) {
      for (k in r) if (r[k] > reset && !(read[k] >= r[k])) read[k] = r[k];
    });
    var pa = a.pos, pb = b.pos;
    return {
      parser: Math.max(a.parser || 0, b.parser || 0),
      read: read,
      readReset: reset,
      marks: mergeFlags(a.marks || {}, b.marks || {}),
      hidden: mergeFlags(a.hidden || {}, b.hidden || {}),
      pos: !pa ? pb || null : !pb ? pa : (pb.at > pa.at ? pb : pa)
    };
  }

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /* ---------- Supabase calls ---------- */

  function headers(token, extra) {
    var h = { apikey: cfg.key, Authorization: 'Bearer ' + (token || cfg.key) };
    for (var k in extra || {}) h[k] = extra[k];
    return h;
  }

  function fetchT(url, opts, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (ctl) opts.signal = ctl.signal;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 30000);
    return fetch(url, opts).then(function (r) { clearTimeout(t); return r; }, function (e) {
      clearTimeout(t);
      var err = new Error('offline'); err.offline = true; err.cause = e; throw err;
    });
  }

  function authError() { var e = new Error('Signed out. Switch sync off and on to sign in again.'); e.auth = true; return e; }

  function saveSession(s) {
    session = s;
    return A.setKv('sync:session', s).catch(function () {});
  }

  function refresh() {
    if (!session || !session.refresh_token) return Promise.reject(authError());
    return fetchT(base + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', headers: headers(null, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ refresh_token: session.refresh_token })
    }, 20000).then(function (r) {
      if (r.status >= 500) { var e = new Error('offline'); e.offline = true; throw e; }
      if (!r.ok) { saveSession(null); throw authError(); }
      return r.json().then(function (b) { return saveSession(sessionFrom(b.access_token, b.refresh_token, b.expires_in)); });
    });
  }

  function ensureToken() {
    if (!session) return Promise.reject(authError());
    if (session.expires_at - 60 > Date.now() / 1000) return Promise.resolve(session.access_token);
    return refresh().then(function () { return session.access_token; });
  }

  // Authenticated call; one token refresh on 401. raw=true returns the Response.
  function api(method, path, opts, retried) {
    opts = opts || {};
    return ensureToken().then(function (token) {
      var h = headers(token, opts.headers);
      var body = opts.body;
      if (body !== undefined && !(body instanceof ArrayBuffer) && !(body instanceof Blob)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
      return fetchT(base + path, { method: method, headers: h, body: body, keepalive: !!opts.keepalive }, opts.timeout || 30000);
    }).then(function (r) {
      if (r.status === 401 && !retried) return refresh().then(function () { return api(method, path, opts, true); });
      if (r.status === 401) throw authError();
      if (r.status >= 500) { var e = new Error('offline'); e.offline = true; throw e; }
      // storage answers 400/403/404 for a file that isn't there: the caller decides
      if (opts.raw) return r;
      if (!r.ok) return r.text().then(function (t) { throw new Error('Sync failed (' + r.status + '): ' + t.slice(0, 160)); });
      return r.status === 204 ? null : r.text().then(function (t) { return t ? JSON.parse(t) : null; });
    });
  }

  function upsert(table, rows, keepalive) {
    return api('POST', '/rest/v1/' + table + '?on_conflict=user_id,book_key', {
      body: rows, keepalive: keepalive, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
    });
  }

  function objectPath(key) { return BUCKET + '/' + session.user.id + '/' + key; }

  /* ---------- sign in / out ---------- */

  function sessionFrom(access, refreshTok, expiresIn) {
    var p = jwtPayload(access);
    return {
      access_token: access, refresh_token: refreshTok,
      expires_at: p.exp || Math.floor(Date.now() / 1000) + (+expiresIn || 3600),
      user: { id: p.sub, email: p.email || (p.user_metadata && p.user_metadata.email) || '' }
    };
  }

  // Back from Google: Supabase puts the tokens in the address (#access_token=…).
  function readRedirect() {
    var h = location.hash || '';
    if (!/access_token=|error_description=|error=/.test(h)) return null;
    var q = {};
    h.replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
    });
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { /* file:// */ }
    if (q.access_token) return { session: sessionFrom(q.access_token, q.refresh_token, q.expires_in) };
    return { error: q.error_description || q.error || 'Sign-in was cancelled.' };
  }

  function signIn() {
    ls('signingIn', true);
    var back = location.origin + location.pathname;
    // the whole page goes to Google and comes back: pop-ups don't work in iPhone home-screen apps
    location.assign(base + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(back));
  }

  function signOut() {
    var tok = session && session.access_token;
    setOn(false);
    if (tok) fetchT(base + '/auth/v1/logout?scope=local', { method: 'POST', headers: headers(tok) }, 8000).catch(function () {});
    state = {}; dirty = { progress: {}, books: {}, deleted: {} };
    return Promise.all([saveSession(null), save()]).then(function () { setStatus({ error: '', lastSync: 0 }); });
  }

  /* ---------- switching on and off ---------- */

  function isOn() { return !!cfg && ls('sync') === true; }

  function setOn(v) {
    if (!cfg) return;
    if (!v) {
      ls('sync', false);
      stop();
      setStatus({ busy: false, error: '' });
      return;
    }
    ls('sync', true);
    if (!session) { signIn(); return; }
    start(true);
  }

  function onVisible() { if (!document.hidden) pullSoon(); else flush(); }
  function onOnline() { pullSoon(true); }

  function start(firstTime) {
    if (!started) {
      started = true;
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('online', onOnline);
    }
    if (firstTime) seedFromApp();
    syncNow();
  }

  function stop() {
    if (!started) return;
    started = false;
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
    clearTimeout(pushTimer);
  }

  function pullSoon(force) {
    if (!isOn() || !session) return;
    if (force || Date.now() - lastPull > PULL_GAP) syncNow();
  }

  function schedulePush() {
    if (!isOn() || !session) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncNow, PUSH_DELAY);
  }

  // leaving the app: send progress now (small, so it fits a keepalive request)
  function flush() {
    if (!isOn() || !session || !Object.keys(dirty.progress).length) return;
    clearTimeout(pushTimer);
    pushProgress(true).catch(function () {});
  }

  /* ---------- recording local changes ---------- */

  function bookOfCard(cardId) {
    var b = A.bookOfCard(cardId);
    return b && b.key ? b : null;
  }

  // the book's progress here, numbered by the parser this device read it with
  function progressOf(b) {
    var p = state[b.key];
    if (!p || p.parser !== pv(b)) p = state[b.key] = emptyProgress(pv(b));
    return p;
  }

  function touch(b) { dirty.progress[b.key] = 1; save(); schedulePush(); }

  function onCard(cardId, fn) {
    if (!isOn()) return;
    var b = bookOfCard(cardId);
    if (!b) return;
    fn(progressOf(b), nOf(cardId), Date.now());
    touch(b);
  }

  // When sync is switched on: take in what is on this device. Cards never
  // synced before count as old (time 1), so a real change made on another
  // device wins; a card saved or hidden (or un-saved) while sync was off
  // counts as changed now.
  function seedFromApp() {
    var now = Date.now();
    function flags(map, set) {
      set.forEach(function (n) { if (!(map[n] > 0)) map[n] = map[n] ? now : 1; });
      Object.keys(map).forEach(function (n) { if (map[n] > 0 && set.indexOf(n) < 0) map[n] = -now; });
    }
    A.books().forEach(function (b) {
      if (!b.key) return;
      var p = progressOf(b), snap = A.progressOfBook(b.id);
      snap.read.forEach(function (n) { if (!p.read[n]) p.read[n] = 1; });
      flags(p.marks, snap.marks);
      flags(p.hidden, snap.hidden);
      dirty.progress[b.key] = 1;
    });
    save();
  }

  var api_ = {
    read: function (cardId) { onCard(cardId, function (p, n, t) { if (!p.read[n]) p.read[n] = t; }); },
    mark: function (cardId, on) { onCard(cardId, function (p, n, t) { p.marks[n] = on ? t : -t; }); },
    hide: function (cardId, on) { onCard(cardId, function (p, n, t) { p.hidden[n] = on ? t : -t; }); },
    pos: function (cardId) {
      onCard(cardId, function (p, n, t) { var d = device(); p.pos = { n: n, at: t, device: d.id, name: d.name }; });
    },
    resetRead: function () {
      if (!isOn()) return;
      var t = Date.now();
      A.books().forEach(function (b) { if (b.key) { var p = progressOf(b); p.read = {}; p.readReset = t; dirty.progress[b.key] = 1; } });
      save(); schedulePush();
    },
    bookAdded: function (b) { if (isOn() && b.key) { dirty.books[b.key] = 1; delete dirty.deleted[b.key]; save(); schedulePush(); } },
    bookChanged: function (b) { if (isOn() && b.key) { dirty.books[b.key] = 1; save(); schedulePush(); } },
    bookDeleted: function (b) {
      if (!isOn() || !b.key) return;
      dirty.deleted[b.key] = { title: b.title };
      delete dirty.books[b.key]; delete dirty.progress[b.key]; delete state[b.key];
      save(); schedulePush();
    },
    // a book read again by a newer parser: its card numbers changed
    remap: function (b, mapN) {
      if (!b.key || !state[b.key]) return;
      var p = state[b.key], q = emptyProgress(pv(b)), k;
      q.readReset = p.readReset;
      for (k in p.read) q.read[mapN(k)] = p.read[k];
      for (k in p.marks) q.marks[mapN(k)] = p.marks[k];
      for (k in p.hidden) q.hidden[mapN(k)] = p.hidden[k];
      if (p.pos) { q.pos = Object.assign({}, p.pos, { n: mapN(p.pos.n) }); }
      state[b.key] = q;
      if (isOn()) touch(b); else save();
    }
  };

  /* ---------- one sync run ---------- */

  function syncNow() {
    if (!isOn() || !session) return Promise.resolve();
    if (running) return running.then(function () { return Object.keys(dirty.progress).length ? syncNow() : null; });
    clearTimeout(pushTimer);
    setStatus({ busy: true });
    running = run().then(function () {
      lastPull = Date.now();
      setStatus({ busy: false, error: '', lastSync: Date.now() });
    }, function (e) {
      setStatus({ busy: false, error: e.auth ? e.message : e.offline ? 'Offline. Changes will sync when you are back online.' : (e.message || 'Sync failed') });
      if (e.auth) setOn(false);
    }).then(function () { running = null; return save(); });
    return running;
  }

  function run() {
    return ensureToken()
      .then(keyBooks)
      .then(pushDeletes)
      .then(syncBooks)
      .then(syncProgress);
  }

  // books added before keys existed get theirs from the stored original
  function keyBooks() {
    var need = A.books().filter(function (b) { return !b.key && b.hasFile; });
    return need.reduce(function (p, b) {
      return p.then(function () { return A.getFile(b.id); }).then(function (f) {
        if (!f || !f.data) return;
        return sha256(f.data).then(function (k) { b.key = k; dirty.books[k] = 1; return A.saveBook(b); });
      }).catch(function () {});
    }, Promise.resolve());
  }

  function pushDeletes() {
    var keys = Object.keys(dirty.deleted);
    return keys.reduce(function (p, key) {
      return p.then(function () {
        return upsert('vanchan_books', [{ user_id: session.user.id, book_key: key, title: dirty.deleted[key].title || '', deleted: true, deleted_at: Date.now() }]);
      }).then(function () {
        return api('DELETE', '/storage/v1/object/' + objectPath(key), { raw: true });
      }).then(function () {
        return api('DELETE', '/rest/v1/vanchan_progress?book_key=eq.' + key, { raw: true });
      }).then(function () { delete dirty.deleted[key]; });
    }, Promise.resolve());
  }

  function bookRow(b) {
    return {
      user_id: session.user.id, book_key: b.key, title: b.title, title_at: b.titleAt || b.added || 0,
      kind: b.kind, size: b.size || 0, file_name: b.file || '', added: b.added || Date.now(), deleted: false, deleted_at: null
    };
  }

  function upload(b) {
    return A.getFile(b.id).then(function (f) {
      if (!f || !f.data) return false;
      return api('POST', '/storage/v1/object/' + objectPath(b.key), {
        raw: true, body: f.data, timeout: 120000,
        headers: { 'Content-Type': f.type || 'application/octet-stream', 'x-upsert': 'true' }
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error('Upload failed (' + r.status + '): ' + t.slice(0, 160)); });
        return upsert('vanchan_books', [bookRow(b)]).then(function () { return true; });
      });
    });
  }

  function syncBooks() {
    return api('GET', '/rest/v1/vanchan_books?select=book_key,title,title_at,kind,size,file_name,added,deleted').then(function (rows) {
      rows = rows || [];
      var byKey = {}, local = {}, uploads = [], downloads = [], removes = [], renames = [];
      A.books().forEach(function (b) { if (b.key && !local[b.key]) local[b.key] = b; });
      rows.forEach(function (r) { byKey[r.book_key] = r; });
      rows.forEach(function (r) {
        var b = local[r.book_key];
        if (r.deleted) {
          // re-added here since it was deleted elsewhere: bring it back
          if (b && dirty.books[r.book_key]) uploads.push(b);
          else if (b) removes.push(b);
          return;
        }
        if (!b) { downloads.push(r); return; }
        if ((r.title_at || 0) > (b.titleAt || 0) && r.title !== b.title) renames.push([b, r]);
        else if (dirty.books[r.book_key]) uploads.push(b);
      });
      Object.keys(local).forEach(function (k) { if (!byKey[k]) uploads.push(local[k]); });

      var chain = Promise.resolve();
      renames.forEach(function (x) { chain = chain.then(function () { return A.renameBook(x[0].id, x[1].title, x[1].title_at); }); });
      removes.forEach(function (b) { chain = chain.then(function () { delete state[b.key]; return A.removeBook(b.id); }); });
      uploads.forEach(function (b) {
        chain = chain.then(function () {
          // a renamed book only needs its row; a new one needs its file too
          var p = byKey[b.key] && !byKey[b.key].deleted ? upsert('vanchan_books', [bookRow(b)]) : upload(b);
          return p.then(function () { delete dirty.books[b.key]; });
        });
      });
      if (downloads.length) {
        chain = chain.then(function () { return A.gettingBooks && A.gettingBooks(downloads.length); });
        downloads.forEach(function (r) {
          chain = chain.then(function () {
            return api('GET', '/storage/v1/object/authenticated/' + objectPath(r.book_key), { raw: true, timeout: 120000 }).then(function (res) {
              if (!res.ok) return null;      // file not there (yet): try again next time
              return res.arrayBuffer().then(function (data) { return A.addRemoteBook(r, data); });
            });
          });
        });
        chain = chain.then(function () { return A.gotBooks && A.gotBooks(downloads.length); });
      }
      return chain;
    });
  }

  function progressRow(key, p) {
    return { user_id: session.user.id, book_key: key, parser: p.parser, read: p.read, read_reset: p.readReset, marks: p.marks, hidden: p.hidden, pos: p.pos };
  }

  function fromRow(r) {
    return { parser: r.parser || 0, read: r.read || {}, readReset: +r.read_reset || 0, marks: r.marks || {}, hidden: r.hidden || {}, pos: r.pos || null };
  }

  function pushProgress(keepalive) {
    var rows = Object.keys(dirty.progress).filter(function (k) { return state[k]; }).map(function (k) { return progressRow(k, state[k]); });
    if (!rows.length) return Promise.resolve();
    var sent = rows.map(function (r) { return r.book_key; });
    return upsert('vanchan_progress', rows, keepalive).then(function () {
      sent.forEach(function (k) { delete dirty.progress[k]; });
      return save();
    });
  }

  function syncProgress() {
    return api('GET', '/rest/v1/vanchan_progress?select=*').then(function (rows) {
      var books = {}, changedLocal = false, me = device().id, newest = null;
      A.books().forEach(function (b) { if (b.key && !books[b.key]) books[b.key] = b; });
      (rows || []).forEach(function (r) {
        var b = books[r.book_key];
        if (!b) return;
        var remote = fromRow(r), local = state[r.book_key];
        if (remote.parser > pv(b)) return;                   // this device re-reads the book first
        var merged;
        if (remote.parser < pv(b)) merged = local && local.parser === pv(b) ? local : emptyProgress(pv(b));   // the other device catches up later
        else merged = merge(local && local.parser === remote.parser ? local : null, remote);
        merged.parser = pv(b);
        if (!local || !same(merged, local)) { state[r.book_key] = merged; changedLocal = A.applyProgress(b.id, flagsOf(merged)) || changedLocal; }
        if (!same(progressRow(r.book_key, merged), progressRow(r.book_key, remote))) dirty.progress[r.book_key] = 1;
        if (merged.pos && merged.pos.device !== me && (!newest || merged.pos.at > newest.pos.at)) newest = { book: b, pos: merged.pos };
      });
      // books that have progress here but no row there yet
      Object.keys(state).forEach(function (k) {
        if (books[k] && !(rows || []).some(function (r) { return r.book_key === k; })) dirty.progress[k] = 1;
      });
      if (changedLocal) A.progressChanged();
      offerContinue(newest);
      return pushProgress(false);
    });
  }

  function flagsOf(p) {
    var on = function (m) { return Object.keys(m).filter(function (k) { return m[k] > 0; }); };
    return { read: Object.keys(p.read), marks: on(p.marks), hidden: on(p.hidden) };
  }

  // another device read further: offer to go there (never jump by itself)
  function offerContinue(newest) {
    if (!newest) return;
    var mine = 0;
    Object.keys(state).forEach(function (k) { var p = state[k].pos; if (p && p.device === device().id && p.at > mine) mine = p.at; });
    if (newest.pos.at <= mine || newest.pos.at <= shownPos) return;
    shownPos = newest.pos.at;
    A.offerContinue(newest.book.id, newest.pos.n, newest.pos.name || 'another device');
  }

  /* ---------- start-up ---------- */

  // adapter: books(), bookOfCard(id), progressOfBook(bookId) -> {read, marks, hidden} card numbers,
  // applyProgress(bookId, {read, marks, hidden}) -> changed?, progressChanged(), getFile(id), saveBook(b),
  // addRemoteBook(row, data), removeBook(id), renameBook(id, title, at), offerContinue(bookId, n, name),
  // gettingBooks(n), gotBooks(n), getKv(k, d), setKv(k, v), onStatus(), toast(text)
  function init(adapter) {
    A = adapter;
    if (!cfg) return Promise.resolve();
    var back = readRedirect();
    return Promise.all([A.getKv('sync:session', null), A.getKv('sync:state', {}), A.getKv('sync:dirty', null)]).then(function (v) {
      session = v[0]; state = v[1] || {};
      dirty = v[2] || dirty;
      ['progress', 'books', 'deleted'].forEach(function (k) { if (!dirty[k]) dirty[k] = {}; });
      var wasSigningIn = ls('signingIn');
      ls('signingIn', null);
      if (back && back.session) {
        return saveSession(back.session).then(function () {
          ls('sync', true);
          A.toast('Sync is on · ' + (session.user.email || 'signed in'));
          start(true);
        });
      }
      if (back && back.error && wasSigningIn) {
        ls('sync', false);
        setStatus({ error: back.error });
        A.toast('Sync not switched on: ' + back.error);
        return;
      }
      if (isOn() && session) start(false);
      else if (isOn() && !session) { ls('sync', false); }
    });
  }

  root.Sync = {
    available: function () { return !!cfg; },
    isOn: isOn,
    setOn: setOn,
    signOut: signOut,
    syncNow: syncNow,
    init: init,
    sha256: sha256,
    status: function () {
      return { on: isOn(), email: session && session.user ? session.user.email : '', signedIn: !!session,
        busy: status.busy, error: status.error, lastSync: status.lastSync };
    },
    read: api_.read, mark: api_.mark, hide: api_.hide, pos: api_.pos, resetRead: api_.resetRead,
    bookAdded: api_.bookAdded, bookChanged: api_.bookChanged, bookDeleted: api_.bookDeleted, remap: api_.remap,
    _merge: merge
  };
})(this);
