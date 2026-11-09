/*
 * Small IndexedDB store. Stores:
 *   books  { id, title, author, kind, added, cover, count }
 *   cards  { id: bookId + ':' + n, b: bookId, ... }   (index "b")
 *   kv     { k, v }   reading position, read / saved / hidden cards
 *   marks  { id, b: bookId, … }   highlights, notes and pen marks (see marks.js)   (index "b")
 *   files  { id: bookId, data, type }   the original file: for showing PDF pages
 *          and for reading the book again when the app reads books better
 * Falls back to memory when IndexedDB is unavailable (private mode on some
 * browsers), so the app still works for the session.
 */
(function (root) {
  'use strict';

  var NAME = 'vanchan', VERSION = 3, db = null, mem = null;

  function req(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  function open() {
    if (db || mem) return Promise.resolve();
    return new Promise(function (resolve) {
      var r;
      try { r = indexedDB.open(NAME, VERSION); } catch (e) { mem = { books: {}, cards: {}, kv: {}, files: {}, marks: {} }; return resolve(); }
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('cards')) d.createObjectStore('cards', { keyPath: 'id' }).createIndex('b', 'b');
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' });
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('marks')) d.createObjectStore('marks', { keyPath: 'id' }).createIndex('b', 'b');
      };
      r.onsuccess = function () {
        db = r.result;
        // a newer version in another tab needs the database: step aside and reload into it
        db.onversionchange = function () { db.close(); location.reload(); };
        resolve();
      };
      // blocked: an older tab is still open; the open goes ahead once it closes
      r.onerror = function () { mem = { books: {}, cards: {}, kv: {}, files: {}, marks: {} }; resolve(); };
    });
  }

  function tx(store, mode) { return db.transaction(store, mode).objectStore(store); }

  function done(t) {
    return new Promise(function (resolve, reject) {
      t.oncomplete = function () { resolve(); };
      t.onerror = t.onabort = function () { reject(t.error || new Error('Storage failed')); };
    });
  }

  var api = {
    open: open,
    memoryOnly: function () { return !!mem; },

    all: function (store) {
      if (mem) return Promise.resolve(Object.keys(mem[store]).map(function (k) { return mem[store][k]; }));
      return req(tx(store, 'readonly').getAll());
    },

    put: function (store, value) {
      if (mem) { mem[store][value.id || value.k] = value; return Promise.resolve(); }
      return req(tx(store, 'readwrite').put(value));
    },

    getKv: function (k, fallback) {
      if (mem) return Promise.resolve(k in mem.kv ? mem.kv[k].v : fallback);
      return req(tx('kv', 'readonly').get(k)).then(function (r) { return r ? r.v : fallback; });
    },

    setKv: function (k, v) { return api.put('kv', { k: k, v: v }); },

    del: function (store, id) {
      if (mem) { delete mem[store][id]; return Promise.resolve(); }
      return req(tx(store, 'readwrite').delete(id));
    },

    // book + all its cards in one transaction
    addBook: function (book, cards) {
      if (mem) {
        mem.books[book.id] = book;
        cards.forEach(function (c) { mem.cards[c.id] = c; });
        return Promise.resolve();
      }
      var t = db.transaction(['books', 'cards'], 'readwrite');
      t.objectStore('books').put(book);
      var cs = t.objectStore('cards');
      cards.forEach(function (c) { cs.put(c); });
      return done(t);
    },

    // a book read again: its record and a new set of cards, in one transaction
    replaceCards: function (book, cards) {
      if (mem) {
        Object.keys(mem.cards).forEach(function (k) { if (mem.cards[k].b === book.id) delete mem.cards[k]; });
        return api.addBook(book, cards);
      }
      var t = db.transaction(['books', 'cards'], 'readwrite'), cs = t.objectStore('cards');
      cs.index('b').openKeyCursor(IDBKeyRange.only(book.id)).onsuccess = function (e) {
        var cur = e.target.result;
        if (cur) { cs.delete(cur.primaryKey); cur.continue(); }
        else {
          // all old cards gone: write the new ones
          t.objectStore('books').put(book);
          cards.forEach(function (c) { cs.put(c); });
        }
      };
      return done(t);
    },

    getFile: function (id) {
      if (mem) return Promise.resolve(mem.files[id] || null);
      return req(tx('files', 'readonly').get(id));
    },

    deleteBook: function (id) {
      if (mem) {
        delete mem.books[id];
        delete mem.files[id];
        Object.keys(mem.cards).forEach(function (k) { if (mem.cards[k].b === id) delete mem.cards[k]; });
        Object.keys(mem.marks).forEach(function (k) { if (mem.marks[k].b === id) delete mem.marks[k]; });
        return Promise.resolve();
      }
      var t = db.transaction(['books', 'cards', 'files', 'marks'], 'readwrite');
      t.objectStore('books').delete(id);
      t.objectStore('files').delete(id);
      ['cards', 'marks'].forEach(function (st) {
        t.objectStore(st).index('b').openKeyCursor(IDBKeyRange.only(id)).onsuccess = function (e) {
          var cur = e.target.result;
          if (cur) { t.objectStore(st).delete(cur.primaryKey); cur.continue(); }
        };
      });
      return done(t);
    }
  };

  root.DB = api;
})(this);
