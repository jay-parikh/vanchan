/*
 * Reads an EPUB into blocks ({ t: 'h' | 'p', level, text }), plus title,
 * author and cover image. Needs JSZip and DOMParser.
 */
(function (root) {
  'use strict';

  var BLOCK = /^(p|div|li|blockquote|pre|dd|dt|td|th|figcaption|section|article|aside|header|footer|ul|ol|dl|table|tbody|tr|h[1-6]|hr|nav|figure|center)$/;
  var SKIP = /^(script|style|nav|head|svg|math|rt|rp|noscript|aside)$/;
  // "(પા. ૬)" and similar printed-page markers; they mark where a page of the
  // printed book starts
  var PAGE_MARK = /^\(?\s*(?:પા|પાન|પાનું|પૃ|પૃષ્ઠ|પેજ|page|pg|p)\s*\.?\s*([0-9૦-૯]+)\s*\)?$/i;

  function dirOf(path) { var i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i + 1); }

  function resolve(base, href) {
    href = decodeURIComponent(href.split('#')[0]);
    var parts = (dirOf(base) + href).split('/'), out = [];
    parts.forEach(function (p) {
      if (p === '..') out.pop();
      else if (p !== '.' && p !== '') out.push(p);
    });
    return out.join('/');
  }

  function parseXml(text, type) {
    var doc = new DOMParser().parseFromString(text, type || 'application/xml');
    if (doc.getElementsByTagName('parsererror').length && type !== 'text/html') {
      doc = new DOMParser().parseFromString(text, 'text/html');
    }
    return doc;
  }

  function byLocal(el, name) {
    var all = el.getElementsByTagName('*'), out = [];
    for (var i = 0; i < all.length; i++) if ((all[i].localName || all[i].nodeName).toLowerCase() === name) out.push(all[i]);
    return out;
  }

  function clean(s) { return s.replace(/[ \s]+/g, ' ').trim(); }

  // Walk the body and emit headings and paragraphs in reading order.
  // state.label carries the current printed page across chapter files.
  function walk(body, blocks, state) {
    var buf = '';
    function flush() {
      var t = clean(buf);
      buf = '';
      if (!t) return;
      var m = t.match(PAGE_MARK);
      if (m) state.label = m[1];
      else blocks.push({ t: 'p', text: t, label: state.label });
    }
    function visit(node) {
      if (node.nodeType === 3) { buf += node.nodeValue; return; }
      if (node.nodeType !== 1) return;
      var name = (node.localName || node.nodeName).toLowerCase();
      if (SKIP.test(name)) return;
      if (name === 'br') { buf += ' '; return; }
      if (name === 'img') return;
      var h = name.match(/^h([1-6])$/);
      if (h) {
        flush();
        var t = clean(node.textContent), m = t.match(PAGE_MARK);
        if (m) state.label = m[1];
        else if (t) blocks.push({ t: 'h', level: h[1] === '1' ? 1 : 2, text: t, label: state.label });
        return;
      }
      var isBlock = BLOCK.test(name);
      if (isBlock) flush();
      for (var c = node.firstChild; c; c = c.nextSibling) visit(c);
      if (isBlock) flush();
    }
    visit(body);
    flush();
  }

  // share of a document's text that sits inside links (a contents page)
  function linkShare(body) {
    var all = clean(body.textContent).length || 1, inLinks = 0;
    byLocal(body, 'a').forEach(function (a) { inLinks += clean(a.textContent).length; });
    return inLinks / all;
  }

  function imageDataUrl(blob, maxW) {
    return new Promise(function (resolveP) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxW / img.width), c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        try { resolveP(c.toDataURL('image/jpeg', 0.8)); } catch (e) { resolveP(''); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolveP(''); };
      img.src = url;
    });
  }

  function extract(JSZip, data, onProgress) {
    var zip, opfPath, opf, manifest = {}, spine = [], meta = {};
    return JSZip.loadAsync(data).then(function (z) {
      zip = z;
      var c = zip.file('META-INF/container.xml');
      if (!c) throw new Error('This file is not a valid EPUB (no container.xml).');
      return c.async('string');
    }).then(function (xml) {
      var rf = byLocal(parseXml(xml), 'rootfile')[0];
      opfPath = rf && rf.getAttribute('full-path');
      if (!opfPath || !zip.file(opfPath)) throw new Error('This EPUB has no package file.');
      return zip.file(opfPath).async('string');
    }).then(function (xml) {
      opf = parseXml(xml);
      byLocal(opf, 'item').forEach(function (it) {
        manifest[it.getAttribute('id')] = {
          href: resolve(opfPath, it.getAttribute('href') || ''),
          type: it.getAttribute('media-type') || '',
          props: it.getAttribute('properties') || ''
        };
      });
      byLocal(opf, 'itemref').forEach(function (r) {
        var it = manifest[r.getAttribute('idref')];
        if (it && !/\bnav\b/.test(it.props)) spine.push(it);
      });
      var t = byLocal(opf, 'title')[0], a = byLocal(opf, 'creator')[0], l = byLocal(opf, 'language')[0];
      meta.title = t ? clean(t.textContent) : '';
      meta.author = a ? clean(a.textContent) : '';
      meta.lang = l ? clean(l.textContent) : '';
      var blocks = [], i = 0, state = { label: null };
      function next() {
        if (i >= spine.length) return Promise.resolve(blocks);
        var it = spine[i++];
        var f = zip.file(it.href);
        if (onProgress) onProgress(i, spine.length);
        if (!f || !/html|xml/.test(it.type || 'html')) return next();
        return f.async('string').then(function (html) {
          var doc = parseXml(html, /html/.test(it.type) && !/xhtml/.test(it.type) ? 'text/html' : 'application/xhtml+xml');
          var body = doc.body || byLocal(doc, 'body')[0];
          if (body && linkShare(body) < 0.5) walk(body, blocks, state);
          return next();
        });
      }
      return next();
    }).then(function (blocks) {
      meta.blocks = blocks;
      return findCover(zip, opf, manifest);
    }).then(function (blob) {
      return blob ? imageDataUrl(blob, 360) : '';
    }).then(function (cover) {
      meta.cover = cover;
      return meta;
    });
  }

  function findCover(zip, opf, manifest) {
    var item = null;
    Object.keys(manifest).forEach(function (id) { if (/cover-image/.test(manifest[id].props)) item = manifest[id]; });
    if (!item) {
      byLocal(opf, 'meta').forEach(function (m) {
        if (m.getAttribute('name') === 'cover' && manifest[m.getAttribute('content')]) item = manifest[m.getAttribute('content')];
      });
    }
    if (!item) {
      Object.keys(manifest).forEach(function (id) {
        if (!item && /^image\//.test(manifest[id].type) && /cover/i.test(id + manifest[id].href)) item = manifest[id];
      });
    }
    if (!item || !/^image\//.test(item.type) || !zip.file(item.href)) return Promise.resolve(null);
    return zip.file(item.href).async('blob').then(function (b) { return new Blob([b], { type: item.type }); });
  }

  var api = { extract: extract, walk: walk };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EpubBook = api;
})(this);
