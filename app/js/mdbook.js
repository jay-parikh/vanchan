/*
 * Reads a Markdown file into blocks ({ t: 'h' | 'p', level, text }), plus a
 * title and author.
 *
 * A single "# Title" at the top is the book's title, so "##" headings become
 * chapters and "###" the card titles. Otherwise "#" is a chapter and every
 * deeper heading a card title. Inline formatting (bold, links, code) is
 * dropped, list items and table rows become paragraphs of their own.
 */
(function (root) {
  'use strict';

  function inline(s) {
    return s
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')              // images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')            // [text](url)
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')           // [text][ref]
      .replace(/<(https?:[^>\s]+)>/g, '$1')
      .replace(/<\/?[A-Za-z][^>]*>/g, '')                 // html tags
      .replace(/`+([^`]*)`+/g, '$1')
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
      .replace(/(^|[^\w*])[*_](?=\S)([^*_]*?\S)[*_](?!\w)/g, '$1$2')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/\\([\\`*_{}\[\]()#+\-.!|>~])/g, '$1')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function frontMatter(lines, meta) {
    if (!/^---\s*$/.test(lines[0] || '')) return 0;
    for (var i = 1; i < lines.length && i < 60; i++) {
      if (/^(---|\.\.\.)\s*$/.test(lines[i])) {
        lines.slice(1, i).forEach(function (l) {
          var m = l.match(/^(title|author)\s*:\s*(.+)$/i);
          if (m) meta[m[1].toLowerCase()] = m[2].replace(/^["']|["']$/g, '').trim();
        });
        return i + 1;
      }
    }
    return 0;
  }

  function parse(text) {
    var lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
    var meta = { title: '', author: '' };
    var raw = [], para = [], fence = null, code = [];

    function endPara() {
      if (para.length) raw.push({ t: 'p', text: inline(para.join(' ')) });
      para = [];
    }

    for (var i = frontMatter(lines, meta); i < lines.length; i++) {
      var l = lines[i], m;
      if (fence) {
        if (l.trim().indexOf(fence) === 0) { raw.push({ t: 'p', text: code.join(' ').replace(/\s+/g, ' ').trim() }); fence = null; code = []; }
        else code.push(l);
        continue;
      }
      if ((m = l.match(/^\s{0,3}(```+|~~~+)/))) { endPara(); fence = m[1]; continue; }
      if (!l.trim()) { endPara(); continue; }
      if ((m = l.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/))) {
        endPara();
        raw.push({ t: 'h', depth: m[1].length, text: inline(m[2]) });
        continue;
      }
      // "Title" underlined with === or ---
      if (para.length === 1 && /^\s{0,3}(=+|-+)\s*$/.test(l)) {
        raw.push({ t: 'h', depth: l.trim()[0] === '=' ? 1 : 2, text: inline(para[0]) });
        para = [];
        continue;
      }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { endPara(); continue; }   // a rule
      if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l)) continue; // table divider
      if (/^\s*\|.*\|\s*$/.test(l)) {
        endPara();
        var cells = l.trim().replace(/^\||\|$/g, '').split('|').map(inline).filter(Boolean);
        if (cells.length) raw.push({ t: 'p', text: cells.join(' · '), li: true });
        continue;
      }
      l = l.replace(/^\s{0,3}(>\s?)+/, '');                                  // block quote
      if ((m = l.match(/^\s*([-*+]|(\d{1,3})[.)])\s+(.*)$/))) {
        endPara();
        para = [(m[2] ? m[2] + '. ' : '• ') + m[3]];
        endPara();
        raw[raw.length - 1].li = true;
        continue;
      }
      // a wrapped line of the list item above
      if (/^\s{2,}\S/.test(lines[i]) && !para.length && raw.length && raw[raw.length - 1].li) {
        raw[raw.length - 1].text += ' ' + inline(l);
        continue;
      }
      para.push(l.trim());
    }
    if (fence && code.length) raw.push({ t: 'p', text: code.join(' ').replace(/\s+/g, ' ').trim() });
    endPara();

    raw = raw.filter(function (b) { return b.text; });
    var heads = raw.filter(function (b) { return b.t === 'h'; });
    var h1s = heads.filter(function (b) { return b.depth === 1; });
    // one "#" heading before any text: the book's title
    var shift = h1s.length === 1 &&
      raw.slice(0, raw.indexOf(h1s[0])).every(function (b) { return b.t === 'h'; });
    if (shift) {
      if (!meta.title) meta.title = h1s[0].text;
      raw.splice(raw.indexOf(h1s[0]), 1);
    }
    var top = Math.min.apply(null, raw.filter(function (b) { return b.t === 'h'; }).map(function (b) { return b.depth; }).concat([9]));
    var blocks = raw.map(function (b) {
      if (b.t === 'h') return { t: 'h', level: b.depth === top ? 1 : 2, text: b.text };
      return b.li ? { t: 'p', text: b.text, li: true } : { t: 'p', text: b.text };
    });
    return { blocks: blocks, title: meta.title, author: meta.author };
  }

  // data: ArrayBuffer of the file
  function extract(data) {
    var text = new TextDecoder('utf-8').decode(new Uint8Array(data));
    return Promise.resolve(parse(text));
  }

  var api = { parse: parse, extract: extract, inline: inline };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MdBook = api;
})(this);
