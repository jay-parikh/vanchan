/* Vanchan: read books as swipeable cards. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const svg = (path) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';
  const ICON = {
    save: svg('<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z"/>'),
    share: svg('<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M6 12H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1"/>'),
    more: svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
    up: svg('<path d="m6 15 6-6 6 6"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    book: svg('<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>'),
    stack: svg('<path d="M4 8h16v12H4z"/><path d="M6 5h12M8 2h8"/>'),
    page: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'),
    toc: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>'),
    pen: svg('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
    marker: svg('<path d="m9 15 6-6 3 3-6 6H9v-3Z"/><path d="M4 21h8"/>'),
    eraser: svg('<path d="m7 21-4-4L14 6l6 6-9 9H7Z"/><path d="M11 21h9"/>'),
    undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
    scroll: svg('<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>'),
    note: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5"/>'),
    shuffle: svg('<path d="M4 7h3c4 0 6 10 10 10h3M4 17h3c1.6 0 2.8-1.6 3.9-3.6M13.1 9.6C14.2 8.1 15.3 7 17 7h3"/><path d="m18 4 3 3-3 3M18 14l3 3-3 3"/>')
  };

  /* ---------- state ---------- */

  const S = {
    books: [], bookById: {}, cards: {}, byBook: {},
    scope: 'all', order: [], pos: 0,
    read: new Set(), marks: [], hidden: new Set(),
    settings: { fs: 18, font: 'serif', theme: 'auto', order: 'random' },
    shownAt: 0, swiped: false, sheets: [], menuCard: null, busy: false,
    els: { prev: null, cur: null, next: null },
    // highlights, notes and pen marks (marks.js): all by id, and indexes
    mk: { all: {}, byCard: {}, byPage: {} }, inking: null, savedTab: 'cards'
  };

  const store = {
    get(k, d) { try { const v = localStorage.getItem('vanchan:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('vanchan:' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  /* ---------- helpers ---------- */

  function hue(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  function debounce(fn, ms) { let t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  // ms: how long it stays (default 2.6 s, 5 s with an action)
  function toast(text, action, onAction, ms) {
    const t = $('toast');
    $('toastText').textContent = text;
    const b = $('toastAction');
    b.hidden = !action;
    b.textContent = action || '';
    b.onclick = () => { t.hidden = true; if (onAction) onAction(); };
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, ms || (action ? 5000 : 2600));
  }

  function cardLabel(c) {
    if (c.t) return c.t;
    const first = (c.p[0] || '').split(' ').slice(0, 10).join(' ');
    return (c.num ? c.num + '. ' : '') + first + '…';
  }

  function cardText(c) {
    const book = S.bookById[c.b];
    const head = [c.k, c.num ? c.num + '.' : '', c.t].filter(Boolean).join(' ');
    return (head ? head + '\n\n' : '') + c.p.join('\n\n') + '\n\n— ' + (book ? book.title : '');
  }

  /* ---------- settings ---------- */

  function applySettings() {
    const r = document.documentElement;
    r.dataset.theme = S.settings.theme;
    r.dataset.font = S.settings.font;
    r.style.setProperty('--fs', S.settings.fs + 'px');
    $('fs').value = S.settings.fs;
    document.querySelectorAll('.seg[data-setting]').forEach((seg) => {
      const key = seg.dataset.setting;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.settings[key]));
    });
    const dark = S.settings.theme === 'dark' || (S.settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    const bg = getComputedStyle(r).getPropertyValue('--bg').trim();
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.setAttribute('content', bg || (dark ? '#0E0C0A' : '#F3EFE9')); m.removeAttribute('media'); });
  }

  function saveSettings() { store.set('settings', S.settings); applySettings(); }

  /* ---------- feed ---------- */

  function scopeIds(scope) {
    const books = scope === 'all' ? S.books : S.books.filter((b) => b.id === scope);
    const ids = [];
    // the book's printed index is for reading in book order, not a random card
    const random = S.settings.order !== 'book';
    books.forEach((b) => (S.byBook[b.id] || []).forEach((c) => { if (!S.hidden.has(c.id) && !(random && c.kind === 'index')) ids.push(c.id); }));
    return ids;
  }

  // Random order shuffles whole sections, keeping the parts of a long
  // section together and in order. Unread sections come first.
  function makeOrder(ids, mode) {
    if (mode === 'book') {
      const rank = {};
      S.books.slice().sort((a, b) => a.added - b.added).forEach((b, i) => { rank[b.id] = i; });
      return ids.slice().sort((a, b) => {
        const x = S.cards[a], y = S.cards[b];
        return rank[x.b] - rank[y.b] || x.n - y.n;
      });
    }
    const groups = {}, keys = [];
    ids.forEach((id) => {
      const c = S.cards[id], k = c.b + '|' + c.g;
      if (!groups[k]) { groups[k] = []; keys.push(k); }
      groups[k].push(id);
    });
    keys.forEach((k) => groups[k].sort((a, b) => S.cards[a].n - S.cards[b].n));
    const unread = [], read = [];
    keys.forEach((k) => (groups[k].some((id) => !S.read.has(id)) ? unread : read).push(k));
    const out = [];
    shuffle(unread).concat(shuffle(read)).forEach((k) => groups[k].forEach((id) => out.push(id)));
    return out;
  }

  function feedKey() { return 'feed:' + S.scope + ':' + S.settings.order; }

  async function loadFeed(keepId) {
    const ids = scopeIds(S.scope), valid = new Set(ids);
    const saved = await DB.getKv(feedKey(), null);
    if (saved && saved.order) {
      const cur = saved.order[saved.pos];
      let order = saved.order.filter((id) => valid.has(id));
      let pos = cur && valid.has(cur) ? order.indexOf(cur) : Math.min(saved.pos, order.length);
      const have = new Set(order), missing = ids.filter((id) => !have.has(id));
      if (missing.length) {
        if (S.settings.order === 'book') {
          const curId = order[pos];
          order = makeOrder(ids, 'book');
          pos = curId ? order.indexOf(curId) : 0;
        } else {
          // new cards (a newly added book) go to random places ahead of the reader
          makeOrder(missing, 'random').forEach((id) => {
            const at = pos + 1 + Math.floor(Math.random() * (order.length - pos));
            order.splice(Math.min(at, order.length), 0, id);
          });
        }
      }
      S.order = order; S.pos = Math.max(0, pos);
    } else {
      S.order = makeOrder(ids, S.settings.order);
      S.pos = 0;
    }
    if (keepId) {
      const i = S.order.indexOf(keepId);
      if (i >= 0) S.pos = i;
    }
    saveFeedNow();
  }

  function saveFeedNow() { return DB.setKv(feedKey(), { order: S.order, pos: S.pos }).catch(() => {}); }
  const saveFeed = debounce(saveFeedNow, 400);
  const saveSets = debounce(() => {
    DB.setKv('read', Array.from(S.read)).catch(() => {});
    DB.setKv('hidden', Array.from(S.hidden)).catch(() => {});
    DB.setKv('marks', S.marks).catch(() => {});
  }, 400);

  function currentId() { return S.order[S.pos]; }

  function markCurrentRead() {
    const id = currentId();
    if (id && Date.now() - S.shownAt > 1500 && !S.read.has(id)) { S.read.add(id); saveSets(); Sync.read(id); }
  }

  /* ---------- card rendering ---------- */

  function buildCard(id, index) {
    const c = S.cards[id], book = S.bookById[c.b];
    // a short card (one saying) is set larger and centred, like a quote
    const card = el('article', 'card' + (c.w <= 60 && c.kind !== 'index' ? ' short' : ''));
    card.dataset.id = id;

    const band = el('div', 'band');
    band.style.setProperty('--hue', hue(book.id));
    band.setAttribute('role', 'button');
    band.setAttribute('aria-label', 'Contents of ' + book.title);
    band.onclick = (e) => { e.stopPropagation(); openToc(book.id, id); };
    if (book.cover) {
      const bg = el('div', 'band-bg');
      bg.style.backgroundImage = 'url("' + book.cover + '")';
      band.appendChild(bg);
    }
    const bt = el('div', 'band-text');
    if (book.cover) {
      const img = el('img', 'band-cover');
      img.src = book.cover; img.alt = '';
      bt.appendChild(img);
    }
    const words = el('div', 'band-words');
    words.appendChild(el('div', 'band-book', book.title));
    if (c.ch && c.ch !== c.t) {
      const ch = el('div', 'band-ch', c.ch);
      ch.lang = 'gu';
      words.appendChild(ch);
    }
    bt.appendChild(words);
    band.appendChild(bt);
    card.appendChild(band);

    const body = el('div', 'body');
    body.lang = 'gu';
    const where = pageText(c, book);
    if (c.k || c.part || where) {
      const k = el('div', 'kicker');
      if (c.k) k.appendChild(el('span', 'gu-k', c.k));
      if (c.part) k.appendChild(el('span', '', 'Part ' + c.part[0] + ' of ' + c.part[1]));
      if (where) {
        // PDF books open the page itself; EPUB books just say where it is
        const canOpen = book.hasFile && c.pg;
        const chip = el(canOpen ? 'button' : 'span', 'page-chip', where);
        if (canOpen) {
          chip.innerHTML = ICON.page;
          chip.appendChild(document.createTextNode(where));
          chip.setAttribute('aria-label', where + ', open in book');
          chip.onclick = (e) => { e.stopPropagation(); openViewer(book.id, c.pg, c.pe); };
        }
        k.appendChild(chip);
      }
      body.appendChild(k);
    }
    if (c.num) body.appendChild(el('div', 'num', c.num));
    if (c.t) body.appendChild(el('h2', 'title', c.t));
    if (c.kind === 'index') body.appendChild(indexList(c, book));
    const text = el('div', 'text');
    c.p.forEach((p, i) => {
      const para = el('p', i === 0 && c.lead ? 'lead' : '');
      para.dataset.i = i;
      const sp = Cards.splitSpeaker(p);
      if (sp) {
        para.appendChild(el('b', '', sp.who + ' :'));
        para.appendChild(document.createTextNode(' ' + sp.rest));
      } else para.textContent = p;
      text.appendChild(para);
    });
    body.appendChild(text);
    drawTextMarks(id, text);
    const cardNote = marksOfCard(id).find((m) => m.type === 'cardnote');
    if (cardNote) body.appendChild(noteStrip(cardNote));
    body.appendChild(el('div', 'body-end'));
    if (S.hl && S.hl.id === id) markWords(body, S.hl.words);
    card.appendChild(body);
    // pen marks over the card: the card keeps the layout they were drawn at
    const ink = marksOfCard(id).find((m) => m.type === 'ink-card');
    const inking = S.inking && S.inking.id === id;
    if (ink || inking) lockLayout(card, body, inking ? S.inking.layout : ink.layout);

    if (inking) { card.classList.add('inking'); card.appendChild(penBar(S.inking, () => exitPen())); return card; }

    const foot = el('footer', 'foot');
    const pos = el('span', 'pos');
    if (!S.swiped && index === 0) {
      pos.className = 'pos hint-next';
      pos.innerHTML = ICON.up;
      pos.appendChild(document.createTextNode(' Swipe up for the next card'));
    } else pos.textContent = (index + 1) + ' / ' + S.order.length;
    foot.appendChild(pos);
    const saved = S.marks.indexOf(id) >= 0;
    if (S.settings.order === 'book') foot.appendChild(iconButton(ICON.shuffle, 'Back to random cards', backToRandom));
    if (c.kind !== 'index') foot.appendChild(iconButton(ICON.pen, 'Pen', () => enterPen(id), 'pen'));
    foot.appendChild(iconButton(ICON.save, saved ? 'Remove from saved' : 'Save card', () => toggleMark(id), saved ? 'save on' : 'save'));
    foot.appendChild(iconButton(ICON.share, 'Share', () => shareCard(id)));
    foot.appendChild(iconButton(ICON.more, 'More', () => openMenu(id)));
    card.appendChild(foot);
    return card;
  }

  /* ---------- marks: highlights, notes, pen ---------- */

  const PEN_COLORS = ['#1E1A16', '#2F6FD6', '#C8382B'];
  const lastColor = () => store.get('hlColor', 'yellow');
  const penColor = () => store.get('penColor', '#2F6FD6');

  function indexMarks() {
    const byCard = {}, byPage = {};
    Object.keys(S.mk.all).forEach((k) => {
      const m = S.mk.all[k];
      if (m.del || m.lost || !S.bookById[m.b]) return;
      if (m.type === 'ink-page') (byPage[m.b] = byPage[m.b] || {})[m.pg] = m;
      else (byCard[m.b + ':' + m.n] = byCard[m.b + ':' + m.n] || []).push(m);
    });
    S.mk.byCard = byCard; S.mk.byPage = byPage;
  }

  const marksOfCard = (id) => S.mk.byCard[id] || [];

  function saveMark(m) {
    m.at = Date.now();
    S.mk.all[m.id] = m;
    indexMarks();
    DB.put('marks', m).catch(() => toast('Could not save'));
    Sync.markChanged(m);
  }

  // kept as "deleted", so the deletion reaches other devices
  function removeMark(m) {
    m.del = true;
    delete m.note; delete m.strokes;
    saveMark(m);
  }

  function newMark(type, bookId, extra) {
    const b = S.bookById[bookId];
    return Object.assign({ id: Marks.newId(), b: bookId, key: b && b.key, type }, extra);
  }

  const groupOf = (m) => (m.grp ? Object.keys(S.mk.all).map((k) => S.mk.all[k]).filter((x) => x.grp === m.grp && !x.del) : [m]);

  // highlights and underlines into a card's paragraphs
  function drawTextMarks(cardId, textEl) {
    const marks = marksOfCard(cardId).filter((m) => m.type === 'text');
    if (!marks.length) return;
    textEl.querySelectorAll('p').forEach((para) => {
      const i = +para.dataset.i, len = para.textContent.length;
      const here = marks.filter((m) => m.p === i && m.e <= len && m.s < m.e).sort((a, b) => a.s - b.s);
      const ranges = [];
      let end = -1;
      here.forEach((m) => {
        if (m.s < end) return;      // overlapping: the first one shows
        end = m.e;
        ranges.push({ s: m.s, e: m.e, make: () => {
          const sp = el('span', 'hl' + (m.color ? ' hl-' + m.color : '') + (m.ul ? ' ul' : ''));
          sp.dataset.mark = m.id;
          return sp;
        } });
      });
      Marks.wrapRanges(para, ranges);
      // a small note button after the last piece of a mark that has a note
      here.forEach((m) => {
        const g = groupOf(m), noted = g.find((x) => x.note);
        if (!noted || m !== g[g.length - 1]) return;
        const parts = para.querySelectorAll('[data-mark="' + m.id + '"]');
        if (!parts.length) return;
        const b = el('button', 'note-dot');
        b.innerHTML = ICON.pen;
        b.setAttribute('aria-label', 'Read note');
        b.onclick = (e) => { e.stopPropagation(); openNote({ mark: noted }); };
        parts[parts.length - 1].after(b);
      });
    });
  }

  function noteStrip(m) {
    const b = el('button', 'card-note');
    b.innerHTML = ICON.note;
    const words = el('span', 'card-note-words');
    words.appendChild(el('span', 'card-note-label', 'My note on this card'));
    if (m.note && m.note.text) words.appendChild(el('span', 'card-note-text', m.note.text));
    if (m.note && m.note.ink && m.note.ink.length) {
      const img = el('img', 'card-note-ink');
      img.alt = 'Hand-written note';
      img.src = Ink.thumbnail(m.note.ink, m.note.aspect || 0.8, 240);
      // the card grew: draw its pen layer to the new height
      img.onload = () => { const card = img.closest('.card'); if (card && !(S.inking && S.inking.id === card.dataset.id)) fitLock(card); };
      words.appendChild(img);
    }
    b.appendChild(words);
    b.onclick = (e) => { e.stopPropagation(); openNote({ mark: m }); };
    return b;
  }

  /* ---------- pen on a card ---------- */

  // A card with pen marks shows at the text size, font and width they were
  // drawn at (scaled to fit), so the marks stay on their words.
  function lockLayout(card, body, layout) {
    const lock = el('div', 'lock');
    while (body.firstChild) lock.appendChild(body.firstChild);
    body.appendChild(lock);
    lock.style.setProperty('--fs', layout.fs + 'px');
    lock.style.setProperty('--read-font', layout.font === 'sans' ? 'var(--gu-sans)' : 'var(--gu-serif)');
    lock.style.width = layout.w + 'px';
    lock.dataset.w = layout.w;
    const cv = el('canvas', 'ink-layer');
    cv.setAttribute('aria-hidden', 'true');
    lock.appendChild(cv);
    card.classList.add('locked');
  }

  // after the card is on the page: scale the locked layout to the card, then draw its pen marks
  function fitLock(card) {
    const lock = card.querySelector('.lock');
    if (!lock) return;
    const body = card.querySelector('.body');
    const cs = getComputedStyle(body);
    const avail = body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const w = +lock.dataset.w;
    // shrinks to fit a narrower card; on a wider one it keeps (about) its drawn size
    lock.style.zoom = avail > 0 && w > 0 ? String(Math.min(1.15, avail / w)) : '1';
    const ink = marksOfCard(card.dataset.id).find((m) => m.type === 'ink-card');
    const strokes = S.inking && S.inking.id === card.dataset.id ? null : (ink ? ink.strokes : []);
    if (strokes) Ink.paint(lock.querySelector('.ink-layer'), strokes, w, lock.scrollHeight);
  }

  function enterPen(id) {
    const card = S.els.cur;
    if (!card || card.dataset.id !== id) return;
    const ink = marksOfCard(id).find((m) => m.type === 'ink-card');
    let layout = ink && ink.layout;
    if (!layout) {
      const body = card.querySelector('.body'), cs = getComputedStyle(body);
      layout = { fs: S.settings.fs, font: S.settings.font, w: Math.round(body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) };
    }
    S.inking = { id, layout, tool: { t: 'p', c: penColor() }, mark: ink || null };
    hideBars();
    render();
    penHint();
  }

  function startCardPen(card) {
    const lock = card.querySelector('.lock'), cv = lock && lock.querySelector('.ink-layer');
    if (!cv) return;
    const body = card.querySelector('.body');
    const ink = S.inking.mark;
    cv.classList.add('live');
    const surf = Ink.surface(cv, {
      strokes: ink ? ink.strokes : [],
      size: () => [S.inking.layout.w, lock.scrollHeight],
      tool: () => S.inking.tool,
      onScroll: (dy) => { body.scrollTop += dy; },
      onChange: (strokes) => {
        let m = S.inking.mark;
        if (!strokes.length) { if (m) removeMark(m); S.inking.mark = null; return; }
        if (!m || m.del) m = S.inking.mark = newMark('ink-card', S.cards[S.inking.id].b, { n: S.cards[S.inking.id].n, layout: S.inking.layout });
        m.strokes = strokes;
        saveMark(m);
        updatePenBar();
      }
    });
    S.inking.surface = surf;
    updatePenBar();
  }

  // on touch screens: how to move the page while the pen is on (shown the first few times)
  function penHint() {
    const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    const n = store.get('penHints', 0);
    if (!touch || n >= 3) return;
    store.set('penHints', n + 1);
    toast('One finger draws · scroll with two fingers, or tap Scroll', null, null, 4500);
  }

  function exitPen() {
    if (S.inking && S.inking.surface) S.inking.surface.destroy();
    S.inking = null;
    render();
  }

  // Pen · Highlight · Eraser · Undo · Done; tap Pen again for its colours
  function penBar(state, done) {
    const bar = el('div', 'pen-bar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Pen tools');
    const tool = (name, icon, label, pick) => {
      const b = el('button', 'pen-tool');
      b.dataset.tool = name;
      b.innerHTML = icon;
      b.appendChild(el('span', '', label));
      b.setAttribute('aria-label', label);
      b.onclick = (e) => { e.stopPropagation(); pick(b); };
      return b;
    };
    const pop = el('div', 'pen-colors');
    pop.hidden = true;
    PEN_COLORS.forEach((c) => {
      const d = el('button', 'pen-color');
      d.style.setProperty('--c', c);
      d.setAttribute('aria-label', 'Pen colour');
      d.dataset.c = c;
      d.onclick = (e) => { e.stopPropagation(); state.tool = { t: 'p', c }; store.set('penColor', c); pop.hidden = true; updatePenBar(); };
      pop.appendChild(d);
    });
    bar.appendChild(pop);
    bar.appendChild(tool('p', ICON.pen, 'Pen', () => {
      if (state.tool.t === 'p') pop.hidden = !pop.hidden;
      else { state.tool = { t: 'p', c: penColor() }; pop.hidden = true; }
      updatePenBar();
    }));
    bar.appendChild(tool('h', ICON.marker, 'Highlight', () => { state.tool = { t: 'h' }; pop.hidden = true; updatePenBar(); }));
    bar.appendChild(tool('e', ICON.eraser, 'Eraser', () => { state.tool = { t: 'e' }; pop.hidden = true; updatePenBar(); }));
    bar.appendChild(tool('s', ICON.scroll, 'Scroll', () => { state.tool = { t: 's' }; pop.hidden = true; updatePenBar(); }));
    bar.appendChild(tool('u', ICON.undo, 'Undo', () => { if (state.surface) state.surface.undo(); updatePenBar(); }));
    const d = el('button', 'primary pen-done', 'Done');
    d.onclick = (e) => { e.stopPropagation(); done(); };
    bar.appendChild(d);
    return bar;
  }

  function updatePenBar() {
    document.querySelectorAll('.pen-bar').forEach((bar) => {
      const st = bar.closest('.viewer') ? V.pen : S.inking;
      if (!st) return;
      bar.querySelectorAll('.pen-tool').forEach((b) => {
        const t = b.dataset.tool;
        b.classList.toggle('on', t === st.tool.t);
        if (t === 'p') b.style.color = st.tool.t === 'p' ? st.tool.c : '';
        if (t === 'u') b.disabled = !(st.surface && st.surface.canUndo());
      });
      bar.querySelectorAll('.pen-color').forEach((d) => d.classList.toggle('on', d.dataset.c === penColor()));
    });
    const cardLayer = S.inking && S.els.cur && S.els.cur.querySelector('.ink-layer.live');
    if (cardLayer) cardLayer.classList.toggle('scrolling', S.inking.tool.t === 's');
    const pageLayer = $('vInk');
    if (pageLayer) pageLayer.classList.toggle('scrolling', !!(V.pen && V.pen.tool.t === 's'));
  }

  /* ---------- selecting words ---------- */

  function hasSelection() {
    const sel = window.getSelection && window.getSelection();
    return !!(sel && !sel.isCollapsed && sel.rangeCount && S.els.cur && S.els.cur.contains(sel.anchorNode));
  }

  function hideBars() {
    const a = $('selBar'), b = $('markBar');
    if (a) a.hidden = true;
    if (b) b.hidden = true;
    S.editing = null;
  }

  function placeBar(bar, rect) {
    bar.hidden = false;
    const w = bar.offsetWidth, h = bar.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let top = rect.bottom + 10;
    if (top + h > vh - 8) top = Math.max(8, rect.top - h - 10);
    bar.style.top = top + 'px';
    bar.style.left = Math.max(8, Math.min(vw - w - 8, rect.left + rect.width / 2 - w / 2)) + 'px';
  }

  // the paragraphs a selection covers, with offsets in each one's text
  function selectionParts() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !S.els.cur) return null;
    const range = sel.getRangeAt(0), text = S.els.cur.querySelector('.text');
    if (!text || !text.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== text) return null;
    const paras = Array.from(text.querySelectorAll('p')).filter((p) => range.intersectsNode(p));
    const parts = [];
    paras.forEach((p) => {
      const t = p.textContent;
      let s = p.contains(range.startContainer) ? Marks.offsetIn(p, range.startContainer, range.startOffset) : 0;
      let e = p.contains(range.endContainer) ? Marks.offsetIn(p, range.endContainer, range.endOffset) : t.length;
      while (s < e && /\s/.test(t[s])) s++;
      while (e > s && /\s/.test(t[e - 1])) e--;
      if (e > s) parts.push({ p: +p.dataset.i, s, e, text: t });
    });
    return parts.length ? parts : null;
  }

  function onSelection() {
    if (S.inking || S.editing) return;
    const bar = $('selBar');
    if (!hasSelection() || !selectionParts()) { bar.hidden = true; return; }
    $('selDot').style.background = Marks.DOTS[lastColor()];
    placeBar(bar, window.getSelection().getRangeAt(0).getBoundingClientRect());
  }

  // makes marks of the selected words; overlapping marks are taken in (their note kept)
  function markSelection(color) {
    const parts = selectionParts();
    if (!parts) return null;
    const id = S.els.cur.dataset.id, c = S.cards[id];
    const grp = parts.length > 1 ? Marks.newId() : null;
    let keptNote = null;
    const made = parts.map((pt) => {
      let s = pt.s, e = pt.e;
      marksOfCard(id).filter((m) => m.type === 'text' && m.p === pt.p && m.s < e && m.e > s).forEach((m) => {
        s = Math.min(s, m.s); e = Math.max(e, m.e);
        if (m.note && !keptNote) keptNote = m.note;
        removeMark(m);
      });
      return newMark('text', c.b, Object.assign({ n: c.n, p: pt.p, s, e, color, ul: false }, Marks.context(pt.text, s, e), grp ? { grp } : {}));
    });
    if (keptNote) made[made.length - 1].note = keptNote;
    made.forEach(saveMark);
    window.getSelection().removeAllRanges();
    hideBars();
    render();
    return made[made.length - 1];
  }

  // tapping a highlight: colours, underline, note, remove
  function editMark(m, rect) {
    window.getSelection().removeAllRanges();
    $('selBar').hidden = true;
    S.editing = m;
    const bar = $('markBar');
    bar.querySelectorAll('.mb-color').forEach((d) => d.classList.toggle('on', d.dataset.c === m.color));
    $('mbUnder').classList.toggle('on', !!m.ul);
    placeBar(bar, rect);
  }

  function changeGroup(m, fn) {
    groupOf(m).forEach((x) => { fn(x); saveMark(x); });
    hideBars();
    render();
  }

  function setupMarking() {
    document.addEventListener('selectionchange', debounce(onSelection, 150));
    $('selHighlight').onclick = () => markSelection(lastColor());
    $('selNote').onclick = () => { const m = markSelection(lastColor()); if (m) openNote({ mark: m }); };
    $('markBar').querySelectorAll('.mb-color').forEach((d) => {
      d.onclick = () => {
        const m = S.editing;
        if (!m) return;
        const c = d.dataset.c;
        store.set('hlColor', c);
        // the colour it already has, with an underline: underline only
        changeGroup(m, (x) => { x.color = x.color === c && x.ul ? null : c; });
      };
    });
    $('mbUnder').onclick = () => {
      const m = S.editing;
      if (!m) return;
      if (m.ul && !m.color) changeGroup(m, (x) => { x.ul = false; x.del = true; });
      else changeGroup(m, (x) => { x.ul = !x.ul; });
    };
    $('mbNote').onclick = () => { const m = S.editing; hideBars(); if (m) openNote({ mark: groupOf(m).find((x) => x.note) || groupOf(m).slice(-1)[0] }); };
    $('mbRemove').onclick = () => { const m = S.editing; if (m) { groupOf(m).forEach(removeMark); hideBars(); render(); toast('Highlight removed'); } };
    // a tap on a highlight opens its bar; a tap elsewhere closes the bars
    $('stack').addEventListener('click', (e) => {
      const sp = e.target.closest && e.target.closest('.hl');
      if (sp && !hasSelection() && !S.inking) {
        const m = S.mk.all[sp.dataset.mark];
        if (m) { e.stopPropagation(); editMark(m, sp.getBoundingClientRect()); return; }
      }
      if (!e.target.closest('#markBar')) { $('markBar').hidden = true; S.editing = null; }
    });
    document.addEventListener('scroll', () => hideBars(), true);
    setupNoteSheet();
    setupPagePen();
  }

  /* ---------- the note sheet: type it or write it by hand ---------- */

  const NOTE = { target: null, mode: 'type', surface: null, ink: [] };

  // target: { mark } (words or a card note) or { cardId } (new card note)
  function openNote(target) {
    let m = target.mark;
    if (!m && target.cardId) m = marksOfCard(target.cardId).find((x) => x.type === 'cardnote');
    const cardId = m ? m.b + ':' + m.n : target.cardId, c = S.cards[cardId], book = c && S.bookById[c.b];
    NOTE.target = { mark: m || null, cardId };
    const note = (m && m.note) || {};
    $('noteQuote').textContent = m && m.type === 'text'
      ? '“' + groupOf(m).map((x) => x.q).join(' … ') + '”' + (book ? ' · ' + pageText(c, book) : '')
      : (c ? (c.t || cardLabel(c)) + ' · ' + (book ? book.title : '') : '');
    $('noteBar').style.background = m && m.type === 'text' && m.color ? Marks.DOTS[m.color] : 'var(--line)';
    $('noteText').value = note.text || '';
    NOTE.ink = note.ink || [];
    NOTE.mode = note.ink && note.ink.length && !note.text ? 'write' : note.text ? 'type' : store.get('noteMode', 'type');
    $('noteDelete').hidden = !(m && (m.note || m.type === 'cardnote'));
    openSheet('sheetNote');
    showNoteMode();
  }

  function showNoteMode() {
    const w = NOTE.mode === 'write';
    $('noteTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === NOTE.mode));
    $('noteText').hidden = w;
    $('notePad').hidden = !w;
    $('noteTools').hidden = !w;
    if (NOTE.surface) { NOTE.ink = NOTE.surface.strokes(); NOTE.surface.destroy(); NOTE.surface = null; }
    if (w) {
      const pad = $('notePad'), cv = $('noteInk');
      NOTE.tool = NOTE.tool && NOTE.tool.t === 'e' ? NOTE.tool : { t: 'p', c: penColor() };
      requestAnimationFrame(() => {
        NOTE.surface = Ink.surface(cv, {
          strokes: NOTE.ink,
          size: () => [pad.clientWidth, pad.clientHeight],
          tool: () => NOTE.tool,
          onChange: (strokes) => { NOTE.ink = strokes; noteTools(); }
        });
        noteTools();
      });
    }
  }

  function noteTools() {
    $('notePen').classList.toggle('on', NOTE.tool.t === 'p');
    $('noteEraser').classList.toggle('on', NOTE.tool.t === 'e');
    $('noteUndo').disabled = !(NOTE.surface && NOTE.surface.canUndo());
  }

  function saveNote() {
    if (NOTE.surface) NOTE.ink = NOTE.surface.strokes();
    const text = $('noteText').value.trim(), pad = $('notePad');
    const note = {};
    if (text) note.text = text;
    if (NOTE.ink.length) { note.ink = NOTE.ink; note.aspect = pad.clientHeight / (pad.clientWidth || 1) || 0.8; }
    const t = NOTE.target;
    let m = t.mark;
    const empty = !note.text && !note.ink;
    if (!m) {
      if (empty) return;
      const c = S.cards[t.cardId];
      m = newMark('cardnote', c.b, { n: c.n });
    }
    if (empty) { if (m.type === 'cardnote') removeMark(m); else { delete m.note; saveMark(m); } }
    else { m.note = note; saveMark(m); }
  }

  function setupNoteSheet() {
    $('noteTabs').querySelectorAll('button').forEach((b) => {
      b.onclick = () => { NOTE.mode = b.dataset.v; store.set('noteMode', NOTE.mode); showNoteMode(); };
    });
    $('notePen').onclick = () => { NOTE.tool = { t: 'p', c: penColor() }; noteTools(); };
    $('noteEraser').onclick = () => { NOTE.tool = { t: 'e' }; noteTools(); };
    $('noteUndo').onclick = () => { if (NOTE.surface) NOTE.surface.undo(); noteTools(); };
    $('noteSave').onclick = () => { saveNote(); closeNote(); };
    $('noteDelete').onclick = () => {
      if (!confirm('Delete this note?')) return;
      $('noteText').value = ''; NOTE.ink = []; if (NOTE.surface) { NOTE.surface.destroy(); NOTE.surface = null; }
      saveNote(); closeNote(); toast('Note deleted');
    };
  }

  function closeNote() {
    if (NOTE.surface) { NOTE.surface.destroy(); NOTE.surface = null; }
    closeSheet();
    render();
  }

  /* ---------- pen on a PDF page ---------- */

  function pageMark(bookId, pg) { return (S.mk.byPage[bookId] || {})[pg] || null; }

  // the pen layer over the page: shows its marks, and takes the pen while drawing
  function paintPage() {
    const cv = $('vCanvas'), ink = $('vInk');
    if (!cv || cv.hidden) { ink.hidden = true; return; }
    const w = parseFloat(cv.style.width) || cv.clientWidth, h = cv.clientHeight || (cv.height / cv.width) * w;
    ink.hidden = false;
    if (V.pen && V.pen.surface) V.pen.surface.destroy();
    const m = pageMark(V.book, V.page);
    if (V.pen) {
      V.pen.surface = Ink.surface(ink, {
        strokes: m ? m.strokes : [],
        size: () => [w, h],
        tool: () => V.pen.tool,
        onScroll: (dy, dx) => { const b = $('vBody'); b.scrollTop += dy; b.scrollLeft += dx; },
        onChange: (strokes) => {
          let pm = pageMark(V.book, V.page);
          if (!strokes.length) { if (pm) removeMark(pm); return; }
          if (!pm) pm = newMark('ink-page', V.book, { pg: V.page });
          pm.strokes = strokes;
          saveMark(pm);
          updatePenBar();
        }
      });
      ink.classList.add('live');
      updatePenBar();
    } else {
      ink.classList.remove('live');
      ink.style.touchAction = '';
      Ink.paint(ink, m ? m.strokes : [], w, h);
    }
  }

  function setupPagePen() {
    const bar = penBar({ get tool() { return V.pen ? V.pen.tool : { t: 'p' }; }, set tool(t) { if (V.pen) V.pen.tool = t; }, get surface() { return V.pen && V.pen.surface; } }, () => togglePagePen(false));
    bar.id = 'vPenBar';
    bar.hidden = true;
    $('viewer').appendChild(bar);
    $('vPen').onclick = () => togglePagePen(!V.pen);
  }

  function togglePagePen(on) {
    if (V.pen && V.pen.surface) V.pen.surface.destroy();
    V.pen = on ? { tool: { t: 'p', c: penColor() } } : null;
    $('vPen').classList.toggle('on', !!on);
    $('vPenBar').hidden = !on;
    paintPage();
    if (on) penHint();
  }

  /* ---------- after a book is read again: marks follow their words ---------- */

  function remapMarks(b, moveN, recs) {
    const byN = {};
    recs.forEach((c) => { byN[c.n] = c; });
    Object.keys(S.mk.all).map((k) => S.mk.all[k]).filter((m) => m.b === b.id && !m.del && m.type !== 'ink-page').forEach((m) => {
      const n = +moveN(m.n);
      if (m.type === 'text') {
        const again = Marks.reanchor(m, byN[n], Cards.splitSpeaker);
        if (again) Object.assign(m, again); else m.lost = true;   // still listed, with its words
      } else m.n = n;
      m.at = Date.now();
      DB.put('marks', m).catch(() => {});
      Sync.markChanged(m);
    });
    indexMarks();
  }

  /* ---------- the book's printed index ---------- */

  function indexList(c, book) {
    const box = el('div', 'index');
    (c.idx || []).forEach((sec) => {
      if (sec.h) box.appendChild(el('h3', 'index-h', sec.h));
      sec.e.forEach((e) => {
        const b = el('button', 'index-e');
        b.appendChild(el('span', 'index-t', e.t));
        if (e.p) b.appendChild(el('span', 'index-p', e.p));
        b.onclick = (ev) => { ev.stopPropagation(); openIndexEntry(book, e); };
        box.appendChild(b);
      });
    });
    return box;
  }

  function openIndexEntry(book, e) {
    const c = Cards.indexTarget(S.byBook[book.id] || [], book.labels, e);
    if (!c) { toast('“' + e.t + '” is not among the cards'); return; }
    readInOrder(c.id);
  }

  function buildEnd() {
    const card = el('article', 'card end');
    const body = el('div', 'body');
    const n = S.order.length;
    body.appendChild(el('h2', '', n ? 'You have read every card' : 'No cards here'));
    body.appendChild(el('p', '', n ? n + ' cards. Start again for a fresh order.' : 'Add a book from the library.'));
    const b = el('button', 'primary', n ? (S.settings.order === 'random' ? 'Shuffle and start again' : 'Start again') : 'Open library');
    b.onclick = () => {
      if (!n) return openSheet('sheetLib');
      S.order = makeOrder(scopeIds(S.scope), S.settings.order);
      S.pos = 0; saveFeedNow(); render();
    };
    body.appendChild(b);
    card.appendChild(body);
    return card;
  }

  // "Page ૨૭", "Pages ૨૭–૨૮", or "PDF page 31" where the book prints no number
  function pageText(c, book) {
    let a, b, pdf = false;
    if (c.pg) {
      const L = book.labels || [];
      a = L[c.pg - 1]; b = L[c.pe - 1];
      if (!a) { a = String(c.pg); b = String(c.pe || c.pg); pdf = true; }
    } else if (c.lb) { a = c.lb; b = c.le; }
    else return '';
    const many = b && b !== a;
    return (pdf ? 'PDF page' : 'Page') + (many ? 's ' + a + '–' + b : ' ' + a);
  }

  function iconButton(icon, label, fn, cls) {
    const b = el('button', 'icon-btn' + (cls ? ' ' + cls : ''));
    b.innerHTML = icon;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.onclick = (e) => { e.stopPropagation(); fn(); };
    return b;
  }

  function render() {
    // drawing ends when its card is no longer the one shown (another book, a jump)
    if (S.inking && S.order[S.pos] !== S.inking.id) { if (S.inking.surface) S.inking.surface.destroy(); S.inking = null; }
    // the same card drawn again (pen on/off, a highlight, a note): keep its place in the text
    const was = S.els.cur && S.els.cur.dataset.id, wasBody = S.els.cur && S.els.cur.querySelector('.body');
    const keepTop = was && was === S.order[S.pos] && wasBody ? wasBody.scrollTop : null;
    const stack = $('stack');
    stack.textContent = '';
    S.els = { prev: null, cur: null, next: null };
    const hasBooks = S.books.length > 0;
    $('welcome').hidden = hasBooks;
    $('navBtns').hidden = !hasBooks;
    stack.hidden = !hasBooks;
    $('scopeName').textContent = !hasBooks ? 'Vanchan' : S.scope === 'all' ? 'All books' : (S.bookById[S.scope] || {}).title || 'Book';
    if (!hasBooks) return;
    const n = S.order.length;
    if (S.pos > n) S.pos = n;
    const make = (i) => (i < n ? buildCard(S.order[i], i) : buildEnd());
    S.els.cur = make(S.pos);
    if (S.pos < n) S.els.next = make(S.pos + 1);
    if (S.pos > 0) S.els.prev = make(S.pos - 1);
    if (S.els.next) { S.els.next.classList.add('under'); rest(S.els.next, 'next'); stack.appendChild(S.els.next); }
    stack.appendChild(S.els.cur);
    if (S.els.prev) { S.els.prev.classList.add('under'); rest(S.els.prev, 'prev'); stack.appendChild(S.els.prev); }
    S.shownAt = Date.now();
    hideBars();
    renderSides();     // first: the side panels change the card's width
    [S.els.prev, S.els.cur, S.els.next].forEach((c) => { if (c) fitLock(c); });
    if (keepTop !== null && S.els.cur) { const b = S.els.cur.querySelector('.body'); if (b) b.scrollTop = keepTop; }
    if (S.inking && S.els.cur && S.els.cur.dataset.id === S.inking.id) startCardPen(S.els.cur);
  }

  function rest(card, role) {
    if (role === 'next') { card.style.transform = 'scale(.94)'; card.style.opacity = '.55'; }
    else if (role === 'prev') { card.style.transform = 'translateY(calc(-100% - 24px))'; card.style.opacity = '1'; }
    else { card.style.transform = ''; card.style.opacity = '1'; }
  }

  /* ---------- swiping ---------- */

  function dragTo(dy) {
    const H = $('stack').clientHeight, e = S.els;
    if (dy <= 0) {
      if (e.prev) rest(e.prev, 'prev');
      const d = e.next ? dy : dy * 0.25;
      e.cur.style.transform = 'translateY(' + d + 'px)';
      if (e.next) {
        const p = Math.min(1, -dy / H);
        e.next.style.transform = 'scale(' + (0.94 + 0.06 * p) + ')';
        e.next.style.opacity = String(0.55 + 0.45 * p);
      }
    } else {
      if (e.next) rest(e.next, 'next');
      if (!e.prev) { e.cur.style.transform = 'translateY(' + dy * 0.25 + 'px)'; return; }
      e.prev.style.transform = 'translateY(' + (-H - 24 + dy) + 'px)';
      const p = Math.min(1, dy / H);
      e.cur.style.transform = 'scale(' + (1 - 0.06 * p) + ')';
    }
  }

  function animate(cards, after) {
    cards.forEach((c) => c && c.classList.add('anim'));
    let done = false;
    const finish = () => { if (done) return; done = true; after(); };
    setTimeout(finish, 340);
  }

  function go(delta) {
    const e = S.els;
    if (S.busy || !e.cur) return;
    const H = $('stack').clientHeight;
    if (delta > 0 && e.next) {
      S.busy = true;
      animate([e.cur, e.next], () => { S.busy = false; step(1); });
      requestAnimationFrame(() => {
        e.cur.style.transform = 'translateY(' + (-H - 24) + 'px)';
        rest(e.next, 'cur');
      });
    } else if (delta < 0 && e.prev) {
      S.busy = true;
      animate([e.cur, e.prev], () => { S.busy = false; step(-1); });
      requestAnimationFrame(() => {
        rest(e.prev, 'cur');
        e.cur.style.transform = 'scale(.94)';
      });
    } else settle();
  }

  function settle() {
    const e = S.els;
    animate([e.cur, e.next, e.prev], () => [e.cur, e.next, e.prev].forEach((c) => c && c.classList.remove('anim')));
    requestAnimationFrame(() => {
      rest(e.cur, 'cur');
      if (e.next) rest(e.next, 'next');
      if (e.prev) rest(e.prev, 'prev');
    });
  }

  function step(delta) {
    markCurrentRead();
    if (delta > 0 && !S.swiped) { S.swiped = true; store.set('swiped', true); }
    S.pos = Math.max(0, Math.min(S.order.length, S.pos + delta));
    if (S.hl && S.order[S.pos] !== S.hl.id) S.hl = null;
    saveFeed();
    render();
    if (currentId()) Sync.pos(currentId());
  }

  function setupGestures() {
    const stack = $('stack');
    let t = null;
    stack.addEventListener('touchstart', (ev) => {
      if (S.busy || ev.touches.length !== 1 || !S.els.cur || S.inking || hasSelection()) { t = null; return; }
      const body = S.els.cur.querySelector('.body');
      const p = ev.touches[0];
      t = {
        x: p.clientX, y: p.clientY, time: Date.now(), mode: null, dy: 0,
        top: !body || body.scrollTop <= 0,
        bottom: !body || body.scrollTop + body.clientHeight >= body.scrollHeight - 2,
        lastY: p.clientY, lastT: Date.now(), v: 0
      };
    }, { passive: true });

    stack.addEventListener('touchmove', (ev) => {
      if (!t) return;
      const p = ev.touches[0], dx = p.clientX - t.x, dy = p.clientY - t.y;
      if (t.mode === null) {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        if (hasSelection()) { t.mode = 'none'; return; }   // dragging a selection handle
        if (Math.abs(dx) > Math.abs(dy)) t.mode = 'none';
        else if ((dy < 0 && t.bottom) || (dy > 0 && t.top)) t.mode = 'drag';
        else t.mode = 'scroll';
      }
      if (t.mode !== 'drag') return;
      ev.preventDefault();
      const now = Date.now();
      t.v = (p.clientY - t.lastY) / Math.max(1, now - t.lastT);
      t.lastY = p.clientY; t.lastT = now; t.dy = dy;
      dragTo(dy);
    }, { passive: false });

    const end = () => {
      if (!t || t.mode !== 'drag') { t = null; return; }
      const H = stack.clientHeight, dy = t.dy, fast = Math.abs(t.v) > 0.45 && Math.abs(dy) > 30;
      t = null;
      if (dy < 0 && (-dy > H * 0.16 || fast)) go(1);
      else if (dy > 0 && (dy > H * 0.16 || fast)) go(-1);
      else settle();
    };
    stack.addEventListener('touchend', end);
    stack.addEventListener('touchcancel', end);

    // mouse wheel / trackpad: scroll the card first, then move between cards
    let acc = 0, lock = 0;
    stack.addEventListener('wheel', (ev) => {
      if (!S.els.cur || S.busy || S.inking) return;   // while drawing, the wheel only scrolls the card
      const body = S.els.cur.querySelector('.body');
      const top = !body || body.scrollTop <= 0;
      const bottom = !body || body.scrollTop + body.clientHeight >= body.scrollHeight - 2;
      if ((ev.deltaY > 0 && !bottom) || (ev.deltaY < 0 && !top)) { acc = 0; return; }
      ev.preventDefault();
      if (Date.now() < lock) return;
      acc += ev.deltaY;
      if (Math.abs(acc) > 80) { go(acc > 0 ? 1 : -1); acc = 0; lock = Date.now() + 600; }
    }, { passive: false });

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && S.sheets.length) return closeSheet();
      if (S.sheets[S.sheets.length - 1] === $('viewer')) {
        if (ev.key === 'ArrowRight') turnPage(1);
        if (ev.key === 'ArrowLeft') turnPage(-1);
        return;
      }
      if (S.sheets.length || S.inking || /input|textarea/i.test((ev.target || {}).tagName || '')) return;
      if (['ArrowDown', 'ArrowRight', 'j'].indexOf(ev.key) >= 0) { ev.preventDefault(); go(1); }
      if (['ArrowUp', 'ArrowLeft', 'k'].indexOf(ev.key) >= 0) { ev.preventDefault(); go(-1); }
    });
    $('btnNext').onclick = () => go(1);
    $('btnPrev').onclick = () => go(-1);
  }

  /* ---------- card actions ---------- */

  function toggleMark(id) {
    const i = S.marks.indexOf(id);
    if (i >= 0) { S.marks.splice(i, 1); toast('Removed from saved'); }
    else { S.marks.unshift(id); toast('Saved'); }
    Sync.mark(id, i < 0);
    saveSets();
    refreshFoot(id);
  }

  function refreshFoot(id) {
    ['prev', 'cur', 'next'].forEach((k) => {
      const c = S.els[k];
      if (c && c.dataset.id === id) {
        const b = c.querySelector('.foot .save');
        const on = S.marks.indexOf(id) >= 0;
        b.classList.toggle('on', on);
        b.setAttribute('aria-label', on ? 'Remove from saved' : 'Save card');
      }
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => {
      const ta = el('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); }
      ta.remove();
    });
  }

  function shareCard(id) {
    const c = S.cards[id], text = cardText(c);
    if (navigator.share) {
      navigator.share({ title: cardLabel(c), text: text }).catch(() => {});
    } else copyText(text).then(() => toast('Card text copied'), () => toast('Could not copy'));
  }

  function openMenu(id) {
    S.menuCard = id;
    $('mRandom').hidden = S.settings.order !== 'book';
    openSheet('sheetMenu');
  }

  function hideCard(id) {
    S.hidden.add(id);
    saveSets();
    Sync.hide(id, true);
    const at = S.order.indexOf(id);
    if (at >= 0) { S.order.splice(at, 1); if (at < S.pos) S.pos--; }
    saveFeedNow();
    render();
    toast('Card hidden', 'Undo', () => {
      S.hidden.delete(id); saveSets(); Sync.hide(id, false);
      S.order.splice(Math.min(S.pos, S.order.length), 0, id);
      saveFeedNow(); render();
    });
  }

  // Leaves book order and returns to the random cards where the reader left
  // them (each scope and order keeps its own position).
  async function backToRandom() {
    const before = store.get('before', null);
    markCurrentRead();
    S.settings.order = 'random'; saveSettings();
    if (before && (before.scope === 'all' || S.bookById[before.scope])) { S.scope = before.scope; store.set('scope', S.scope); }
    store.set('before', null);
    await loadFeed();
    render();
    toast('Back to random cards');
  }

  /* ---------- contents ---------- */

  // The book's index: chapters, and under each the sub-topics with their
  // page. Tapping one starts reading there, in book order.
  function openToc(bookId, currentId) {
    const book = S.bookById[bookId];
    if (!book) return;
    $('tocBook').textContent = book.title;
    const here = buildToc($('tocList'), bookId, currentId, (c) => { closeAllSheets(); readInOrder(c.id); });
    openSheet('sheetToc');
    const body = $('sheetToc').querySelector('.sheet-body');
    body.scrollTop = 0;
    if (here) requestAnimationFrame(() => { body.scrollTop = here.offsetTop - body.clientHeight / 3; });
  }

  // a book's chapters and sub-topics into a list; returns the entry of the current card
  function buildToc(list, bookId, currentId, pick) {
    const book = S.bookById[bookId];
    list.textContent = '';
    const cur = currentId && S.cards[currentId];
    let lastCh = null, lastG = null, here = null;
    (S.byBook[bookId] || []).forEach((c) => {
      if (S.hidden.has(c.id)) return;
      if (c.g === lastG) return;   // the parts of a long section get one entry
      lastG = c.g;
      if (c.ch && c.ch !== lastCh) {
        const h = el('li', 'toc-ch', c.ch);
        h.lang = 'gu';
        list.appendChild(h);
      }
      lastCh = c.ch || lastCh;
      const li = el('li'), b = el('button', 'toc-item' + (S.read.has(c.id) ? ' read' : ''));
      const words = el('span', 'toc-words');
      words.lang = 'gu';
      if (c.k) words.appendChild(el('span', 'toc-k', c.k));
      words.appendChild(el('span', 'toc-t', c.t ? c.t : cardLabel(c)));
      b.appendChild(words);
      const pg = pageText(c, book).replace(/^(PDF )?Pages? /, '').replace(/–.*/, '');
      if (pg) b.appendChild(el('span', 'toc-pg', pg));
      b.onclick = () => pick(c);
      b.dataset.g = c.g;
      if (cur && cur.g === c.g) { b.classList.add('here'); here = b; }
      li.appendChild(b);
      list.appendChild(li);
    });
    return here;
  }

  /* ---------- wide screens: contents on the left, this card's marks on the right ---------- */

  const WIDE = window.matchMedia ? window.matchMedia('(min-width: 1150px)') : { matches: false };
  let sideBook = null;

  function renderSides() {
    const left = $('sideToc'), right = $('sideMarks');
    const id = currentId(), c = id && S.cards[id];
    const show = WIDE.matches && !!c;
    left.hidden = right.hidden = !show;
    $('feed').classList.toggle('wide', show);
    if (!show) { sideBook = null; return; }
    // each panel folds into a slim rail; the choice is kept on this device
    const openL = store.get('sideL', true), openR = store.get('sideR', true);
    $('feed').classList.toggle('fold-l', !openL);
    $('feed').classList.toggle('fold-r', !openR);
    left.classList.toggle('folded', !openL);
    right.classList.toggle('folded', !openR);
    // contents: built once per book, then only the current entry moves
    const list = left.querySelector('ul');
    if (sideBook !== c.b) {
      sideBook = c.b;
      left.querySelector('.side-title').textContent = S.bookById[c.b].title;
      buildToc(list, c.b, id, (x) => readInOrder(x.id));
    }
    list.querySelectorAll('.toc-item.here').forEach((b) => b.classList.remove('here'));
    const here = list.querySelector('.toc-item[data-g="' + c.g + '"]');
    if (here) {
      here.classList.add('here');
      const top = here.offsetTop - left.clientHeight / 3;
      if (Math.abs(left.scrollTop - top) > left.clientHeight / 3) left.scrollTop = top;
    }
    // this card's highlights, notes and pen marks
    const box = right.querySelector('.side-list');
    box.textContent = '';
    const mine = marksOfCard(id), seen = {};
    mine.filter((m) => m.type === 'text').sort((a, b) => a.p - b.p || a.s - b.s).forEach((m) => {
      if (m.grp) { if (seen[m.grp]) return; seen[m.grp] = 1; }
      const b = el('button', 'side-mark');
      const bar = el('span', 'mark-bar');
      bar.style.background = m.color ? Marks.DOTS[m.color] : 'var(--accent)';
      b.appendChild(bar);
      const w = el('span', 'mark-words');
      w.lang = 'gu';
      w.appendChild(el('span', 'mark-q', '“' + groupOf(m).map((x) => x.q).join(' … ') + '”'));
      const noted = groupOf(m).find((x) => x.note);
      if (noted && noted.note.text) w.appendChild(el('span', 'mark-note', '✎ ' + noted.note.text));
      if (noted && noted.note.ink && noted.note.ink.length) {
        const img = el('img', 'mark-ink');
        img.alt = 'Hand-written note';
        img.src = Ink.thumbnail(noted.note.ink, noted.note.aspect || 0.8, 200);
        w.appendChild(img);
      }
      b.appendChild(w);
      b.onclick = () => openNote({ mark: noted || groupOf(m).slice(-1)[0] });
      box.appendChild(b);
    });
    const cn = mine.find((m) => m.type === 'cardnote');
    if (cn) {
      const s = noteStrip(cn);
      box.appendChild(s);
    }
    if (mine.some((m) => m.type === 'ink-card')) box.appendChild(el('p', 'side-hint', 'Pen marks on this card'));
    if (!box.childNodes.length) box.appendChild(el('p', 'side-hint', 'Select words on the card to highlight them or add a note.'));
    // the folded rail shows how many marks this card has
    const count = Object.keys(seen).length + mine.filter((m) => m.type === 'text' && !m.grp).length + (cn ? 1 : 0) + (mine.some((m) => m.type === 'ink-card') ? 1 : 0);
    $('railCount').textContent = count;
    $('railCount').hidden = !count;
    $('sideNote').disabled = $('sidePen').disabled = c.kind === 'index' || !!S.inking;
  }

  async function readInOrder(id) {
    const c = S.cards[id];
    markCurrentRead();
    // remember where random reading was, for "Back to random cards"
    if (S.settings.order === 'random') store.set('before', { scope: S.scope });
    S.scope = c.b; store.set('scope', S.scope);
    S.settings.order = 'book'; saveSettings();
    await loadFeed(id);
    render();
    Sync.pos(id);
  }

  async function jumpTo(id) {
    const c = S.cards[id];
    if (!c) return;
    markCurrentRead();
    if (S.scope !== 'all' && S.scope !== c.b) { S.scope = c.b; store.set('scope', S.scope); await loadFeed(); }
    if (S.hidden.has(id)) { S.hidden.delete(id); saveSets(); Sync.hide(id, false); }
    let i = S.order.indexOf(id);
    if (i < 0) { S.order.splice(S.pos, 0, id); i = S.pos; }
    S.pos = i; saveFeedNow(); render();
    Sync.pos(id);
    if (S.hl && S.hl.id === id) {
      // bring the first match into view
      const card = S.els.cur, body = card && card.querySelector('.body'), m = body && body.querySelector('mark');
      if (m) body.scrollTop += m.getBoundingClientRect().top - body.getBoundingClientRect().top - body.clientHeight / 3;
    }
  }

  /* ---------- search ---------- */

  // Finds cards whose title or text holds every word typed, in any order.
  // Matching ignores case and zero-width joiners, which some Gujarati text
  // carries invisibly.
  const Q = { scope: 'book', text: {}, timer: null, limit: 100 };
  const ZW = /[\u200B-\u200D\u2060\uFEFF\u00AD]/;

  // Lower-cased text without zero-width characters and with single spaces,
  // plus where each of its characters came from in the original.
  function normMap(s) {
    let t = '', map = [], space = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ZW.test(ch)) continue;
      if (/\s/.test(ch)) { if (!space && t) { t += ' '; map.push(i); } space = true; continue; }
      space = false;
      const low = ch.toLowerCase();
      for (let k = 0; k < low.length; k++) { t += low[k]; map.push(i); }
    }
    return { t, map };
  }

  function queryWords(q) {
    return Array.from(new Set(normMap(q).t.split(' ').filter(Boolean)));
  }

  // [start, end) ranges in s where any of the words occur, merged
  function findRanges(s, words) {
    const n = normMap(s), out = [];
    words.forEach((w) => {
      let i = n.t.indexOf(w);
      while (i >= 0) {
        out.push([n.map[i], n.map[i + w.length - 1] + 1]);
        i = n.t.indexOf(w, i + w.length);
      }
    });
    out.sort((a, b) => a[0] - b[0]);
    const merged = [];
    out.forEach((r) => {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r);
    });
    return merged;
  }

  function appendMarked(parent, s, words) {
    let at = 0;
    findRanges(s, words).forEach(([a, b]) => {
      if (a > at) parent.appendChild(document.createTextNode(s.slice(at, a)));
      parent.appendChild(el('mark', '', s.slice(a, b)));
      at = b;
    });
    if (at < s.length) parent.appendChild(document.createTextNode(s.slice(at)));
  }

  // wraps the words in <mark> inside an element that is already built
  function markWords(root, words) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      if (!findRanges(node.nodeValue, words).length) return;
      const frag = document.createDocumentFragment();
      appendMarked(frag, node.nodeValue, words);
      node.parentNode.replaceChild(frag, node);
    });
  }

  function searchText(c) {
    return Q.text[c.id] || (Q.text[c.id] = normMap([c.k, c.num, c.t].concat(c.p).filter(Boolean).join(' ')).t);
  }

  // a piece of the text around the first match
  function snippet(c, words) {
    const s = c.p.join(' '), r = findRanges(s, words)[0];
    if (!r) return s.slice(0, 160) + (s.length > 160 ? '…' : '');
    let a = Math.max(0, r[0] - 50), b = Math.min(s.length, r[0] + 130);
    if (a > 0) { const sp = s.indexOf(' ', a); a = sp >= 0 && sp < r[0] ? sp + 1 : a; }
    if (b < s.length) { const sp = s.lastIndexOf(' ', b); b = sp > r[1] ? sp : b; }
    return (a > 0 ? '…' : '') + s.slice(a, b) + (b < s.length ? '…' : '');
  }

  function openSearch() {
    const single = S.scope !== 'all' && S.bookById[S.scope] && S.books.length > 1;
    $('qScope').hidden = !single;
    if (single) $('qScopeBook').textContent = S.bookById[S.scope].title;
    openSheet('sheetSearch');
    const q = $('q');
    q.focus();     // in the tap itself, or iOS will not show the keyboard
    q.select();
    runSearch();
  }

  function runSearch() {
    const list = $('qList'), count = $('qCount');
    list.textContent = '';
    const words = queryWords($('q').value);
    const single = !$('qScope').hidden;
    $('qScope').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === Q.scope));
    if (!S.books.length) { count.textContent = 'Add a book to search it.'; return; }
    if (!words.length || words.join('').length < 2) {
      count.textContent = single && Q.scope === 'book' ? 'Search this book' : 'Search all your books';
      return;
    }
    const scope = single && Q.scope === 'book' ? S.scope : 'all';
    // the book being read first, then the library order
    const books = S.books.slice().sort((a, b) => (b.id === S.scope) - (a.id === S.scope) || b.added - a.added)
      .filter((b) => scope === 'all' || b.id === scope);
    const hits = [];
    books.forEach((b) => (S.byBook[b.id] || []).forEach((c) => {
      if (S.hidden.has(c.id) || c.kind === 'index') return;
      const t = searchText(c);
      if (words.every((w) => t.indexOf(w) >= 0)) hits.push(c);
    }));
    count.textContent = !hits.length ? 'No cards found'
      : hits.length > Q.limit ? 'First ' + Q.limit + ' of ' + hits.length + ' cards · add a word to narrow it down'
      : hits.length + (hits.length === 1 ? ' card' : ' cards');
    hits.slice(0, Q.limit).forEach((c) => {
      const book = S.bookById[c.b];
      const li = el('li'), btn = el('button', 'saved-item search-item');
      const t = el('div', 't');
      t.lang = 'gu';
      appendMarked(t, cardLabel(c), words);
      btn.appendChild(t);
      const sn = el('div', 's');
      sn.lang = 'gu';
      appendMarked(sn, snippet(c, words), words);
      btn.appendChild(sn);
      const where = pageText(c, book);
      const m = el('div', 'm', [scope === 'all' && book.title, c.ch && c.ch !== c.t ? c.ch : '', where].filter(Boolean).join(' · '));
      m.lang = 'gu';
      btn.appendChild(m);
      btn.onclick = () => { S.hl = { id: c.id, words }; closeAllSheets(); jumpTo(c.id); };
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function setupSearch() {
    const q = $('q');
    q.addEventListener('input', () => { clearTimeout(Q.timer); Q.timer = setTimeout(runSearch, 180); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(Q.timer); runSearch(); q.blur(); } });
    $('qScope').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      Q.scope = b.dataset.v;
      runSearch();
    });
    // scrolling the results puts the keyboard away
    $('sheetSearch').querySelector('.sheet-body').addEventListener('touchstart', () => q.blur(), { passive: true });
  }

  /* ---------- sheets ---------- */

  function openSheet(id) {
    const s = $(id);
    if (S.sheets.indexOf(s) >= 0) return;
    if (id === 'sheetLib') renderLibrary();
    if (id === 'sheetSaved') { renderSaved(); renderMarksList(); showSavedTab(); }
    if (id === 'sheetAa') { renderStorageNote(); renderSync(); }
    s.hidden = false;
    S.sheets.push(s);
    // the Android back button closes the sheet
    try { history.pushState({ sheet: id, depth: S.sheets.length }, ''); } catch (e) { /* file:// */ }
  }

  function closeSheet() {
    if (!S.sheets.length) return;
    if (history.state && history.state.sheet) history.back();
    else S.sheets.pop().hidden = true;
  }

  function closeAllSheets() {
    const n = S.sheets.length;
    while (S.sheets.length) S.sheets.pop().hidden = true;
    if (n && history.state && history.state.sheet) history.go(-n);
  }

  window.addEventListener('popstate', () => {
    const depth = (history.state && history.state.depth) || 0;
    while (S.sheets.length > depth) S.sheets.pop().hidden = true;
  });

  function setupSheets() {
    document.querySelectorAll('.sheet').forEach((s) => {
      s.addEventListener('click', (e) => { if (e.target === s || e.target.closest('[data-close]')) closeSheet(); });
    });
    $('btnLib').onclick = () => openSheet('sheetLib');
    $('btnScope').onclick = () => openSheet('sheetLib');
    $('btnSaved').onclick = () => openSheet('sheetSaved');
    $('savedTabs').querySelectorAll('button').forEach((b) => { b.onclick = () => { S.savedTab = b.dataset.v; showSavedTab(); }; });
    $('btnSearch').onclick = openSearch;
    $('btnAa').onclick = () => openSheet('sheetAa');
    $('btnAdd').onclick = $('btnAddFirst').onclick = () => $('file').click();
    $('file').onchange = (e) => { const files = Array.from(e.target.files || []); e.target.value = ''; if (files.length) importFiles(files); };

    $('mCopy').onclick = () => { const id = S.menuCard; closeSheet(); copyText(cardText(S.cards[id])).then(() => toast('Card text copied'), () => toast('Could not copy')); };
    $('mHide').onclick = () => { const id = S.menuCard; closeSheet(); hideCard(id); };
    $('mBookOrder').onclick = () => { const id = S.menuCard; closeSheet(); readInOrder(id); };
    $('mNote').onclick = () => { const id = S.menuCard; closeSheet(); setTimeout(() => openNote({ cardId: id }), 50); };
    $('mRandom').onclick = () => { closeSheet(); backToRandom(); };
    $('mToc').onclick = () => { const id = S.menuCard; closeSheet(); setTimeout(() => openToc(S.cards[id].b, id), 50); };

    $('fs').oninput = (e) => { S.settings.fs = +e.target.value; saveSettings(); };
    document.querySelectorAll('.seg[data-setting]').forEach((seg) => {
      seg.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const key = seg.dataset.setting, prev = S.settings[key];
        S.settings[key] = b.dataset.v;
        saveSettings();
        if (key === 'order' && prev !== b.dataset.v) {
          const keep = currentId();
          await loadFeed(keep);
          render();
        }
      });
    });
    $('btnResetRead').onclick = () => {
      if (!confirm('Mark every card as unread?')) return;
      S.read.clear(); saveSets(); Sync.resetRead(); toast('All cards are unread again');
    };
    matchMedia('(prefers-color-scheme: dark)').addEventListener && matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);
  }

  function renderLibrary() {
    const list = $('bookList');
    list.textContent = '';
    if (!S.books.length) {
      list.appendChild(el('li', 'empty-note', 'No books yet. Add a PDF, EPUB or Markdown file to begin.'));
      return;
    }
    const total = S.books.reduce((s, b) => s + b.count, 0);
    list.appendChild(bookRow(null, 'All books, mixed', total + ' cards · ' + S.books.length + (S.books.length === 1 ? ' book' : ' books'), S.scope === 'all'));
    S.books.slice().sort((a, b) => b.added - a.added).forEach((b) => {
      const cards = S.byBook[b.id] || [];
      const read = cards.filter((c) => S.read.has(c.id)).length;
      const pct = cards.length ? Math.round(100 * read / cards.length) : 0;
      const done = !read ? 'not started' : pct < 1 ? read + ' read' : pct + '% read';
      list.appendChild(bookRow(b, b.title, cards.length + ' cards · ' + done + ' · ' + b.kind.toUpperCase(), S.scope === b.id));
    });
  }

  function bookRow(b, title, meta, current) {
    const li = el('li');
    const row = el('div', 'book-row' + (current ? ' current' : ''));
    const main = el('button', 'book-main');
    let cover;
    if (b && b.cover) { cover = el('img', 'book-cover'); cover.src = b.cover; cover.alt = ''; }
    else { cover = el('div', 'book-cover' + (b ? '' : ' all')); cover.innerHTML = b ? ICON.book : ICON.stack; }
    main.appendChild(cover);
    const info = el('div', 'book-info');
    const t = el('div', 'book-title', title);
    t.lang = 'gu';
    info.appendChild(t);
    info.appendChild(el('div', 'book-meta', meta));
    main.appendChild(info);
    main.onclick = () => setScope(b ? b.id : 'all');
    row.appendChild(main);
    if (b) {
      row.appendChild(iconButton(ICON.toc, 'Contents', () => openToc(b.id)));
      row.appendChild(iconButton(ICON.edit, 'Rename', () => renameBook(b.id)));
      row.appendChild(iconButton(ICON.trash, 'Delete', () => deleteBook(b.id)));
    }
    li.appendChild(row);
    return li;
  }

  async function setScope(scope) {
    markCurrentRead();
    S.scope = scope; store.set('scope', scope);
    closeSheet();
    await loadFeed();
    render();
  }

  async function renameBook(id) {
    const b = S.bookById[id];
    const name = prompt('Book name', b.title);
    if (!name || !name.trim()) return;
    b.title = name.trim();
    b.titleAt = Date.now();
    await DB.put('books', b);
    Sync.bookChanged(b);
    renderLibrary(); render();
  }

  async function deleteBook(id) {
    const b = S.bookById[id];
    // with sync on, a book deleted only here would come back from the other devices
    const everywhere = Sync.isOn() && b.key;
    const nMarks = Object.keys(S.mk.all).filter((k) => S.mk.all[k].b === id && !S.mk.all[k].del).length;
    if (!confirm('Delete "' + b.title + '" and its ' + b.count + ' cards' + (nMarks ? ', with your ' + nMarks + (nMarks === 1 ? ' highlight or note' : ' highlights and notes') : '') + ', from ' + (everywhere ? 'all your devices?' : 'this device?'))) return;
    await dropBook(id);
    if (everywhere) Sync.bookDeleted(b);
    await loadFeed();
    renderLibrary(); render();
    toast('Book deleted');
  }

  // removes a book and its cards from this device (no questions, no sync)
  async function dropBook(id) {
    await DB.deleteBook(id);
    if (V.docs[id]) { V.docs[id].then((d) => d.destroy()).catch(() => {}); delete V.docs[id]; }
    S.books = S.books.filter((x) => x.id !== id);
    delete S.bookById[id];
    (S.byBook[id] || []).forEach((c) => { delete S.cards[c.id]; S.read.delete(c.id); S.hidden.delete(c.id); });
    delete S.byBook[id];
    Object.keys(S.mk.all).forEach((k) => { if (S.mk.all[k].b === id) delete S.mk.all[k]; });
    indexMarks();
    S.marks = S.marks.filter((m) => S.cards[m]);
    saveSets();
    if (S.scope === id) { S.scope = 'all'; store.set('scope', 'all'); }
  }

  function showSavedTab() {
    $('savedTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.savedTab));
    $('savedList').hidden = S.savedTab !== 'cards';
    $('marksList').hidden = S.savedTab !== 'marks';
  }

  // Highlights & notes, by book; each book can be sent to Notes, Mail…
  function renderMarksList() {
    const box = $('marksList');
    box.textContent = '';
    const all = Object.keys(S.mk.all).map((k) => S.mk.all[k]).filter((m) => !m.del && S.bookById[m.b]);
    if (!all.length) { box.appendChild(el('p', 'empty-note', 'Select words on a card to highlight them or add a note. Your highlights, notes and pen marks show here.')); return; }
    S.books.slice().sort((a, b) => b.added - a.added).forEach((book) => {
      const mine = all.filter((m) => m.b === book.id);
      if (!mine.length) return;
      const cardOf = (n) => S.cards[book.id + ':' + n];
      const head = el('div', 'marks-book');
      const t = el('div', 'marks-book-title', book.title);
      t.lang = 'gu';
      head.appendChild(t);
      const share = el('button', 'marks-share');
      share.innerHTML = ICON.share;
      share.appendChild(document.createTextNode('Send to Notes…'));
      share.onclick = () => {
        const text = Marks.exportText(book.title, mine, cardOf, (c) => pageText(c, book), (pg) => (book.labels || [])[pg - 1]);
        if (navigator.share) navigator.share({ title: book.title, text }).catch(() => {});
        else copyText(text).then(() => toast('Highlights & notes copied'), () => toast('Could not copy'));
      };
      head.appendChild(share);
      box.appendChild(head);
      const seen = {};
      const sortKey = (m) => (m.type === 'ink-page' ? m.pg * 1e6 : ((cardOf(m.n) || {}).pg || 0) * 1e6 + m.n * 100 + (m.p || 0));
      mine.sort((a, b) => sortKey(a) - sortKey(b)).forEach((m) => {
        if (m.grp) { if (seen[m.grp]) return; seen[m.grp] = 1; }
        const c = m.type === 'ink-page' ? null : cardOf(m.n);
        if (m.type !== 'ink-page' && !c) return;
        const b = el('button', 'mark-item');
        const bar = el('span', 'mark-bar');
        bar.style.background = m.type === 'text' ? (m.color ? Marks.DOTS[m.color] : 'var(--accent)') : 'var(--line)';
        b.appendChild(bar);
        const w = el('span', 'mark-words');
        w.lang = 'gu';
        if (m.type === 'text') w.appendChild(el('span', 'mark-q', '“' + groupOf(m).map((x) => x.q).join(' … ') + '”' + (m.lost ? '  (text changed)' : '')));
        if (m.type === 'cardnote') w.appendChild(el('span', 'mark-q', 'Note on the card'));
        if (m.type === 'ink-card') w.appendChild(el('span', 'mark-q', 'Pen marks on the card'));
        if (m.type === 'ink-page') w.appendChild(el('span', 'mark-q', 'Pen marks on the page'));
        const note = groupOf(m).find((x) => x.note);
        if (note && note.note.text) w.appendChild(el('span', 'mark-note', '✎ ' + note.note.text));
        if (note && note.note.ink && note.note.ink.length) {
          const img = el('img', 'mark-ink');
          img.alt = 'Hand-written note';
          img.src = Ink.thumbnail(note.note.ink, note.note.aspect || 0.8, 200);
          w.appendChild(img);
        }
        const where = c ? [c.ch && c.ch !== c.t ? c.ch : '', c.t, pageText(c, book)].filter(Boolean).join(' · ') : 'Page ' + ((book.labels || [])[m.pg - 1] || m.pg);
        w.appendChild(el('span', 'mark-where', where));
        b.appendChild(w);
        b.onclick = () => {
          closeSheet();
          if (m.type === 'ink-page') setTimeout(() => openViewer(book.id, m.pg), 50);
          else jumpTo(book.id + ':' + m.n);
        };
        box.appendChild(b);
      });
    });
  }

  function renderSaved() {
    const list = $('savedList');
    list.textContent = '';
    const marks = S.marks.filter((id) => S.cards[id]);
    if (!marks.length) {
      list.appendChild(el('li', 'empty-note', 'Tap the bookmark on a card to keep it here.'));
      return;
    }
    marks.forEach((id) => {
      const c = S.cards[id], b = S.bookById[c.b];
      const li = el('li'), btn = el('button', 'saved-item');
      const t = el('div', 't', cardLabel(c));
      t.lang = 'gu';
      btn.appendChild(t);
      const m = el('div', 'm', [b && b.title, c.ch && c.ch !== c.t ? c.ch : ''].filter(Boolean).join(' · '));
      m.lang = 'gu';
      btn.appendChild(m);
      btn.onclick = () => { closeSheet(); jumpTo(id); };
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function renderStorageNote() {
    const n = S.books.length;
    $('storageNote').textContent = DB.memoryOnly()
      ? 'This browser is not letting the app store books (private mode?). Books will be gone when you close the page.'
      : n + (n === 1 ? ' book' : ' books') + ' stored on this device. ' +
        (Sync.isOn() ? 'Sync keeps a copy in your own Supabase account.' : 'Nothing is uploaded.');
  }

  /* ---------- page viewer ---------- */

  const V = { book: null, page: 1, zoom: 1, docs: {}, task: null, seq: 0 };
  const ZOOMS = [1, 1.6, 2.2];

  function pdfDoc(bookId) {
    if (!V.docs[bookId]) {
      V.docs[bookId] = (async () => {
        const f = await DB.getFile(bookId);
        if (!f) throw new Error('nofile');
        await loadScript('vendor/pdf.min.js');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
        return window.pdfjsLib.getDocument({ data: new Uint8Array(f.data.slice(0)), verbosity: 0, isEvalSupported: false }).promise;
      })();
      V.docs[bookId].catch(() => { delete V.docs[bookId]; });
    }
    return V.docs[bookId];
  }

  function openViewer(bookId, page) {
    if (V.pen) togglePagePen(false);
    V.book = bookId; V.page = page; V.zoom = 1;
    $('vZoom').classList.remove('on');
    openSheet('viewer');
    renderPage();
  }

  async function renderPage() {
    const seq = ++V.seq, book = S.bookById[V.book];
    if (!book) return;
    const label = (book.labels || [])[V.page - 1];
    $('vTitle').textContent = label ? 'Page ' + label : 'PDF page ' + V.page;
    $('vSub').textContent = book.title;
    const canvas = $('vCanvas'), msg = $('vMsg'), body = $('vBody');
    msg.hidden = true;
    let doc;
    try { doc = await pdfDoc(V.book); } catch (e) {
      canvas.hidden = true; msg.hidden = false;
      msg.textContent = e.message === 'nofile'
        ? 'This book was added before pages could be opened. Delete it and add the PDF again to open its pages.'
        : 'Could not open the PDF.';
      return;
    }
    if (seq !== V.seq) return;
    V.page = Math.max(1, Math.min(doc.numPages, V.page));
    $('vPrev').disabled = V.page <= 1;
    $('vNext').disabled = V.page >= doc.numPages;
    const page = await doc.getPage(V.page);
    if (seq !== V.seq) return;
    if (V.task) { V.task.cancel(); V.task = null; }
    const base = page.getViewport({ scale: 1 });
    const cssW = Math.min(body.clientWidth - 16, 900) * V.zoom;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const vp = page.getViewport({ scale: cssW / base.width * dpr });
    canvas.hidden = false;
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    canvas.style.width = cssW + 'px';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    V.task = page.render({ canvasContext: ctx, viewport: vp });
    body.scrollTop = 0; body.scrollLeft = 0;
    try { await V.task.promise; } catch (e) { /* replaced by a newer page */ }
    if (seq === V.seq) paintPage();
  }

  function turnPage(d) {
    if (d < 0 && $('vPrev').disabled) return;
    if (d > 0 && $('vNext').disabled) return;
    V.page += d; renderPage();
  }

  function setupViewer() {
    $('vClose').onclick = () => { togglePagePen(false); closeSheet(); };
    $('vPrev').onclick = () => turnPage(-1);
    $('vNext').onclick = () => turnPage(1);
    $('vZoom').onclick = () => {
      V.zoom = ZOOMS[(ZOOMS.indexOf(V.zoom) + 1) % ZOOMS.length];
      $('vZoom').classList.toggle('on', V.zoom > 1);
      renderPage();
    };
    // swipe sideways to turn the page (when not zoomed in)
    let t = null;
    const body = $('vBody');
    body.addEventListener('touchstart', (e) => { t = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
    body.addEventListener('touchend', (e) => {
      if (!t || V.zoom > 1 || V.pen) return;
      const p = e.changedTouches[0], dx = p.clientX - t.x, dy = p.clientY - t.y;
      t = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) turnPage(dx < 0 ? 1 : -1);
    });
  }

  /* ---------- import ---------- */

  const scripts = {};
  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.onload = resolve;
        s.onerror = () => { delete scripts[src]; reject(new Error('Could not load ' + src + '. Open the app once while online.')); };
        document.head.appendChild(s);
      });
    }
    return scripts[src];
  }

  function readFile(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(file);
    });
  }

  function fileTitle(name) {
    return name.replace(/\.(pdf|epub|md|markdown|txt)$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled book';
  }

  function goodTitle(t) {
    return t && /[A-Za-z઀-૿]{3,}/.test(t) && !/\.(indd|pmd|p65|qxd|docx?|pdf|txt|rtf|ai|cdr)$/i.test(t) && !/^(untitled|microsoft word)/i.test(t);
  }

  async function pdfCover(doc) {
    try {
      const page = await doc.getPage(1);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 360 / vp1.width });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      return c.toDataURL('image/jpeg', 0.8);
    } catch (e) { return ''; }
  }

  // Text from an unknown old font comes out as accented Latin letters.
  function looksGarbled(cards) {
    let latin1 = 0, letters = 0;
    cards.slice(0, 200).forEach((c) => {
      const s = c.p.join(' ');
      latin1 += (s.match(/[À-ÿŒœŸˆ-˝†-‰ﬁﬂ]/g) || []).length;
      letters += (s.match(/[A-Za-zÀ-ÿ઀-૿ऀ-ॿ]/g) || []).length;
    });
    return letters > 0 && latin1 / letters > 0.08;
  }

  // Real Gujarati prose is about a quarter common little words (છે, અને, તો…).
  // Text from an old font with an unknown layout converts to Gujarati letters
  // in nonsense order and has almost none.
  const COMMON = new Set(['છે', 'અને', 'તો', 'એ', 'આ', 'કે', 'ને', 'પણ', 'જ', 'નથી', 'તે', 'હોય', 'કરે', 'થાય', 'શું', 'એમ', 'હું', 'ના', 'નો', 'ની', 'નું']);
  function scrambledGujarati(cards) {
    let n = 0, hit = 0;
    cards.slice(0, 300).forEach((c) => c.p.join(' ').split(/[\s,.!?;:‘’"()–-]+/).forEach((w) => {
      if (/[\u0A80-\u0AFF]/.test(w)) { n++; if (COMMON.has(w)) hit++; }
    }));
    return n >= 200 && hit / n < 0.05;
  }

  let cancelImport = false, importing = false;

  // Raise PARSER whenever a change to the parsers (pdfbook, gujlegacy,
  // epubbook, mdbook) or to Cards.build changes the cards of a book. Books
  // read by an older version are then read again from their stored original,
  // so text fixes reach books already in the library.
  //   1  until 2026-11-05     2  ligatures, more old-font glyphs, Markdown
  //   3  the book's printed index becomes a card (PDF contents pages, EPUB contents links)
  const PARSER = 3;
  const FILE_TYPES = { pdf: 'application/pdf', epub: 'application/epub+zip', md: 'text/markdown' };

  // Saves a newly read book (record, cards, original file) and adds it to the
  // app. Used for books added here and books arriving from other devices.
  async function storeBook(info, cards, original) {
    const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const book = { id, title: info.title, author: info.author || '', kind: info.kind, added: info.added || Date.now(), cover: info.cover || '',
      count: cards.length, file: info.file || '', size: info.size || original.byteLength, parser: PARSER };
    if (info.titleAt) book.titleAt = info.titleAt;
    if (info.labels && info.labels.some(Boolean)) book.labels = info.labels;
    // the same file on every device has the same key: that is how sync knows a book
    try { book.key = info.key || await Sync.sha256(original); } catch (e) { /* no crypto.subtle (not https) */ }
    // the original is kept to show PDF pages, and to re-read the book when the app learns to read it better
    try { await DB.put('files', { id, data: original, type: FILE_TYPES[info.kind] }); book.hasFile = true; }
    catch (e) { /* storage full: cards still work, pages just can't be opened */ }
    const recs = cards.map((c) => Object.assign({ id: id + ':' + c.n, b: id }, c));
    await DB.addBook(book, recs);
    S.books.push(book); S.bookById[id] = book; S.byBook[id] = recs;
    recs.forEach((c) => { S.cards[c.id] = c; });
    return book;
  }

  // Reads a book file into cards. Throws a message for the reader when the
  // file can't be used. progress(label) gives a page/chapter callback, or null.
  async function parseBook(kind, data, progress, withCover) {
    let r, cover = '';
    if (kind === 'pdf') {
      await loadScript('vendor/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      r = await PdfBook.extract(window.pdfjsLib, data, progress && progress('Reading page'));
      if (progress) $('impStatus').textContent = 'Making cards…';
      if (withCover) cover = await pdfCover(r.doc);
      r.doc.destroy();
    } else if (kind === 'md') {
      r = await MdBook.extract(data);
    } else {
      await loadScript('vendor/jszip.min.js');
      r = await EpubBook.extract(window.JSZip, data, progress && progress('Reading chapter'));
      cover = r.cover;
    }
    const cards = Cards.build(r.blocks);
    const wordsTotal = cards.reduce((s, c) => s + c.w, 0);
    if ((!cards.length || wordsTotal < 40) && r.foreignChars > 200) {
      throw new Error('This PDF uses an old font the app does not know yet, so its text cannot be read. Try the EPUB edition of this book.');
    }
    if (!cards.length || wordsTotal < 40) {
      throw new Error(kind === 'pdf'
        ? 'No text found in this PDF. If it is a scanned book (pages are pictures), it cannot be turned into cards. Try the EPUB edition or a text PDF.'
        : 'No readable text found in this ' + (kind === 'md' ? 'file.' : 'EPUB.'));
    }
    if (looksGarbled(cards) || (kind === 'pdf' && scrambledGujarati(cards))) {
      throw new Error('This PDF uses an old Gujarati font the app does not know yet, so the text would come out garbled. Try the EPUB edition of this book.');
    }
    return { r, cards, cover };
  }

  async function importFiles(files) {
    importing = true;
    try { await importAll(files); } finally { importing = false; }
    if (reloadWhenIdle) reloadForUpdate();
    else upgradeBooks();
  }

  async function importAll(files) {
    const modal = $('importModal');
    let lastId = null, added = 0;
    for (const file of files) {
      const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
      const isEpub = /\.epub$/i.test(file.name) || file.type === 'application/epub+zip';
      // iPhone and iPad offer .md files as plain text, so .txt is read as Markdown too
      const isMd = !isPdf && !isEpub && (/\.(md|markdown|txt)$/i.test(file.name) || /^text\/(markdown|plain)$/.test(file.type));
      if (!isPdf && !isEpub && !isMd) { toast('"' + file.name + '" is not a PDF, EPUB or Markdown file'); continue; }
      const dup = S.books.find((b) => b.file === file.name && b.size === file.size);
      if (dup && !confirm('"' + dup.title + '" is already in your library. Add it again?')) continue;

      cancelImport = false;
      modal.hidden = false;
      $('impFile').textContent = file.name;
      $('impBar').style.width = '2%';
      $('impStatus').textContent = 'Opening…';
      const progress = (label) => (i, n) => {
        $('impBar').style.width = Math.max(2, Math.round(90 * i / n)) + '%';
        $('impStatus').textContent = label + ' ' + i + ' of ' + n;
        return !cancelImport;
      };
      try {
        const data = await readFile(file);
        const kind = isPdf ? 'pdf' : isMd ? 'md' : 'epub';
        const original = data.slice(0);   // pdf.js may take over the buffer it reads
        const { r, cards, cover } = await parseBook(kind, data, progress, true);
        const title = goodTitle(r.title) ? r.title : fileTitle(file.name);
        $('impBar').style.width = '96%';
        $('impStatus').textContent = 'Saving ' + cards.length + ' cards…';
        const book = await storeBook({ title, author: r.author || '', kind, cover, file: file.name, size: file.size, labels: r.labels }, cards, original);
        Sync.bookAdded(book);
        lastId = book.id; added++;
        toast('Added "' + title + '" · ' + cards.length + ' cards');
      } catch (e) {
        modal.hidden = true;
        if (!cancelImport) alert((e && e.message) || 'Could not read this file.');
      }
    }
    modal.hidden = true;
    if (lastId) {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      closeAllSheets();
      S.scope = added > 1 ? 'all' : lastId; store.set('scope', S.scope);
      await loadFeed();
      render();
    }
  }

  /* ---------- start ---------- */

  async function init() {
    S.settings = Object.assign(S.settings, store.get('settings', {}));
    S.scope = store.get('scope', 'all');
    S.swiped = store.get('swiped', false);
    applySettings();
    setupSheets();
    setupGestures();
    setupViewer();
    setupSearch();
    setupMarking();
    $('sideNote').onclick = () => { const id = currentId(); if (id) openNote({ cardId: id }); };
    const fold = (key) => () => { store.set(key, !store.get(key, true)); render(); };
    $('railToc').onclick = $('foldToc').onclick = fold('sideL');
    $('railMarks').onclick = $('foldMarks').onclick = fold('sideR');
    $('sidePen').onclick = () => { const id = currentId(); if (id) enterPen(id); };
    if (WIDE.addEventListener) WIDE.addEventListener('change', () => render());
    // a turned phone or a resized window: fit cards with pen marks again
    window.addEventListener('resize', debounce(() => { if (!S.inking) [S.els.prev, S.els.cur, S.els.next].forEach((c) => { if (c) fitLock(c); }); }, 200));
    $('impCancel').onclick = () => { cancelImport = true; $('impStatus').textContent = 'Stopping…'; };

    // another tab still on the old version holds the database upgrade back
    const blocked = setTimeout(() => toast('Close other Vanchan tabs or windows to finish updating', null, null, 60000), 2500);
    await DB.open();
    clearTimeout(blocked);
    const [books, cards, read, marks, hidden] = await Promise.all([
      DB.all('books'), DB.all('cards'), DB.getKv('read', []), DB.getKv('marks', []), DB.getKv('hidden', [])
    ]);
    S.books = books;
    books.forEach((b) => { S.bookById[b.id] = b; S.byBook[b.id] = []; });
    cards.forEach((c) => { if (S.byBook[c.b]) { S.cards[c.id] = c; S.byBook[c.b].push(c); } });
    Object.keys(S.byBook).forEach((k) => S.byBook[k].sort((a, b) => a.n - b.n));
    S.read = new Set(read); S.marks = marks.filter((m) => S.cards[m]); S.hidden = new Set(hidden);
    (await DB.all('marks')).forEach((m) => { S.mk.all[m.id] = m; });
    indexMarks();
    if (S.scope !== 'all' && !S.bookById[S.scope]) S.scope = 'all';
    await loadFeed();
    render();

    document.addEventListener('visibilitychange', () => { if (document.hidden) { markCurrentRead(); saveFeedNow(); } });

    // install
    let installEvt = null;
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('installRow').hidden = false; });
    $('btnInstall').onclick = () => { if (installEvt) { installEvt.prompt(); installEvt = null; $('installRow').hidden = true; } };
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios && !navigator.standalone) $('iosHint').hidden = false;

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) setupUpdates();
    if (store.get('updated', false)) { store.set('updated', false); toast('App updated'); }
    setupSync();
    setTimeout(upgradeBooks, 1500);
  }

  /* ---------- sync across devices (optional) ---------- */

  function cardIdsToNs(bookId, set) {
    const pre = bookId + ':', out = [];
    set.forEach((id) => { if (id.indexOf(pre) === 0) out.push(id.slice(pre.length)); });
    return out;
  }

  // what sync.js needs from the app; see the list above Sync.init
  const syncAdapter = {
    books: () => S.books,
    bookOfCard: (id) => S.cards[id] && S.bookById[S.cards[id].b],
    progressOfBook: (bookId) => ({ read: cardIdsToNs(bookId, S.read), marks: cardIdsToNs(bookId, S.marks), hidden: cardIdsToNs(bookId, S.hidden) }),
    applyProgress(bookId, p) {
      const pre = bookId + ':', want = (ns) => new Set(ns.map((n) => pre + n).filter((id) => S.cards[id]));
      const read = want(p.read), marks = want(p.marks), hidden = want(p.hidden);
      let changed = false;
      const sync = (set) => (ids) => {
        set.forEach((id) => { if (id.indexOf(pre) === 0 && !ids.has(id)) { set.delete(id); changed = true; } });
        ids.forEach((id) => { if (!set.has(id)) { set.add(id); changed = true; } });
      };
      sync(S.read)(read);
      sync(S.hidden)(hidden);
      const keep = S.marks.filter((id) => id.indexOf(pre) !== 0 || marks.has(id));
      const add = Array.from(marks).filter((id) => S.marks.indexOf(id) < 0);
      if (add.length || keep.length !== S.marks.length) { S.marks = add.concat(keep); changed = true; }
      return changed;
    },
    async progressChanged() {
      saveSets();
      const keep = currentId();
      await loadFeed(keep);
      if (!S.busy) render();
    },
    getFile: (id) => DB.getFile(id),
    saveBook: (b) => DB.put('books', b),
    async addRemoteBook(row, data) {
      try {
        const res = await parseBook(row.kind, data.slice(0), null, true);
        await storeBook({ title: row.title, titleAt: row.title_at, kind: row.kind, cover: res.cover, file: row.file_name, size: row.size,
          added: row.added, labels: res.r.labels, key: row.book_key, author: res.r.author }, res.cards, data);
      } catch (e) { /* a file this version can't read: skip it */ }
    },
    async removeBook(id) {
      const b = S.bookById[id];
      if (!b) return;
      await dropBook(id);
      await loadFeed();
      render();
      toast('"' + b.title + '" was deleted on another device');
    },
    async renameBook(id, title, at) {
      const b = S.bookById[id];
      if (!b) return;
      b.title = title; b.titleAt = at;
      await DB.put('books', b);
      render();
    },
    offerContinue(bookId, n, name) {
      const id = bookId + ':' + n, c = S.cards[id];
      if (!c || id === currentId()) return;
      toast('Continue from ' + name + ': ' + cardLabel(c), 'Continue', () => jumpTo(id));
    },
    // stays up while the books come in, so an empty screen never looks stuck
    gettingBook: (i, n, title) => toast('Getting books from your other devices… ' + i + ' of ' + n + ' · ' + title, null, null, 120000),
    async gotBooks(n) {
      await loadFeed(currentId());
      if (!S.busy) render();
      toast('Added ' + n + (n === 1 ? ' book' : ' books') + ' from your other devices');
    },
    markById: (id) => S.mk.all[id] || null,
    allMarks: () => Object.keys(S.mk.all).map((k) => S.mk.all[k]),
    // a mark from another device; card numbers may be for another parser version
    applyRemoteMark(m, parser) {
      const local = S.mk.all[m.id];
      if (local && (local.at || 0) >= (m.at || 0)) return false;
      const book = S.bookById[m.b];
      if (!book) return false;
      if (m.type === 'text' && !m.del && parser !== (book.parser || 1)) {
        // find the words again in this device's cards
        const cards = S.byBook[m.b] || [];
        const first = cards.find((c) => c.n === m.n);
        let again = Marks.reanchor(m, first, Cards.splitSpeaker);
        for (let i = 0; !again && i < cards.length; i++) again = Marks.reanchor(m, cards[i], Cards.splitSpeaker);
        if (again) Object.assign(m, again); else m.lost = true;
      }
      S.mk.all[m.id] = m;
      DB.put('marks', m).catch(() => {});
      return true;
    },
    marksChanged() {
      indexMarks();
      if (!S.busy && !S.inking && !hasSelection()) render();
    },
    getKv: (k, d) => DB.getKv(k, d),
    setKv: (k, v) => DB.setKv(k, v),
    onStatus: () => renderSync(),
    toast: (t) => toast(t)
  };

  function renderSync() {
    if (!Sync.available()) return;
    const st = Sync.status();
    $('syncOn').checked = st.on;
    $('syncOut').hidden = !st.signedIn;
    let text;
    if (st.error) text = st.error;
    else if (!st.on) text = 'Keep your books, saved cards and reading place the same on all your devices. Uses your Google account.';
    else if (st.busy) text = 'Syncing…';
    else text = 'Signed in as ' + (st.email || 'your Google account') + (st.lastSync ? ' · synced ' + ago(st.lastSync) : '');
    if (st.on && st.marksMissing) text += ' · Highlights and notes will sync once the database is updated (setup step in the guide).';
    if (st.on && st.cantSync) text += ' · ' + st.cantSync + (st.cantSync === 1 ? ' book was' : ' books were') + ' added by an older version and can\'t sync: add ' + (st.cantSync === 1 ? 'it' : 'them') + ' again on this device.';
    $('syncStatus').textContent = text;
  }

  function ago(t) {
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : new Date(t).toLocaleString();
  }

  function setupSync() {
    if (!Sync.available()) return;
    $('syncField').hidden = false;
    $('syncOn').onchange = (e) => { Sync.setOn(e.target.checked); renderSync(); };
    $('syncOut').onclick = () => {
      if (!confirm('Sign out of sync on this device? Your books stay here.')) return;
      Sync.signOut().then(renderSync);
    };
    Sync.init(syncAdapter).then(renderSync, () => {});
  }

  /* ---------- better text for books already added ---------- */

  // Books read by an older parser are read again from their stored original,
  // one at a time, while the reader carries on. Saved, read and hidden cards
  // and the reading place move over to the new cards.
  let reparsing = false;

  function cardKey(c) {
    return (c.t || '') + '|' + (c.p[0] || '').replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 40);
  }

  async function upgradeBooks() {
    if (reparsing || importing) return;
    const old = S.books.filter((b) => (b.parser || 1) < PARSER && b.hasFile && b.tried !== PARSER);
    if (!old.length) return;
    reparsing = true;
    let fixed = 0;
    try {
      for (const b of old) if (await reparseBook(b)) fixed++;
    } finally { reparsing = false; }
    if (fixed) toast(fixed === 1 ? 'Text updated in "' + old[0].title + '"' : 'Text updated in ' + fixed + ' books');
    if (reloadWhenIdle) reloadForUpdate();
  }

  async function reparseBook(b) {
    let f, res;
    try {
      f = await DB.getFile(b.id);
      if (!f || !f.data) return false;
      res = await parseBook(b.kind, f.data.slice(0), null, false);
    } catch (e) {
      // keep the cards it has; don't try again with this version
      b.tried = PARSER; DB.put('books', b).catch(() => {});
      return false;
    }
    if (!S.bookById[b.id]) return false;          // deleted meanwhile

    // old card id -> new card id: same position when the count is unchanged,
    // otherwise the card with the same title and opening, otherwise the same
    // place in the book
    const oldCards = S.byBook[b.id] || [], cards = res.cards, map = {};
    const newId = (n) => b.id + ':' + n;
    if (oldCards.length !== cards.length) {
      const byKey = {};
      cards.forEach((c) => { const k = cardKey(c); (byKey[k] = byKey[k] || []).push(c.n); });
      const last = Math.max(1, oldCards.length - 1), lastNew = Math.max(0, cards.length - 1);
      oldCards.forEach((c) => {
        const hit = byKey[cardKey(c)];
        map[c.id] = newId(hit && hit.length ? hit.shift() : Math.round(c.n * lastNew / last));
      });
    }
    const move = (id) => map[id] || id;
    const moveN = (n) => { const to = map[b.id + ':' + n]; return to ? to.slice(to.lastIndexOf(':') + 1) : String(n); };

    const recs = cards.map((c) => Object.assign({ id: newId(c.n), b: b.id }, c));
    b.count = recs.length; b.parser = PARSER; delete b.tried;
    Sync.remap(b, moveN);
    remapMarks(b, moveN, recs);
    if (res.r.labels && res.r.labels.some(Boolean)) b.labels = res.r.labels; else delete b.labels;
    await DB.replaceCards(b, recs);

    const curBefore = currentId();
    oldCards.forEach((c) => { delete S.cards[c.id]; });
    S.byBook[b.id] = recs;
    recs.forEach((c) => { S.cards[c.id] = c; });
    S.read = new Set(Array.from(S.read, move));
    S.hidden = new Set(Array.from(S.hidden, move));
    S.marks = Array.from(new Set(S.marks.map(move)));
    S.order = Array.from(new Set(S.order.map(move)));
    Q.text = {};                                  // search must see the new text
    saveSets();
    await saveFeedNow();                          // loadFeed reads the saved order back
    await loadFeed(move(curBefore));
    // show the new text unless a card is being dragged or animated
    if (!S.busy) render();
    return true;
  }

  /* ---------- app updates ---------- */

  // A home-screen app is usually resumed, not restarted, so the browser
  // rarely looks for a new version by itself. Look on every start and every
  // return to the app; when a new version has taken over, reload into it.
  // Books, progress and settings are in IndexedDB / localStorage and stay.
  let reloadWhenIdle = false;

  async function reloadForUpdate() {
    if (importing || reparsing) { reloadWhenIdle = true; return; }
    // write now what the debounced savers may still hold
    await Promise.all([
      saveFeedNow(),
      DB.setKv('read', Array.from(S.read)).catch(() => {}),
      DB.setKv('hidden', Array.from(S.hidden)).catch(() => {}),
      DB.setKv('marks', S.marks).catch(() => {})
    ]);
    store.set('updated', true);
    location.reload();
  }

  function setupUpdates() {
    const sw = navigator.serviceWorker;
    let hadController = !!sw.controller, lastCheck = 0;
    sw.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      const check = () => {
        if (Date.now() - lastCheck < 60000) return;
        lastCheck = Date.now();
        reg.update().catch(() => {});
      };
      check();
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      window.addEventListener('focus', check);
      window.addEventListener('online', check);
    }).catch(() => {});
    sw.addEventListener('controllerchange', () => {
      // the first install also takes control; that is not an update
      if (!hadController) { hadController = true; return; }
      reloadForUpdate();
    });
  }

  init();
})();
