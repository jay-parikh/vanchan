/*
 * Turns a PDF into a list of blocks: { t: 'h', level, text } for headings and
 * { t: 'p', text, page } for paragraphs.
 *
 * pdf.js only gives positioned text pieces, so lines, columns, paragraphs and
 * headings are rebuilt from their positions, sizes and fonts. Running headers,
 * page numbers and contents pages are dropped.
 */
(function (root) {
  'use strict';

  var G = root.GujLegacy || (typeof require !== 'undefined' ? require('./gujlegacy.js') : null);

  function mode(values) {
    var count = {}, best = null, bestN = 0;
    values.forEach(function (v) {
      count[v] = (count[v] || 0) + 1;
      if (count[v] > bestN) { bestN = count[v]; best = v; }
    });
    return best;
  }

  /* ---------- fonts ---------- */

  function analyseFonts(pages) {
    var fonts = {};
    pages.forEach(function (pg) {
      pg.items.forEach(function (it) {
        var f = fonts[it.f] || (fonts[it.f] = { sample: '', chars: 0 });
        if (f.sample.length < 20000) f.sample += it.s;
        f.chars += it.s.replace(/\s/g, '').length;
      });
    });
    Object.keys(fonts).forEach(function (k) {
      var f = fonts[k];
      f.legacy = G.looksLegacy(f.sample);
      f.mac = f.legacy && G.macScore(f.sample) > 0;
      // an old font with a different layout (e.g. Hindi Chanakya) would come
      // out as garbage, so its text is left out instead
      if (f.legacy) {
        var u = G.unknownShare(G.toByteView(f.sample, f.mac));
        f.foreign = u.share > 0.05 && u.count >= 3;
      }
    });
    // Tiny fonts holding only ligatures (ﬁ ﬂ) or dashes look like legacy
    // glyph codes. They only count as legacy when the book's own text is in
    // an old font, which also uses plain ASCII letters for its glyphs.
    var legacyBook = Object.keys(fonts).some(function (k) {
      var f = fonts[k];
      return f.legacy && !f.foreign && f.chars >= 300 && /[A-Za-z]/.test(f.sample);
    });
    if (!legacyBook) Object.keys(fonts).forEach(function (k) { fonts[k].legacy = fonts[k].mac = fonts[k].foreign = false; });
    return fonts;
  }

  /* ---------- lines ---------- */

  // Group the text pieces of one page into lines. Each line keeps its runs
  // (font + raw text) so legacy glyph sequences that pdf.js split across
  // pieces are converted together.
  function buildLines(pg, fonts) {
    var lines = [], cur = null;
    pg.items.forEach(function (it) {
      if (!it.s) return;
      var size = it.size || 10;
      var blank = !it.s.trim();
      if (cur && Math.abs(it.y - cur.y) < 0.5 * Math.max(size, cur.size) && it.x > cur.x1 - 0.6 * size) {
        var gap = it.x - cur.x1;
        if (gap > 0.15 * size) addText(cur, ' ', it.f);
      } else {
        if (blank) return;
        cur = { y: it.y, x0: it.x, x1: it.x, size: size, runs: [], sizes: {} };
        lines.push(cur);
      }
      addText(cur, it.s, it.f);
      if (!blank) {
        cur.x1 = Math.max(cur.x1, it.x + (it.w || 0));
        var n = it.s.replace(/\s/g, '').length;
        cur.sizes[size.toFixed(1)] = (cur.sizes[size.toFixed(1)] || 0) + n;
      }
    });
    lines.forEach(function (ln) {
      var best = 0;
      Object.keys(ln.sizes).forEach(function (s) { if (ln.sizes[s] > best) { best = ln.sizes[s]; ln.size = +s; } });
      // dominant font by characters
      var byFont = {};
      ln.runs.forEach(function (r) { byFont[r.f] = (byFont[r.f] || 0) + r.s.replace(/\s/g, '').length; });
      var bf = null, bn = -1;
      Object.keys(byFont).forEach(function (f) { if (byFont[f] > bn) { bn = byFont[f]; bf = f; } });
      ln.font = bf;
      ln.fontChars = byFont;
      // private-use characters come from symbol fonts (bullets, arrows)
      ln.text = convertRuns(ln.runs, fonts).replace(/[\uE000-\uF8FF]/g, '').replace(/\s+/g, ' ').trim();
    });
    return lines.filter(function (ln) { return ln.text; });
  }

  function addText(line, s, f) {
    var last = line.runs[line.runs.length - 1];
    if (last && last.f === f) last.s += s;
    else if (last && s === ' ') last.s += s;
    else line.runs.push({ f: f, s: s });
  }

  function convertRuns(runs, fonts) {
    // merge neighbouring runs that use the same legacy code page
    var out = '', pend = '', pendKey = null;
    function flush() {
      if (pendKey === null) return;
      out += pendKey === 'u' ? unligature(pend) : G.convertBytes(pend);
      pend = ''; pendKey = null;
    }
    runs.forEach(function (r) {
      var f = fonts[r.f] || {};
      if (f.foreign) return;
      var key = f.legacy ? 'l' : 'u';
      var s = f.legacy ? G.toByteView(r.s, f.mac) : r.s;
      if (pendKey !== null && pendKey !== key && r.s.trim()) flush();
      if (pendKey === null) pendKey = key;
      pend += s;
    });
    flush();
    return out;
  }

  var LIGATURES = { '\uFB00': 'ff', '\uFB01': 'fi', '\uFB02': 'fl', '\uFB03': 'ffi', '\uFB04': 'ffl', '\uFB05': 'st', '\uFB06': 'st' };
  function unligature(s) {
    return s.replace(/[\uFB00-\uFB06]/g, function (c) { return LIGATURES[c]; });
  }

  /* ---------- page clean-up ---------- */

  function normKey(t) {
    return t.replace(/[0-9૦-૯]+/g, '').replace(/[\s.\-–—|:]+/g, ' ').trim();
  }

  var GU_DIGITS = '૦૧૨૩૪૫૬૭૮૯';
  function toInt(d) {
    return parseInt(d.replace(/[૦-૯]/g, function (c) { return GU_DIGITS.indexOf(c); }), 10);
  }

  // A printed page number at either end of a line: "૨૭", "(૨) બુદ્ધિનું સ્વરૂપ ૨૭", "26 આપ્તવાણી".
  function edgeNumbers(text) {
    var out = [], m;
    if ((m = text.match(/^([0-9૦-૯]{1,4})(\s|$)/))) out.push(m[1]);
    if ((m = text.match(/(^|\s)([0-9૦-૯]{1,4})$/)) && m[2] !== out[0]) out.push(m[2]);
    return out;
  }

  // Works out the book's own page numbers and removes running headers and
  // footers. Section headers such as "(૨) બુદ્ધિનું સ્વરૂપ ૨૭" change from
  // chapter to chapter, so a line is also dropped when it sits at the top or
  // bottom of the page and carries that page's printed number.
  function dropRunningText(pagesLines) {
    var seen = {}, offsets = {}, gujDigits = 0, digits = 0;
    pagesLines.forEach(function (lines, pi) {
      var ends = edgeLines(lines), keys = {}, offs = {};
      ends.forEach(function (ln) {
        var k = normKey(ln.text);
        if (k) keys[k] = 1;
        edgeNumbers(ln.text).forEach(function (d) { offs[pi + 1 - toInt(d)] = d; });
      });
      Object.keys(keys).forEach(function (k) { seen[k] = (seen[k] || 0) + 1; });
      Object.keys(offs).forEach(function (o) {
        offsets[o] = (offsets[o] || 0) + 1;
        digits++;
        if (/[૦-૯]/.test(offs[o])) gujDigits++;
      });
    });

    // the offset between PDF page and printed page that most pages agree on
    var offset = null, best = 0;
    Object.keys(offsets).forEach(function (o) { if (offsets[o] > best) { best = offsets[o]; offset = +o; } });
    if (best < Math.max(3, pagesLines.length * 0.25)) offset = null;
    var guj = gujDigits * 2 > digits;

    var labels = pagesLines.map(function (lines, pi) {
      if (offset === null || pi + 1 - offset < 1) return null;
      var n = String(pi + 1 - offset);
      return guj ? n.replace(/[0-9]/g, function (c) { return GU_DIGITS.charAt(+c); }) : n;
    });

    // a short reply such as "દાદાશ્રી : હા." can end a few pages, so plain
    // repetition only counts when it is on a fifth of the pages
    var repeatMin = Math.max(3, pagesLines.length * 0.2);
    var cleaned = pagesLines.map(function (lines, pi) {
      var ends = edgeLines(lines);
      return lines.filter(function (ln) {
        if (ends.indexOf(ln) < 0) return true;
        var k = normKey(ln.text);
        if (!k) return false;                 // a bare page number
        if ((seen[k] || 0) >= repeatMin) return false;
        if (offset !== null && ln.text.split(' ').length <= 12 &&
            edgeNumbers(ln.text).some(function (d) { return toInt(d) === pi + 1 - offset; })) return false;
        return true;
      });
    });
    return { pagesLines: cleaned, labels: labels };
  }

  // the two highest and two lowest lines of a page
  function edgeLines(lines) {
    var s = lines.slice().sort(function (a, b) { return b.y - a.y; });
    return s.slice(0, 2).concat(s.slice(-2));
  }

  function isContentsPage(lines) {
    if (lines.length < 6) return false;
    var withNum = lines.filter(function (ln) { return /(\.{2,}|…|\s)[0-9૦-૯]{1,4}$/.test(ln.text); }).length;
    return withNum / lines.length > 0.5;
  }

  // A printed contents page becomes the book's index: each "title  page"
  // becomes an entry (two columns often share one line: "title ૧ title ૫"),
  // a line without a page number is a section heading ("[૩.૧] …"), and a
  // first line in a larger type is the page's title ("અનુક્રમણિકા").
  var PAGE_NO = /^[!?’'”"…\.,)]*([0-9૦-૯]{1,4})$/;

  function indexEntries(text, carry) {
    var out = [], words = carry ? carry.split(' ') : [];
    text.split(' ').forEach(function (tok) {
      var m = tok.match(PAGE_NO);
      if (m && words.length) {
        var lead = tok.slice(0, tok.length - m[1].length);
        var t = (words.join(' ') + (lead ? ' ' + lead : '')).replace(/[\s.…]{2,}$/, '').replace(/\s+([!?])$/, ' $1').trim();
        if (/[A-Za-z\u0A80-\u0AFF]/.test(t)) out.push({ t: t, p: m[1] });
        words = [];
      } else if (tok) words.push(tok);
    });
    return { entries: out, rest: words.join(' ') };
  }

  function indexOf(lines) {
    var sections = [], cur = null, title = '', carry = '';
    var big = Math.max.apply(null, lines.map(function (ln) { return ln.size; }));
    lines.forEach(function (ln, i) {
      var r = indexEntries(ln.text, carry);
      // "ખંડ : ૩ બુદ્ધિ" is a part heading, not an entry for page ૩
      if (r.entries.length && /:$/.test(r.entries[0].t)) r = { entries: [], rest: '' };
      if (!r.entries.length) {
        if (carry) { carry += ' ' + ln.text; return; }
        if (i === 0 && ln.size >= big - 0.5 && lines.some(function (l) { return l.size < big - 0.5; })) title = ln.text;
        else { cur = { h: ln.text, e: [] }; sections.push(cur); }
        return;
      }
      if (!cur) { cur = { h: '', e: [] }; sections.push(cur); }
      cur.e = cur.e.concat(r.entries);
      carry = r.rest;    // a title that runs on to the next line
    });
    // two columns share each line: order the entries by page, as printed column by column
    sections.forEach(function (sec) { sec.e = sec.e.map(function (e, k) { return [e, k]; }).sort(function (a, b) { return toInt(a[0].p) - toInt(b[0].p) || a[1] - b[1]; }).map(function (x) { return x[0]; }); });
    if (!title) title = lines.some(function (ln) { return /[\u0A80-\u0AFF]/.test(ln.text); }) ? 'અનુક્રમણિકા' : 'Contents';
    return { title: title, sections: sections.filter(function (s) { return s.e.length || s.h; }) };
  }

  /* ---------- columns ---------- */

  function columnBoxes(lines, bodySize) {
    var body = lines.filter(function (ln) { return Math.abs(ln.size - bodySize) < 0.6; });
    var widths = body.map(function (ln) { return Math.round(ln.x1 - ln.x0); });
    if (!widths.length) return [];
    // the most common width is a full, justified line
    var w = +mode(widths.map(function (v) { return Math.round(v / 3) * 3; }));
    var full = body.filter(function (ln) { return Math.abs(ln.x1 - ln.x0 - w) < 4; });
    if (full.length < 3) return [];
    var boxes = [];
    full.forEach(function (ln) {
      var b = boxes.filter(function (b) { return Math.abs(b.x0 - ln.x0) < 6; })[0];
      if (b) b.n++; else boxes.push({ x0: ln.x0, x1: ln.x1, n: 1 });
    });
    return boxes.filter(function (b) { return b.n >= 2; });
  }

  function boxFor(boxes, ln) {
    var c = (ln.x0 + ln.x1) / 2, best = null, bd = 1e9;
    boxes.forEach(function (b) {
      var d = c < b.x0 ? b.x0 - c : c > b.x1 ? c - b.x1 : 0;
      if (d < bd) { bd = d; best = b; }
    });
    return best;
  }

  /* ---------- main layout ---------- */

  function layoutPages(pages) {
    var fonts = analyseFonts(pages);
    var pagesLines = pages.map(function (pg) { return buildLines(pg, fonts); });
    var running = dropRunningText(pagesLines);
    pagesLines = running.pagesLines;

    // body size and font: the ones with the most characters
    var sizeChars = {}, fontChars = {};
    pagesLines.forEach(function (lines) {
      lines.forEach(function (ln) {
        var n = ln.text.length;
        sizeChars[ln.size] = (sizeChars[ln.size] || 0) + n;
        Object.keys(ln.fontChars).forEach(function (f) { fontChars[f] = (fontChars[f] || 0) + ln.fontChars[f]; });
      });
    });
    var bodySize = +Object.keys(sizeChars).sort(function (a, b) { return sizeChars[b] - sizeChars[a]; })[0] || 10;
    // A PDF can hold several copies of its text font, so every font with a
    // large share of the text counts as body text.
    var maxChars = Math.max.apply(null, Object.keys(fontChars).map(function (f) { return fontChars[f]; }).concat([1]));
    var bodyFonts = {};
    Object.keys(fontChars).forEach(function (f) { if (fontChars[f] >= maxChars * 0.15) bodyFonts[f] = 1; });

    // fonts that mostly appear inside body lines (bold labels, italics) are not heading fonts
    var inline = {}, total = {};
    pagesLines.forEach(function (lines) {
      lines.forEach(function (ln) {
        Object.keys(ln.fontChars).forEach(function (f) {
          total[f] = (total[f] || 0) + ln.fontChars[f];
          if (bodyFonts[ln.font]) inline[f] = (inline[f] || 0) + ln.fontChars[f];
        });
      });
    });
    function isDisplayFont(f) { return !bodyFonts[f] && (inline[f] || 0) / (total[f] || 1) < 0.5; }
    function headingLike(ln) {
      var ratio = ln.size / bodySize;
      return ratio >= 1.12 || (isDisplayFont(ln.font) && ratio > 0.9);
    }
    // a long run of lines in one display font at body size is a passage, not a heading
    pagesLines.forEach(function (lines) {
      var i = 0;
      while (i < lines.length) {
        if (!headingLike(lines[i])) { i++; continue; }
        var j = i + 1;
        while (j < lines.length && headingLike(lines[j]) && lines[j].font === lines[i].font &&
               Math.abs(lines[j].size - lines[i].size) < 0.6) j++;
        var big = lines[i].size / bodySize >= 1.12;
        for (var k = i; k < j; k++) lines[k].heading = big || j - i <= 4;
        i = j;
      }
    });

    var blocks = [], para = null, head = null;
    function endPara() {
      if (para && para.text) blocks.push({ t: 'p', text: para.text, page: para.page, last: para.last });
      para = null;
    }
    function endHead() {
      if (head) {
        var words = head.text.split(' ').length;
        if (words > 60) blocks.push({ t: 'p', text: head.text, page: head.page });
        else blocks.push({ t: 'h', level: head.level, text: head.text, page: head.page });
      }
      head = null;
    }

    var docBoxes = null;
    pagesLines.forEach(function (lines, pi) {
      if (isContentsPage(lines)) {
        endPara(); endHead();
        var ix = indexOf(lines), last = blocks[blocks.length - 1];
        if (!ix.sections.some(function (s) { return s.e.length; })) return;
        if (last && last.t === 'index' && last.last === pi) {
          // the index runs on from the previous page
          var first = ix.sections[0];
          if (first && !first.h && last.sections.length) { last.sections[last.sections.length - 1].e = last.sections[last.sections.length - 1].e.concat(first.e); ix.sections.shift(); }
          last.sections = last.sections.concat(ix.sections);
          last.last = pi + 1;
        } else blocks.push({ t: 'index', title: ix.title, sections: ix.sections, page: pi + 1, last: pi + 1 });
        return;
      }
      var boxes = columnBoxes(lines, bodySize);
      if (boxes.length) docBoxes = boxes; else boxes = docBoxes || [];
      var prev = null;
      lines.forEach(function (ln) {
        var ratio = ln.size / bodySize;
        if (ln.heading) {
          endPara();
          var level = ratio >= 1.35 ? 1 : 2;
          // a heading that wraps onto the next line (or column) keeps its font and size
          var same = head && head.font === ln.font && Math.abs(ln.size - head.size) < 0.6;
          if (same) head.text += ' ' + ln.text;
          else { endHead(); head = { level: level, size: ln.size, font: ln.font, text: ln.text, page: pi + 1 }; }
          prev = ln;
          return;
        }
        endHead();
        var box = boxFor(boxes, ln);
        var startNew = !para;
        if (box && !startNew) {
          var indent = ln.x0 - box.x0;
          if (indent > 0.8 * bodySize && indent < (box.x1 - box.x0) * 0.6) startNew = true;
        } else if (!box && prev && !startNew && ln.x0 - prev.x0 > 0.8 * bodySize) startNew = true;
        if (!startNew && prev && prev.y > ln.y && prev.y - ln.y > ln.size * 2.4) startNew = true;
        if (!startNew && para && para.shortEnd) startNew = true;
        if (startNew) { endPara(); para = { text: ln.text, page: pi + 1 }; }
        else para.text = joinText(para.text, ln.text);
        para.last = pi + 1;
        var pbox = box;
        para.shortEnd = pbox ? ln.x1 < pbox.x1 - 1.5 * bodySize : false;
        prev = ln;
      });
    });
    endPara(); endHead();
    var foreignChars = 0;
    Object.keys(fonts).forEach(function (k) { if (fonts[k].foreign) foreignChars += fonts[k].chars; });
    return { blocks: blocks, labels: running.labels, foreignChars: foreignChars };
  }

  function joinText(a, b) {
    if (/-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
    if (/[\u0A80-\u0AFF]-$/.test(a)) return a + b;    // રાગ- / દ્વેષ
    return a + ' ' + b;
  }

  /* ---------- browser entry ---------- */

  // pdfjsLib: the pdf.js global. data: ArrayBuffer. onProgress(done, total).
  // Resolves to { pages, title, author, doc }: the text pieces of every page.
  function readPages(pdfjsLib, data, onProgress) {
    var doc;
    return pdfjsLib.getDocument({ data: new Uint8Array(data), verbosity: 0, isEvalSupported: false }).promise.then(function (d) {
      doc = d;
      return doc.getMetadata().catch(function () { return null; });
    }).then(function (meta) {
      var pages = [], n = doc.numPages, i = 0;
      function next() {
        if (i >= n) return Promise.resolve();
        i++;
        return doc.getPage(i).then(function (pg) {
          var vp = pg.getViewport({ scale: 1 });
          return pg.getTextContent({ disableNormalization: true }).then(function (tc) {
            pages.push({
              w: vp.width, h: vp.height,
              items: tc.items.filter(function (it) { return it.str !== undefined; }).map(function (it) {
                return { s: it.str, f: it.fontName, x: it.transform[4], y: it.transform[5], size: Math.hypot(it.transform[2], it.transform[3]) || Math.abs(it.transform[3]), w: it.width };
              })
            });
            pg.cleanup();
            if (onProgress && onProgress(i, n) === false) throw new Error('cancelled');
            return next();
          });
        });
      }
      return next().then(function () {
        var info = (meta && meta.info) || {};
        return { pages: pages, title: info.Title || '', author: info.Author || '', doc: doc };
      });
    });
  }

  // Resolves to { blocks, labels, title, author, doc, pages }. labels[i] is
  // the printed page number of PDF page i + 1, or null.
  function extract(pdfjsLib, data, onProgress) {
    return readPages(pdfjsLib, data, onProgress).then(function (r) {
      var lay = layoutPages(r.pages);
      return { blocks: lay.blocks, labels: lay.labels, foreignChars: lay.foreignChars, title: r.title, author: r.author, doc: r.doc, pages: r.pages.length };
    });
  }

  var api = { layoutPages: layoutPages, readPages: readPages, extract: extract, indexEntries: indexEntries };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PdfBook = api;
})(this);
