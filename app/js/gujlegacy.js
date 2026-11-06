/*
 * Converts text set in old (pre-Unicode) Gujarati fonts to Unicode.
 *
 * Fonts such as Krishna, Chitra, Girdhar and Dwarika put Gujarati glyphs in
 * the slots of Latin letters, so a PDF made with them extracts as text like
 * "ØëØëlí" instead of "દાદાશ્રી". The glyphs are stored in visual order: the
 * short-i sign comes before its consonant, the reph (the small ર above a
 * letter) comes after its syllable, and many letters are drawn as a "half"
 * glyph followed by the aa-sign stroke.
 *
 * Text arrives from pdf.js either as Windows-1252 characters or as Mac Roman
 * glyph names, depending on how the PDF was made. Both are first turned back
 * into the font's byte codes (shown here as Windows-1252 characters).
 */
(function (root) {
  'use strict';

  var CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F' +
    '\u0090‘’“”•–—˜™š›œ\u009DžŸ';
  var MAC_HIGH = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

  // byte code (0x80..0xFF) <-> character, for both code pages
  var CP_CHAR = [], MAC_CODE = {}, CP_CODE = {};
  (function () {
    var i;
    for (i = 0; i < 32; i++) CP_CHAR[i] = CP1252_HIGH.charAt(i);
    for (i = 32; i < 128; i++) CP_CHAR[i] = String.fromCharCode(0x80 + i);
    for (i = 0; i < 128; i++) {
      MAC_CODE[MAC_HIGH.charAt(i)] = 0x80 + i;
      CP_CODE[CP_CHAR[i]] = 0x80 + i;
    }
    // older Mac Roman tables and pdf.js glyph-name quirks
    MAC_CODE['¤'] = 0xDB;
    MAC_CODE['Ω'] = 0xBD;
    MAC_CODE['Δ'] = 0xC6;
  })();

  // Markers used between mapping and reordering
  var I_PRE = '';     // short-i sign typed before its consonant
  var I_PRE_M = '';   // short-i sign + anusvara, typed before
  var REPH = '';      // reph, typed after its syllable
  var REPH_M = '';    // reph + anusvara, typed after

  var H = '્'; // virama

  // Glyph table, keyed by the Windows-1252 view of each byte code.
  // A trailing virama marks a "half" glyph; the following aa-stroke (ë)
  // completes it into the full letter.
  var MAP = {
    '"': 'ૅ', '*': REPH_M, '<': 'ુ', '>': 'ૂ', '@': 'ક' + H,
    'A': 'ખ' + H, 'B': 'ગ' + H, 'C': 'ઘ' + H, 'E': 'ચ' + H, 'F': 'જ' + H,
    'H': 'ણ' + H, 'I': 'ત' + H, 'J': 'થ' + H, 'K': 'ધ' + H, 'L': 'ન' + H,
    'M': 'પ' + H, 'N': 'ફ' + H, 'O': 'બ' + H, 'P': 'ભ' + H, 'Q': 'મ' + H,
    'S': 'લ' + H, 'T': 'વ' + H, 'U': 'શ' + H, 'V': 'સ' + H, 'W': 'ષ' + H,
    'Y': 'ળ' + H, 'Z': 'ક્ષ' + H, '\\': 'ુ', '^': 'ૂ', '_': 'ં',
    'a': 'ી' + REPH, 'b': 'ણુ', 'd': 'ફુ', 'e': 'ફૂ', 'f': 'શ' + H, 'g': I_PRE_M,
    'h': 'ત્ર' + H, 'i': 'જ્ઞ' + H, 'k': 'ત્ત' + H, 'l': 'શ્ર', 'o': 'ં', 'p': 'ષ્ટ',
    'q': 'ષ્ઠ', 'r': 'શ્વ', 't': 'દ્દ', 'u': '્ય', 'v': 'રુ', 'w': 'રૂ', 'x': 'હૃ',
    'y': 'ક્ક', 'z': 'દ્ય', '{': 'ઝ', '|': 'ટ્ટ',
    '\u2020': '+', '\u00F4': REPH_M, '\u00A5': 'દ્મ',
    'j': 'સ્ત્ર' + H, '\u00F8': 'ન્ન' + H, 'R': '્ય' + H, '\u2018': 'શ્ન',
    '`': 'ી' + REPH_M, '\u201E': '%', '\u0178': 'ૐ',
    '\u008D': 'શ્ચ', '\u008F': 'હ્ય' + H, '›': 'હ્મ', '‹': 'હૃ',
    '¦': 'દ્વ', '§': 'ઠ્ઠ', '©': 'દ્ધ', 'ª': 'ઉં', '¬': 'ઊં',
    '\u00AD': 'પ્ર', '°': 'જી', '±': 'અ', '²': 'ૃ', '³': 'ઇ',
    '´': 'ઈ', 'µ': 'ઉ', '¶': 'ઊ', '·': 'ઋ', '¹': 'ઇં',
    'º': 'ઈં', '\u00BC': 'દ્ર', '½': 'જા', '¿': 'ક્ર',
    'À': 'ક', 'Á': 'ફ્ર', 'Â': 'ખ', 'Ã': 'ગ', 'Ä': 'દ્ર', 'Ç': 'ચ', 'È': 'છ',
    'É': 'જ', 'Ë': 'ટ', 'Ì': 'ઠ', 'Í': 'ડ', 'Î': 'ફ', 'Ï': 'ઢ', 'Ñ': 'ઃ',
    'Ò': '‘', 'Ó': '’', 'Ô': 'ધ', 'Õ': 'પ', 'Ö': 'ત', '×': 'થ', 'Ø': 'દ',
    'Ù': 'ીં', 'Ú': 'બ', 'Û': 'ભ', 'Ü': 'મ', 'Ý': 'ય', 'Þ': 'ન', 'ß': 'ર',
    'á': 'લ', 'â': 'ળ', 'ã': I_PRE, 'ä': 'વ', 'å': 'શ', 'æ': 'ષ', 'ç': 'સ',
    'è': 'હ', 'ë': 'ા', 'ì': I_PRE, 'í': 'ી', 'î': 'ં', 'ï': '', 'ð': 'ુ',
    'ñ': 'ૂ', 'ò': 'ૃ', 'ó': REPH, 'õ': 'ે', 'ö': 'ૈ', '÷': 'ૅ', 'ù': 'ો',
    'ú': 'ૌ', 'û': H, 'ý': REPH, 'þ': '્ર', 'ÿ': '્ર'
  };
  var DIGITS = '૦૧૨૩૪૫૬૭૮૯';
  for (var d = 0; d < 10; d++) MAP[String(d)] = DIGITS.charAt(d);

  var CONS = 'કખગઘઙચછજઝઞટઠડઢણતથદધનપફબભમયરલળવશષસહ';
  function isCons(c) { return CONS.indexOf(c) >= 0; }
  function isSign(c) { // dependent vowel signs, anusvara, visarga, candrabindu, nukta
    var n = c.charCodeAt(0);
    return (n >= 0x0ABC && n <= 0x0ACC) || n === 0x0A81 || n === 0x0A82 || n === 0x0A83 || n === 0x0AE2 || n === 0x0AE3;
  }

  // Start index of the consonant cluster (C virama)* C that ends at `end`.
  function clusterStart(s, end) {
    var i = end;
    while (i >= 2 && s[i - 1] === H && isCons(s[i - 2])) i -= 2;
    return i;
  }

  function reorder(chars) {
    var out = [], i, j, c;
    // 1. short-i sign: move it after the next consonant cluster
    for (i = 0; i < chars.length; i++) {
      c = chars[i];
      if (c === I_PRE || c === I_PRE_M) {
        j = i + 1;
        while (j < chars.length && (chars[j] === I_PRE || chars[j] === '')) j++;
        var k = j;
        while (k < chars.length && isCons(chars[k])) {
          if (chars[k + 1] === H && isCons(chars[k + 2])) k += 2;
          else { k++; break; }
        }
        if (k > j) {
          // a nukta stays with its consonant
          while (k < chars.length && chars[k] === '઼') k++;
          for (var m = j; m < k; m++) out.push(chars[m]);
          out.push('િ');
          if (c === I_PRE_M) out.push('ં');
          i = k - 1;
        } else {
          out.push('િ');
          if (c === I_PRE_M) out.push('ં');
        }
      } else out.push(c);
    }
    // 2. reph: move ર્ in front of the syllable it follows
    var res = [];
    for (i = 0; i < out.length; i++) {
      c = out[i];
      if (c === REPH || c === REPH_M) {
        var e = res.length;
        while (e > 0 && isSign(res[e - 1])) e--;
        if (e > 0 && isCons(res[e - 1])) {
          var st = clusterStart(res, e - 1);
          res.splice(st, 0, 'ર', H);
        } else res.push('ર', H);
        if (c === REPH_M) res.push('ં');
      } else res.push(c);
    }
    return res;
  }

  function normalize(s) {
    return s
      .replace(/્્+/g, H)
      .replace(/્ા/g, '')        // half glyph + aa-stroke = full letter
      .replace(/્ો/g, 'ે')  // half glyph + o-sign = e-sign
      .replace(/્ૉ/g, 'ૅ')
      .replace(/્([ૃુૂ])/g, '$1')
      .replace(/ાે/g, 'ો').replace(/ાૈ/g, 'ૌ').replace(/ાૅ/g, 'ૉ')
      .replace(/અા/g, 'આ').replace(/અે/g, 'એ').replace(/અૈ/g, 'ઐ')
      .replace(/અો/g, 'ઓ').replace(/અૌ/g, 'ઔ').replace(/અૉ/g, 'ઑ').replace(/અૅ/g, 'ઍ')
      .replace(/આે/g, 'ઓ').replace(/આૈ/g, 'ઔ').replace(/આૅ/g, 'ઑ')
      .replace(/([ઁ-ઃ])([ા-ૌ])/g, '$2$1') // anusvara typed before a vowel sign
      // signs printed twice (overprinting in the PDF)
      .replace(/([\u0A81-\u0A83\u0ABE-\u0ACC])\1+/g, '$1')
      .replace(/\u0ACB\u0AC7/g, '\u0ACB')
      .replace(/[ \t]+/g, ' ');
  }

  /** Convert a string already in Windows-1252 byte view. */
  function convertBytes(str) {
    // on its own, the visarga glyph is the colon in "પ્રશ્નકર્તા :"
    str = str.replace(/(^|\s)\u00D1(?=\s|$)/g, '$1:');
    var chars = [];
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      var m = MAP[ch];
      if (m === undefined) chars.push(ch);
      else for (var j = 0; j < m.length; j++) chars.push(m.charAt(j));
      if (m === '') chars.push('');
    }
    chars = chars.filter(function (c) { return c !== ''; });
    // half glyph + aa-stroke must merge before the short-i sign looks for its consonant
    var joined = chars.join('').replace(/્ા/g, '');
    return normalize(reorder(Array.from ? Array.from(joined) : joined.split('')).join(''))
      .replace(/([ક-હ])%/g, '$1્રુ');   // after a letter, % is the ્રુ glyph (ટ્રુથ)
  }

  /** Turn pdf.js text back into the font's byte view. mac=true for Mac Roman glyph names. */
  function toByteView(str, mac) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      if (ch === 'μ') ch = 'µ';
      if (mac) {
        var code = MAC_CODE[ch];
        out += code ? CP_CHAR[code - 0x80] : ch;
      } else out += ch;
    }
    return out;
  }

  /** Score how a font's text looks: >0 means Mac Roman view. */
  function macScore(str) {
    var s = 0;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      var m = ch in MAC_CODE, c = ch in CP_CODE;
      if (m && !c) s++;
      else if (c && !m) s--;
    }
    return s;
  }

  /** Guess whether a font holds legacy Gujarati, from a sample of its text. */
  function looksLegacy(sample) {
    if (/[\u0A80-\u0AFF]/.test(sample)) return false;
    // A font subset holding only one or two glyphs (pdf.js reports these as
    // C1 control characters or a Greek mu) also belongs to the legacy text.
    var hi = 0, odd = 0, letters = 0;
    for (var i = 0; i < sample.length; i++) {
      var n = sample.charCodeAt(i);
      if (n > 32) letters++;
      if (n >= 0x80 && (n <= 0xFF || sample.charAt(i) in MAC_CODE)) hi++;
      if ((n >= 0x80 && n <= 0x9F) || n === 0x03BC) odd++;
    }
    if (letters && odd / letters > 0.5) return true;
    return letters > 20 && hi / letters > 0.3;
  }

  /**
   * Share of a font's high (non-ASCII) codes that this table does not know,
   * from its text in byte view. Krishna-family fonts stay under 1%; another
   * old font, such as the Hindi Chanakya, is around 25%.
   */
  function unknownShare(bytes) {
    var hi = 0, unk = 0;
    for (var i = 0; i < bytes.length; i++) {
      var ch = bytes.charAt(i);
      if (ch.charCodeAt(0) < 0x80) continue;
      hi++;
      if (MAP[ch] === undefined) unk++;
    }
    return { share: hi ? unk / hi : 0, count: unk };
  }

  var api = {
    convertBytes: convertBytes,
    toByteView: toByteView,
    macScore: macScore,
    looksLegacy: looksLegacy,
    unknownShare: unknownShare,
    _map: MAP,
    convert: function (str, mac) { return convertBytes(toByteView(str, mac)); }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GujLegacy = api;
})(this);
