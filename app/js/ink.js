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
 * The highlighter draws like a marker: a stroke that runs along a line of text
 * becomes one straight, even band (the hand's wobble taken out), any other
 * stroke is smoothed, and all highlights are painted as one layer, so where
 * they cross or go back over themselves the colour stays the same.
 *
 * Input: an Apple Pencil (pointerType "pen") always draws. Once one has been
 * used on this device, a finger or palm never draws: while the pen is down,
 * touches are ignored altogether (palm rejection), and two fingers scroll.
 * Without a pen a finger or the mouse draws, and two fingers scroll (a second
 * finger cancels the stroke the first one began). Only the pointer that began
 * a stroke adds to it. The browser never pans the layer itself (touch-action
 * none), so a pen stroke is never taken for a scroll. The "Move" tool (t: 's')
 * lets one finger scroll: the app then lets touches through the layer (class
 * "scrolling").
 */
(function (root) {
  'use strict';

  var SCALE = 10000;
  var WIDTH = { p: 0.0065, h: 0.04 };          // share of the surface width
  var HL_COLOR = 'rgba(245, 205, 70, 0.45)';
  var HL_SOLID = 'rgb(245, 205, 70)', HL_ALPHA = 0.45;
  var penSeen = false;                          // a pen was used on this device
  try { penSeen = root.localStorage.getItem('vanchan-pen') === '1'; } catch (x) { /* storage blocked */ }
  function sawPen() {
    if (penSeen) return;
    penSeen = true;
    try { root.localStorage.setItem('vanchan-pen', '1'); } catch (x) { /* storage blocked */ }
  }

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

  // A highlighter stroke as it is kept: straight along a line of text, or smoothed.
  // pts are in CSS px; w is the surface width.
  function shapeHighlight(pts, w) {
    if (pts.length < 2) return pts;
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var band = WIDTH.h * w;
    if (maxY - minY <= band * 1.5 && maxX - minX >= Math.max(band, (maxY - minY) * 2)) {
      var mid = ys.slice().sort(function (a, b) { return a - b; })[ys.length >> 1];   // the line it follows (a hook at either end doesn't move it)
      return pts[0][0] <= pts[pts.length - 1][0] ? [[minX, mid], [maxX, mid]] : [[maxX, mid], [minX, mid]];
    }
    // not along a line (a circle, a mark in the margin): take the shake out
    return pts.map(function (p, i) {
      var sx = 0, sy = 0, n = 0;
      for (var j = Math.max(0, i - 3); j <= Math.min(pts.length - 1, i + 3); j++) { sx += pts[j][0]; sy += pts[j][1]; n++; }
      return i === 0 || i === pts.length - 1 ? p : [sx / n, sy / n];
    });
  }

  function paintStroke(ctx, s, w, h, color) {
    var p = decode(s.d, w, h), i;
    if (!p.length) return;
    ctx.save();
    ctx.lineCap = s.t === 'h' ? 'butt' : 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = color || (s.t === 'h' ? HL_COLOR : s.c);
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

  // Highlights first, all in one see-through layer (crossings don't darken), then the pen on top.
  var hlLayer = null;
  function paintAll(ctx, strokes, w, h, pw, ph, scale) {
    var hl = (strokes || []).filter(function (s) { return s.t === 'h'; });
    if (hl.length) {
      hlLayer = hlLayer || document.createElement('canvas');
      if (hlLayer.width !== pw || hlLayer.height !== ph) { hlLayer.width = pw; hlLayer.height = ph; }
      var hc = hlLayer.getContext('2d');
      hc.setTransform(1, 0, 0, 1, 0, 0);
      hc.clearRect(0, 0, pw, ph);
      hc.setTransform(scale, 0, 0, scale, 0, 0);
      hl.forEach(function (s) { paintStroke(hc, s, w, h, HL_SOLID); });
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = HL_ALPHA;
      ctx.drawImage(hlLayer, 0, 0);
      ctx.restore();
    }
    (strokes || []).forEach(function (s) { if (s.t !== 'h') paintStroke(ctx, s, w, h); });
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
    paintAll(ctx, strokes, w, h, canvas.width, canvas.height, dpr);
  }

  // A small picture of a drawing, as a data URL (for lists).
  function thumbnail(strokes, aspect, width) {
    var c = document.createElement('canvas'), w = width || 120, h = Math.round(w * (aspect || 1));
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    paintAll(ctx, strokes, w, h, w, h, 1);
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
    var owner = null, penDown = false;            // the pointer drawing now; is it a pen

    function size() { return opts.size(); }
    function redraw() {
      var s = size(), all = cur ? strokes.concat([cur]) : strokes;
      paint(canvas, all, s[0], s[1]);
    }
    function pos(e) {
      var r = canvas.getBoundingClientRect(), s = size();
      return [(e.clientX - r.left) * (s[0] / r.width), (e.clientY - r.top) * (s[1] / r.height)];
    }
    // is p within r of the segment a–b
    function near(p, a, b, r) {
      var dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
      var t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
      var x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
      return x * x + y * y < r * r;
    }
    function shaped() { return cur.t === 'h' ? shapeHighlight(curPts, size()[0]) : curPts; }
    function eraseAt(p) {
      var s = size(), r = 14, before = strokes.length;
      strokes = strokes.filter(function (st) {
        var q = decode(st.d, s[0], s[1]);
        var reach = st.t === 'h' ? r + WIDTH.h * s[0] / 2 : r;
        for (var i = 0; i < q.length; i++) if (near(p, q[i], q[i + 1] || q[i], reach)) return false;
        return true;
      });
      if (strokes.length !== before) redraw();
      return strokes.length !== before;
    }
    function draws(e) {
      if (e.pointerType === 'pen') { sawPen(); return true; }
      if (e.pointerType === 'touch') return !penSeen;
      return e.button === 0 || e.buttons === 1 || e.pointerType === 'mouse';
    }

    function cancel() {
      if (erasing) { strokes = history.pop() || strokes; erasing = false; }
      cur = null; curPts = null; owner = null; penDown = false; redraw();
    }
    function down(e) {
      if (!draws(e)) { if (e.pointerType === 'touch') e.preventDefault(); return; }   // a palm: nothing
      if (e.pointerType === 'pen') {
        // the pen wins over a finger or palm that landed first
        if (owner !== null && !penDown) cancel();
        active = {}; multi = false;
      } else if (e.isPrimary) { active = {}; multi = false; }   // a new first finger: what touched before has ended, even if no "up" arrived
      active[e.pointerId] = 1;
      // a second finger: this is a scroll, not a stroke
      if (Object.keys(active).length > 1) {
        multi = true;
        cancel();
        return;
      }
      if (multi || opts.tool().t === 's') return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* old browsers */ }
      owner = e.pointerId; penDown = e.pointerType === 'pen';
      var tool = opts.tool(), p = pos(e);
      if (tool.t === 'e') { history.push(strokes.slice()); erasing = { changed: eraseAt(p) }; return; }
      curPts = [p];
      var s = size();
      cur = { c: tool.c, t: tool.t, d: encode(curPts, s[0], s[1]) };
      redraw();
    }
    function move(e) {
      if (multi || e.pointerId !== owner) return;
      if (erasing) { if (eraseAt(pos(e))) erasing.changed = true; return; }
      if (!cur) return;
      e.preventDefault();
      var list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (!list.length) list = [e];
      list.forEach(function (ev) { curPts.push(pos(ev)); });
      var s = size();
      cur.d = encode(shaped(), s[0], s[1]);
      redraw();
    }
    function up(e) {
      delete active[e.pointerId];
      if (multi) { if (!Object.keys(active).length) multi = false; return; }
      if (e.pointerId !== owner) return;          // a palm lifting: the pen goes on
      owner = null; penDown = false;
      if (erasing) {
        var changed = erasing.changed;
        erasing = false;
        if (changed) opts.onChange(strokes.slice()); else history.pop();
        return;
      }
      if (!cur) return;
      cur.d = encode(shaped(), size()[0], size()[1]);
      // a highlighter tap makes no band (its ends are flat): nothing to keep
      if (cur.d.length < (cur.t === 'h' ? 4 : 2)) { cur = null; curPts = null; redraw(); return; }
      history.push(strokes.slice());
      strokes.push(cur);
      cur = null; curPts = null;
      redraw();
      opts.onChange(strokes.slice());
    }
    // two fingers scroll the card (Safari lists the pen among the touches: it doesn't count)
    function fingers(e) { return Array.prototype.filter.call(e.touches, function (t) { return t.touchType !== 'stylus'; }); }
    function mid(f) { return [(f[0].clientX + f[1].clientX) / 2, (f[0].clientY + f[1].clientY) / 2]; }
    function tstart(e) {
      var f = fingers(e);
      if (penDown || f.length !== 2) return;      // writing with the hand on the screen
      two = mid(f); multi = true; cancel();
    }
    function tmove(e) {
      if (penDown) { if (e.cancelable) e.preventDefault(); return; }
      var f = fingers(e);
      if (f.length !== 2 || two === null) return;
      var m = mid(f);
      if (opts.onScroll) opts.onScroll(two[1] - m[1], two[0] - m[0]);
      two = m;
      e.preventDefault();
    }
    function tend(e) {
      if (fingers(e).length < 2) two = null;
      if (!e.touches.length) { active = {}; multi = false; }   // every finger is up
    }

    canvas.style.touchAction = 'none';
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

  var api = { encode: encode, decode: decode, paint: paint, thumbnail: thumbnail, surface: surface, shapeHighlight: shapeHighlight, HL_COLOR: HL_COLOR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ink = api;
})(this);
