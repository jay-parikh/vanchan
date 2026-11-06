/*
 * Builds reading cards from a book's blocks.
 *
 * blocks: [{ t: 'h', level: 1|2, text } | { t: 'p', text }]
 * card:   { n, g, ch, k, t, num, part, p: [paragraphs], w }
 *   n    position in book order        g    group (parts of one section share it)
 *   ch   chapter                       k    small label above the title, e.g. "(સૂત્ર - ૧)"
 *   t    title (the sub-topic)         num  number of a numbered saying (આપ્તસૂત્ર)
 *   part [i, of] when a long section is split
 *   pg, pe  first and last PDF page (1-based)     lb, le  first and last printed
 *           page label (EPUB page markers)
 */
(function (root) {
  'use strict';

  var LONG_CARD = 1000;   // words; longer sections are split into parts
  var PART_SIZE = 450;

  var NUM_START = /^\(?([0-9૦-૯]{1,4})[\).]?\s+/;

  function words(s) { return s ? s.split(/\s+/).filter(Boolean).length : 0; }

  function hasWords(s) {
    return /[઀-૿]{2,}|[A-Za-zऀ-ॿ]{2,}/.test(s);
  }

  // "(સૂત્ર - ૧)", "પ્રકરણ ૩", "Chapter 2": a short numbered label
  function isKicker(s) {
    return words(s) <= 5 && /[0-9૦-૯]/.test(s);
  }

  function gujaratiShare(s) {
    var g = (s.match(/[઀-૿]/g) || []).length;
    var l = (s.match(/[A-Za-z]/g) || []).length;
    return g + l ? g / (g + l) : 0;
  }

  // where a block sits in the book
  function locOf(b) { return { pg: b.page, pe: b.last || b.page, lb: b.label }; }

  // first / last page of a card, from its heading and its paragraphs
  function place(c, head, locs) {
    var first = head || locs[0] || {}, last = locs[locs.length - 1] || first;
    if (first.pg) { c.pg = first.pg; c.pe = Math.max(first.pe || first.pg, last.pe || last.pg || 0); }
    if (first.lb) { c.lb = first.lb; c.le = last.lb || first.lb; }
    delete c.locs; delete c.head; delete c.list;
    return c;
  }

  function build(blocks) {
    var cards = [], chapter = '', heads = [], cur = null;

    // very long "headings" are passages set in a display font
    // and a heading that starts with a dash is a byline ("— ડૉ. નીરુબેન અમીન")
    blocks = blocks.map(function (b) {
      return b.t === 'h' && (words(b.text) > 30 || /^[—–-]\s*\S/.test(b.text)) ? { t: 'p', text: b.text, lead: true, page: b.page, last: b.last, label: b.label } : b;
    });

    blocks.forEach(function (b) {
      var text = (b.text || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      if (/^(\S{1,2})( \1)+$/.test(text)) return;   // an ornament line: "v v v", "∗ ∗ ∗"
      if (b.t === 'h') {
        if (!hasWords(text) && !isKicker(text)) return;
        cur = null;
        heads.push({ text: text, level: b.level || 2, loc: locOf(b) });
        return;
      }
      if (!cur) {
        var title = '', kicker = '', headLoc = null;
        if (heads.length) {
          headLoc = heads[heads.length - 1].loc;
          // The last heading is the sub-topic. Before it: a level-1 heading
          // is the chapter, a short numbered one is the label, and any other
          // is the chapter when there is no level-1 heading.
          var last = heads[heads.length - 1], ctx = heads.slice(0, -1), top = '', other = '';
          ctx.forEach(function (h) {
            if (h.level === 1) top = h.text;
            else if (isKicker(h.text)) kicker = h.text;
            else if (words(h.text) <= 8 && !/\.$/.test(h.text)) other = h.text;   // a sentence is not a chapter name
          });
          if (top || other) chapter = top || other;
          if (last.level === 1 && !ctx.length) { chapter = last.text; title = last.text; }
          else if (isKicker(last.text) && !kicker && last.level !== 1) kicker = last.text;
          else title = last.text;
          heads = [];
        }
        cur = { ch: chapter, k: kicker, t: title, p: [], locs: [], head: headLoc };
        // a sub-topic heading too long for a title opens the card in bold
        if (b.lead && !title) cur.lead = true;
        cards.push(cur);
      }
      cur.p.push(text);
      cur.locs.push(locOf(b));
      if (b.li) cur.list = true;   // a numbered list stays on one card
    });

    // numbered sayings: one card each
    var out = [];
    cards.forEach(function (c) {
      var nums = c.p.filter(function (p) { return NUM_START.test(p); });
      var avg = nums.reduce(function (s, p) { return s + words(p); }, 0) / (nums.length || 1);
      // a numbered list of book names is not a book of sayings
      if (!c.list && c.p.length >= 5 && nums.length / c.p.length >= 0.6 && avg >= 10) {
        var one = null;
        c.p.forEach(function (p, i) {
          var m = p.match(NUM_START);
          if (m) {
            one = { ch: c.ch || c.t, k: '', t: '', num: m[1], p: [p.slice(m[0].length)], locs: [c.locs[i]] };
            out.push(one);
          } else if (one) { one.p.push(p); one.locs.push(c.locs[i]); }
          else out.push({ ch: c.ch, k: c.k, t: c.t, p: [p], locs: [c.locs[i]], head: c.head });
        });
      } else out.push(c);
    });

    // split very long sections into parts
    var final = [], g = 0;
    out.forEach(function (c) {
      c.w = c.p.reduce(function (s, p) { return s + words(p); }, 0);
      g++;
      if (c.w <= LONG_CARD) { c.g = g; final.push(place(c, c.head, c.locs)); return; }
      var lead = c.lead;
      var parts = [], acc = [], n = 0;   // parts hold paragraph indexes
      var nParts = Math.ceil(c.w / PART_SIZE), target = c.w / nParts;
      c.p.forEach(function (p, i) {
        acc.push(i); n += words(p);
        if (n >= target) { parts.push(acc); acc = []; n = 0; }
      });
      if (acc.length) {
        if (parts.length && n < target * 0.4) parts[parts.length - 1] = parts[parts.length - 1].concat(acc);
        else parts.push(acc);
      }
      parts.forEach(function (ix, i) {
        var ps = ix.map(function (k) { return c.p[k]; });
        final.push(place({ ch: c.ch, k: c.k, t: c.t, num: c.num, p: ps, g: g, part: parts.length > 1 ? [i + 1, parts.length] : null, lead: i === 0 && lead,
          w: ps.reduce(function (s, p) { return s + words(p); }, 0) }, i === 0 ? c.head : null, ix.map(function (k) { return c.locs[k]; })));
      });
    });

    // drop scraps and, in Gujarati books, the English copyright pages
    var all = final.map(function (c) { return c.p.join(' '); }).join(' ');
    var guj = gujaratiShare(all) > 0.5;
    final = final.filter(function (c) {
      var body = c.p.join(' ');
      if (c.w < 12 && !c.num) return false;
      if (guj && gujaratiShare(body) < 0.4) return false;
      return true;
    });
    final.forEach(function (c, i) { c.n = i; });
    return final;
  }

  // "પ્રશ્નકર્તા : ..." -> label + rest, for bold speaker names in dialogues
  function splitSpeaker(p) {
    var m = p.match(/^([^\s:‘’"“”()]{2,25}(?: [^\s:‘’"“”()]{2,25}){0,2}) ?: /);
    return m ? { who: m[1], rest: p.slice(m[0].length) } : null;
  }

  var api = { build: build, splitSpeaker: splitSpeaker, words: words };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Cards = api;
})(this);
