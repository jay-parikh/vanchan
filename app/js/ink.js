/*
 * Pen drawing on a canvas, shared by the three places the reader can draw:
 * over a card, over a PDF page, and in a hand-written note.
 *
 * Strokes are stored relative to the surface's width (0–10000 across it; y
 * in the same units, so a page or card that grows taller doesn't move them),
 * delta-encoded, so a drawing looks the same at any zoom or screen size and
 * stays small: { c: colour, t: 'p' pen | 'h' highlighter, d: [x0, y0, dx1,
 * dy1, …] }. Line widths are a share of the surface width.
 *
 * Input: an Apple Pencil (pointerType "pen") always draws; once one has been
 * used, a finger scrolls instead (palm rejection). Without a pen a finger or
 * the mouse draws, and two fingers scroll (a second finger cancels the stroke
 * the first one began). The "Scroll" tool (t: 's') lets one finger scroll:
 * the app then lets touches through the layer (class "scrolling").
 */
(function (root) {
  'use strict';

  var SCALE = 10000;
  var WIDTH = { p: 0.0065, h: 0.04 };          // share of the surface width
  var HL_COLOR = 'rgba(245, 205, 70, 0.45)';
  var penSeen = false;                          // a pen was used on this device

  function encode(pts, w, h) {
    var d = [], px = 0, py = 0;
    pts.forEach(function (p, i) {
      var x = Math.round(p[0] / w * SCALE), y = Math.round(p[1] / w * SCALE);
      if (i && x === px && y === py) return;
      d.push(i ? x - px : x, i ? y - py : y);
      px = x; py = y;
    });
    return d;
  }

  function decode(d, w, h) {
    var pts = [], x = 0, y = 0;
    for (var i = 0; i + 1 < d.length; i += 2) {
      x += d[i]; y += d[i + 1];
      pts.push([x / SCALE * w, y / SCALE * w]);
    }
    return pts;
  }

  function paintStroke(ctx, s, w, h) {
    var p = decode(s.d, w, h), i;
    if (!p.length) return;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = s.t === 'h' ? HL_COLOR : s.c;
    ctx.lineWidth = Math.max(1.2, (WIDTH[s.t] || WIDTH.p) * w);
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    if (p.length < 3) ctx.lineTo(p[p.length - 1][0] + 0.1, p[p.length - 1][1] + 0.1);
    else {
      for (i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
      ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Draws strokes onto a canvas of CSS size w × h (sharp on high-DPI screens).
  function paint(canvas, strokes, w, h) {
    var dpr = Math.min(root.devicePixelRatio || 1, 3);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    (strokes || []).forEach(function (s) { paintStroke(ctx, s, w, h); });
  }

  // A small picture of a drawing, as a data URL (for lists).
  function thumbnail(strokes, aspect, width) {
    var c = document.createElement('canvas'), w = width || 120, h = Math.round(w * (aspect || 1));
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    (strokes || []).forEach(function (s) { paintStroke(ctx, s, w, h); });
    try { return c.toDataURL('image/png'); } catch (e) { return ''; }
  }

  /*
   * Makes a canvas drawable. opts:
   *   size()      -> [w, h] CSS px of the surface right now
   *   tool()      -> { t: 'p' | 'h' | 'e' (eraser), c: colour }
   *   strokes     initial strokes (copied)
   *   onChange(strokes)  after every finished stroke, erase or undo
   *   onScroll(dy, dx)   two-finger drag (to scroll what is under the layer)
   * Returns { strokes(), undo(), canUndo(), redraw(), destroy() }.
   */
  function surface(canvas, opts) {
    var strokes = (opts.strokes || []).slice(), history = [], cur = null, erasing = false, curPts = null;
    var two = null, active = {}, multi = false;

    function size() { return opts.size(); }
    function redraw() {
      var s = size(), all = cur ? strokes.concat([cur]) : strokes;
      paint(canvas, all, s[0], s[1]);
    }
    function pos(e) {
      var r = canvas.getBoundingClientRect(), s = size();
      return [(e.clientX - r.left) * (s[0] / r.width), (e.clientY - r.top) * (s[1] / r.height)];
    }
    function eraseAt(p) {
      var s = size(), r = 14, before = strokes.length;
      strokes = strokes.filter(function (st) {
        return !decode(st.d, s[0], s[1]).some(function (q) { return Math.abs(q[0] - p[0]) < r && Math.abs(q[1] - p[1]) < r; });
      });
      if (strokes.length !== before) redraw();
      return strokes.length !== before;
    }
    function draws(e) {
      if (e.pointerType === 'pen') { penSeen = true; canvas.style.touchAction = 'pan-y'; return true; }
      if (e.pointerType === 'touch') return !penSeen;
      return e.button === 0 || e.buttons === 1 || e.pointerType === 'mouse';
    }

    function down(e) {
      if (!draws(e)) return;
      active[e.pointerId] = 1;
      // a second finger: this is a scroll, not a stroke
      if (Object.keys(active).length > 1) {
        multi = true;
        if (erasing) { strokes = history.pop() || strokes; erasing = false; }
        cur = null; curPts = null; redraw();
        return;
      }
      if (multi || opts.tool().t === 's') return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* old browsers */ }
      var tool = opts.tool(), p = pos(e);
      if (tool.t === 'e') { history.push(strokes.slice()); erasing = { changed: eraseAt(p) }; return; }
      curPts = [p];
      var s = size();
      cur = { c: tool.c, t: tool.t, d: encode(curPts, s[0], s[1]) };
      redraw();
    }
    function move(e) {
      if (multi) return;
      if (erasing) { if (eraseAt(pos(e))) erasing.changed = true; return; }
      if (!cur) return;
      e.preventDefault();
      var list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      list.forEach(function (ev) { curPts.push(pos(ev)); });
      var s = size();
      cur.d = encode(curPts, s[0], s[1]);
      redraw();
    }
    function up(e) {
      delete active[e.pointerId];
      if (multi) { if (!Object.keys(active).length) multi = false; return; }
      if (erasing) {
        var changed = erasing.changed;
        erasing = false;
        if (changed) opts.onChange(strokes.slice()); else history.pop();
        return;
      }
      if (!cur) return;
      history.push(strokes.slice());
      if (cur.d.length >= 2) strokes.push(cur);
      cur = null; curPts = null;
      redraw();
      opts.onChange(strokes.slice());
    }
    // two fingers scroll the card while one finger draws
    function mid(e) { return [(e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2]; }
    function tstart(e) { if (e.touches.length === 2) { two = mid(e); multi = true; cur = null; curPts = null; redraw(); } }
    function tmove(e) {
      if (e.touches.length !== 2 || two === null) return;
      var m = mid(e);
      if (opts.onScroll) opts.onScroll(two[1] - m[1], two[0] - m[0]);
      two = m;
      e.preventDefault();
    }
    function tend(e) { if (e.touches.length < 2) two = null; }

    canvas.style.touchAction = penSeen ? 'pan-y' : 'none';
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('touchstart', tstart, { passive: true });
    canvas.addEventListener('touchmove', tmove, { passive: false });
    canvas.addEventListener('touchend', tend, { passive: true });
    redraw();

    return {
      strokes: function () { return strokes.slice(); },
      canUndo: function () { return history.length > 0; },
      undo: function () {
        if (!history.length) return;
        strokes = history.pop();
        redraw();
        opts.onChange(strokes.slice());
      },
      redraw: redraw,
      destroy: function () {
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        canvas.removeEventListener('touchstart', tstart);
        canvas.removeEventListener('touchmove', tmove);
        canvas.removeEventListener('touchend', tend);
      }
    };
  }

  var api = { encode: encode, decode: decode, paint: paint, thumbnail: thumbnail, surface: surface, HL_COLOR: HL_COLOR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ink = api;
})(this);
