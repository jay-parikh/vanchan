/*
 * The reader's marks on a book: highlights and underlines on words, notes
 * (typed or hand-written) on words or on a whole card, and pen drawings on
 * cards and PDF pages. This file holds the parts that don't touch the
 * screen, so they can be tested on their own; app.js draws and edits them.
 *
 * A mark:
 *   { id, b: local book id, key: book key (file hash), type, at: time changed, del: deleted }
 *   type 'text'     words in a card: n (card number), p (paragraph), s, e (offsets in the
 *                   paragraph's text as shown), q (the words), pre / suf (a few characters
 *                   around them), color ('yellow'|'green'|'blue'|'pink'|null), ul (underline),
 *                   grp (marks made in one go across paragraphs share it), note
 *   type 'cardnote' a note on a whole card: n, note
 *   type 'ink-card' pen marks over a card: n, strokes, layout { fs, font, w }
 *   type 'ink-page' pen marks over a PDF page: pg, strokes
 *   note: { text } or { ink: strokes, aspect }
 */
(function (root) {
  'use strict';

  var COLORS = { yellow: '#FBE7A1', green: '#CDEBC5', blue: '#C9DDF5', pink: '#F6CFDD' };
  var DOTS = { yellow: '#F5D35B', green: '#8FD07E', blue: '#86B4EE', pink: '#F09BBB' };
  var CONTEXT = 24;

  function newId() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // The text of a paragraph exactly as a card shows it ("પ્રશ્નકર્તા : …" gets
  // its speaker in bold, which reads "who : rest").
  function paraText(p, splitSpeaker) {
    var sp = splitSpeaker ? splitSpeaker(p) : null;
    return sp ? sp.who + ' : ' + sp.rest : p;
  }

  function context(text, s, e) {
    return { q: text.slice(s, e), pre: text.slice(Math.max(0, s - CONTEXT), s), suf: text.slice(e, e + CONTEXT) };
  }

  // Where the words of a mark are in a paragraph's text: the place whose
  // surrounding characters match best (the same words can occur twice).
  function findQuote(text, m) {
    if (!m.q) return null;
    var best = null, bestScore = -1, i = text.indexOf(m.q);
    while (i >= 0) {
      var score = 0, k;
      for (k = 1; k <= (m.pre || '').length && text[i - k] === m.pre[m.pre.length - k]; k++) score++;
      for (k = 0; k < (m.suf || '').length && text[i + m.q.length + k] === m.suf[k]; k++) score++;
      if (typeof m.s === 'number') score -= Math.min(5, Math.abs(i - m.s) / 200);
      if (score > bestScore) { bestScore = score; best = [i, i + m.q.length]; }
      i = text.indexOf(m.q, i + 1);
    }
    return best;
  }

  // After a book is read again (new parser): put a text mark back on its
  // words in the card it moved to. Returns the updated mark, or null when the
  // words are no longer there.
  function reanchor(m, card, splitSpeaker) {
    if (!card) return null;
    var paras = card.p.map(function (p) { return paraText(p, splitSpeaker); });
    var order = paras.map(function (_, i) { return i; });
    if (typeof m.p === 'number') order.sort(function (a, b) { return Math.abs(a - m.p) - Math.abs(b - m.p); });
    for (var j = 0; j < order.length; j++) {
      var hit = findQuote(paras[order[j]], m);
      if (hit) return Object.assign({}, m, { n: card.n, p: order[j], s: hit[0], e: hit[1] });
    }
    return null;
  }

  // Wraps character ranges of an element's text in spans, across its text
  // nodes (a paragraph may start with a bold speaker name).
  // ranges: [{ s, e, make(): element }] sorted, not overlapping.
  function wrapRanges(el, ranges) {
    if (!ranges.length) return;
    var walker = el.ownerDocument.createTreeWalker(el, 4), nodes = [], pos = 0, n;
    while ((n = walker.nextNode())) { nodes.push({ node: n, start: pos, end: pos + n.nodeValue.length }); pos += n.nodeValue.length; }
    nodes.forEach(function (t) {
      var cuts = ranges.filter(function (r) { return r.s < t.end && r.e > t.start; });
      if (!cuts.length) return;
      var text = t.node.nodeValue, frag = el.ownerDocument.createDocumentFragment(), at = 0;
      cuts.forEach(function (r) {
        var a = Math.max(0, r.s - t.start), b = Math.min(text.length, r.e - t.start);
        if (a > at) frag.appendChild(el.ownerDocument.createTextNode(text.slice(at, a)));
        var span = r.make();
        span.textContent = text.slice(a, b);
        frag.appendChild(span);
        at = b;
      });
      if (at < text.length) frag.appendChild(el.ownerDocument.createTextNode(text.slice(at)));
      t.node.parentNode.replaceChild(frag, t.node);
    });
  }

  // Character offsets of a DOM point inside an element's text.
  function offsetIn(el, node, offset) {
    var walker = el.ownerDocument.createTreeWalker(el, 4), pos = 0, n;
    if (node.nodeType !== 3) {
      // a point between children: count the text before that child
      var child = node.childNodes[offset];
      while ((n = walker.nextNode())) {
        if (child && (child === n || child.contains(n))) return pos;
        pos += n.nodeValue.length;
      }
      return pos;
    }
    while ((n = walker.nextNode())) {
      if (n === node) return pos + offset;
      pos += n.nodeValue.length;
    }
    return pos;
  }

  // Two copies of one mark (two devices): the newest change wins.
  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (b.at || 0) > (a.at || 0) ? b : a;
  }

  // A book's highlights and notes as plain text, for Notes, Mail or WhatsApp.
  // cardOf(n) -> card; where(card) -> "Page ૧" or ''; pageLabel(pg) -> printed page.
  function exportText(title, marks, cardOf, where, pageLabel) {
    var live = marks.filter(function (m) { return !m.del; });
    var key = function (m) { return m.type === 'ink-page' ? [m.pg || 0, 0] : [(cardOf(m.n) || {}).pg || 0, m.n * 1000 + (m.p || 0) * 10]; };
    live.sort(function (a, b) { var x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1]; });
    var out = [title + ' — highlights & notes', ''], seenGrp = {};
    live.forEach(function (m) {
      if (m.grp && seenGrp[m.grp]) return;
      if (m.grp) seenGrp[m.grp] = 1;
      var c = m.type === 'ink-page' ? null : cardOf(m.n);
      var head = c ? [c.ch && c.ch !== c.t ? c.ch : '', c.t, where(c)].filter(Boolean).join(' · ') : 'Page ' + (pageLabel(m.pg) || m.pg);
      var lines = [head];
      if (m.type === 'text') {
        var q = m.grp ? live.filter(function (x) { return x.grp === m.grp; }).map(function (x) { return x.q; }).join(' … ') : m.q;
        lines.push('“' + q + '”');
      }
      if (m.note && m.note.text) lines.push('Note: ' + m.note.text);
      if (m.note && m.note.ink) lines.push('(hand-written note)');
      if (m.type === 'ink-card' || m.type === 'ink-page') lines.push('(pen marks)');
      out.push(lines.join('\n'), '');
    });
    return out.join('\n').trim() + '\n';
  }

  var api = {
    COLORS: COLORS, DOTS: DOTS, newId: newId, paraText: paraText, context: context, findQuote: findQuote,
    reanchor: reanchor, wrapRanges: wrapRanges, offsetIn: offsetIn, newer: newer, exportText: exportText
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Marks = api;
})(this);
