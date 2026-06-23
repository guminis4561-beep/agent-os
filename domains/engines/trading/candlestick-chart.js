// ═══════════════════════════════════════════════════
// DOMAIN: Trading — self-contained candlestick chart
// ═══════════════════════════════════════════════════
//
// Zero dependencies, zero branding, pure <canvas>. Renders candles + an SMA
// overlay + optional support/resistance lines, with:
//   • mouse-wheel zoom (centred on cursor) and +/−/fit buttons
//   • unrestricted horizontal pan (click-drag)
//   • drawing tools: trendline, horizontal line, Fibonacci, rectangle, ray
//   • eraser / undo / clear
//   • hover crosshair + OHLC tooltip, auto-resize
//
//   const chart = createCandleChart(containerEl);
//   chart.setData(candles);            // [{ time, open, high, low, close }]
//   chart.setSMA(points);              // [{ time, value }]
//   chart.setLevels(support, resist);  // [{ price, strength }]
//   chart.toggleLevels(true|false);
//   chart.destroy();

function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export function createCandleChart(container) {
  const theme = {
    text: cssVar('--text-muted', '#78766b'),
    grid: 'rgba(120, 118, 107, 0.12)',
    up: '#22a619',
    down: '#f53030',
    sma: '#007cff',
    support: '#22a619',
    resistance: '#f53030',
    crosshair: 'rgba(120, 118, 107, 0.55)',
    trend: '#007cff',
    hline: '#e08a00',
    fib: '#9b59b6',
    rect: '#11998e',
    ray: '#e84393',
  };

  const toolSettings = {
    trend: { color: theme.trend, width: 1.5 },
    hline: { color: theme.hline, width: 1.3 },
    ray: { color: theme.ray, width: 1.5 },
    rect: { color: theme.rect, width: 1.2 },
    fib: { color: theme.fib, width: 1, levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] }
  };

  container.style.position = 'relative';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;cursor:crosshair;';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  // Floating tooltip.
  const tip = document.createElement('div');
  tip.style.cssText = `position:absolute;pointer-events:none;z-index:6;display:none;
    background:var(--bg-elevated,#fff);border:1px solid var(--border-default,#ddd);
    border-radius:6px;padding:6px 8px;font-size:10px;font-family:var(--font-mono,monospace);
    color:var(--text-primary,#222);white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.12);`;
  container.appendChild(tip);

  const PAD = { top: 10, right: 64, bottom: 22, left: 8 };
  let candles = [];
  let sma = [];
  let vwap = { d: [], w: [], m: [] };
  let cvd = [];
  let support = [];
  let resistance = [];
  let showLevels = true;
  let W = 0, H = 0;
  let magnetEnabled = false;
  let currentSymbol = null;

  function saveDrawings() {
    if (currentSymbol) {
        try { localStorage.setItem(`chart_drawings_${currentSymbol}`, JSON.stringify(drawings)); } catch {}
    }
  }

  // Viewport — floating candle-index window [start, end].
  let view = { start: 0, end: 0 };

  // Interaction
  let tool = 'pan';                 // pan | trend | hline | fib | rect | ray | erase
  let drawings = [];                // finalized, anchored in {index, price}
  let pending = null;               // first click of a 2-point tool
  let mouse = null;                 // { x, y } current cursor (CSS px)
  let drag = null;                  // panning state
  const PADDING_FACTOR = 0.08;

  // ─── Geometry ───────────────────────────────────
  function plot() { return { x: PAD.left, y: PAD.top, w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom }; }
  function span() { return Math.max(view.end - view.start, 1e-6); }

  function clampView() {
    const n = candles.length;
    if (n < 2) { view = { start: 0, end: Math.max(n - 1, 1) }; return; }
    let s = view.end - view.start;
    s = Math.min(Math.max(s, 5), Math.max(n * 2, 100)); // allow zoom out beyond current candles

    let start = view.start;
    let end = start + s;
    
    // Allow panning past the last candle up to 90% of the visible span
    const maxEnd = (n - 1) + Math.floor(s * 0.9);
    if (end > maxEnd) { end = maxEnd; start = end - s; }
    if (start < 0) { start = 0; end = s; }
    
    view = { start, end };
  }

  function xFor(i) { const p = plot(); return p.x + ((i - view.start) / span()) * p.w; }
  function indexAt(px) { const p = plot(); return view.start + ((px - p.x) / p.w) * span(); }

  function priceRange() {
    const n = candles.length;
    if (!n) return { min: 0, max: 1 };
    const lo = Math.max(0, Math.floor(view.start));
    const hi = Math.min(n - 1, Math.ceil(view.end));
    let min = Infinity, max = -Infinity;
    let volMax = 0;
    for (let i = lo; i <= hi; i++) {
      if (candles[i].low < min) min = candles[i].low;
      if (candles[i].high > max) max = candles[i].high;
      if (candles[i].volume > volMax) volMax = candles[i].volume;
    }
    if (showLevels) {
      for (const l of support) { if (l.price >= min && l.price <= max) { /* keep */ } }
    }
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    const sp = (max - min) || max || 1;
    _volMax = volMax || 1;
    return { min: min - sp * PADDING_FACTOR, max: max + sp * PADDING_FACTOR };
  }
  let _range = { min: 0, max: 1 };
  let _cvdRange = { min: 0, max: 1 };
  let _volMax = 1;

  function plotMain() {
     const p = { x: PAD.left, y: PAD.top, w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };
     if (!cvd.length) return p;
     const gap = 14;
     p.h = p.h * 0.75 - gap / 2;
     return p;
  }
  function plotSub() {
     const full = { x: PAD.left, y: PAD.top, w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };
     if (!cvd.length) return { x: full.x, y: full.y + full.h, w: full.w, h: 0 };
     const gap = 14;
     const mainH = full.h * 0.75 - gap / 2;
     return { x: full.x, y: full.y + mainH + gap, w: full.w, h: full.h * 0.25 - gap / 2 };
  }
  function plot() { return plotMain(); } // For backwards compat

  function yFor(price) { const p = plotMain(); return p.y + (1 - (price - _range.min) / (_range.max - _range.min)) * p.h; }
  function priceAt(py) { const p = plotMain(); return _range.min + (1 - (py - p.y) / p.h) * (_range.max - _range.min); }
  function yForCVD(val) { const p = plotSub(); return p.y + (1 - (val - _cvdRange.min) / (_cvdRange.max - _cvdRange.min)) * p.h; }
  function cvdAt(py) { const p = plotSub(); return _cvdRange.min + (1 - (py - p.y) / p.h) * (_cvdRange.max - _cvdRange.min); }
  function yForVol(val) { const p = plotSub(); return p.y + p.h - (val / _volMax) * p.h; }

  function getPointer(m) {
     let idx = indexAt(m.x);
     let price = priceAt(m.y);
     const pm = plotMain();
     if (magnetEnabled && tool !== 'pan' && tool !== 'erase' && m.y <= pm.y + pm.h) {
        const i = Math.round(idx);
        if (i >= 0 && i < candles.length) {
            const c = candles[i];
            const px = xFor(i);
            if (Math.abs(m.x - px) < 20) {
               const prices = [c.open, c.high, c.low, c.close];
               let closest = prices[0];
               let minDist = Math.abs(yFor(prices[0]) - m.y);
               for (let j = 1; j < 4; j++) {
                   const dist = Math.abs(yFor(prices[j]) - m.y);
                   if (dist < minDist) { minDist = dist; closest = prices[j]; }
               }
               if (minDist < 50) { idx = i; price = closest; }
            }
        }
     }
     return { index: idx, price };
  }

  // ─── Formatting ─────────────────────────────────
  function fmtPrice(n) {
    if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
    if (n >= 1) return n.toFixed(2);
    return n.toFixed(5);
  }
  function fmtTime(t) {
    return new Date(t * 1000).toLocaleString('lt-LT', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  // ─── Render ─────────────────────────────────────
  function render() {
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    if (!candles.length) {
      ctx.fillStyle = theme.text; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Nėra duomenų', W / 2, H / 2); return;
    }
    clampView();
    _range = priceRange();
    if (cvd.length) {
        const lo = Math.max(0, Math.floor(view.start));
        const hi = Math.min(candles.length - 1, Math.ceil(view.end));
        let cMin = Infinity, cMax = -Infinity;
        const t2i = new Map(candles.map((c, i) => [c.time, i]));
        for (const pt of cvd) {
            const idx = t2i.get(pt.time);
            if (idx == null || idx < lo || idx > hi) continue;
            if (pt.value < cMin) cMin = pt.value;
            if (pt.value > cMax) cMax = pt.value;
        }
        if (!isFinite(cMin) || !isFinite(cMax)) { cMin = 0; cMax = 1; }
        const csp = (cMax - cMin) || Math.abs(cMax) || 1;
        _cvdRange = { min: cMin - csp * 0.1, max: cMax + csp * 0.1 };
    }

    const p = plotMain();
    const pSub = plotSub();
    const n = candles.length;
    const lo = Math.max(0, Math.floor(view.start));
    const hi = Math.min(n - 1, Math.ceil(view.end));

    // Time axis ticks (X)
    const timeTicks = 6;
    const axisFmt = { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' };
    ctx.fillStyle = theme.text; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = '10px monospace';
    for (let i = 0; i < timeTicks; i++) {
      const idx = Math.round(view.start + (i / (timeTicks - 1)) * span());
      if (idx < 0) continue;
      let t;
      if (idx > n - 1) {
        if (n >= 2) t = candles[n-1].time + (idx - (n - 1)) * (candles[n-1].time - candles[n-2].time);
        else t = candles[0].time + (idx * 3600);
      } else {
        t = candles[idx].time;
      }
      ctx.fillStyle = theme.text;
      ctx.fillText(new Date(t * 1000).toLocaleString('lt-LT', axisFmt), xFor(idx), cvd.length ? pSub.y + pSub.h + 5 : p.y + p.h + 5);
    }

    // Price axis ticks (Y)
    const priceTicks = 8;
    ctx.fillStyle = theme.text; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '10px monospace';
    for (let i = 0; i <= priceTicks; i++) {
      const price = _range.min + (i / priceTicks) * (_range.max - _range.min);
      const y = yFor(price);
      ctx.fillText(fmtPrice(price), p.x + p.w + 5, y);
      ctx.strokeStyle = theme.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke();
    }

    // CVD axis ticks
    if (cvd.length) {
      const subTicks = 3;
      for (let i = 0; i <= subTicks; i++) {
        const val = _cvdRange.min + (i / subTicks) * (_cvdRange.max - _cvdRange.min);
        const y = yForCVD(val);
        ctx.fillStyle = theme.text;
        ctx.fillText(fmtPrice(val), pSub.x + pSub.w + 5, y);
        ctx.strokeStyle = theme.grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pSub.x, y); ctx.lineTo(pSub.x + pSub.w, y); ctx.stroke();
      }
      ctx.strokeStyle = theme.grid; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(pSub.x, pSub.y); ctx.lineTo(pSub.x + pSub.w, pSub.y); ctx.stroke();
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();

    const step = p.w / span();
    const bodyW = Math.max(1, Math.min(16, step * 0.66));
    
    if (!cvd.length && _volMax > 0) {
        for (let i = lo; i <= hi; i++) {
            const c = candles[i];
            const x = xFor(i);
            const col = c.close >= c.open ? theme.up : theme.down;
            ctx.fillStyle = col; ctx.globalAlpha = 0.2;
            const h = (c.volume / _volMax) * (p.h * 0.2);
            ctx.fillRect(x - bodyW / 2, p.y + p.h - h, bodyW, h);
            ctx.globalAlpha = 1.0;
        }
    }

    for (let i = lo; i <= hi; i++) {
      const c = candles[i];
      const x = xFor(i);
      const col = c.close >= c.open ? theme.up : theme.down;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yFor(c.high)); ctx.lineTo(x, yFor(c.low)); ctx.stroke();
      const yO = yFor(c.open), yC = yFor(c.close);
      ctx.fillRect(x - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1, Math.abs(yC - yO)));
    }

    if (sma.length) {
      ctx.strokeStyle = theme.sma; ctx.lineWidth = 1.4; ctx.beginPath();
      let started = false;
      const t2i = new Map(candles.map((c, i) => [c.time, i]));
      for (const pt of sma) {
        const idx = t2i.get(pt.time);
        if (idx == null || pt.value == null || idx < lo - 1 || idx > hi + 1) continue;
        const x = xFor(idx), y = yFor(pt.value);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    const drawVWAP = (pts, color) => {
        if (!pts || !pts.length) return;
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
        let started = false;
        const t2i = new Map(candles.map((c, i) => [c.time, i]));
        for (const pt of pts) {
          const idx = t2i.get(pt.time);
          if (idx == null || pt.value == null || idx < lo - 1 || idx > hi + 1) continue;
          const x = xFor(idx), y = yFor(pt.value);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
    };
    
    // Monthly -> Orange, Weekly -> Cyan, Daily -> Purple
    drawVWAP(vwap.m, '#f39c12');
    drawVWAP(vwap.w, '#00d2d3');
    drawVWAP(vwap.d, '#e056fd');

    if (showLevels) {
      ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.font = '9px monospace'; ctx.textBaseline = 'middle';
      const lvl = (l, color, label) => {
        if (l.price < _range.min || l.price > _range.max) return;
        const y = yFor(l.price);
        ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke();
        ctx.fillStyle = color; ctx.textAlign = 'left';
        ctx.fillText(`${label}${l.strength ? ' ×' + l.strength : ''}`, p.x + 4, y - 6);
      };
      resistance.forEach(l => lvl(l, theme.resistance, 'R'));
      support.forEach(l => lvl(l, theme.support, 'S'));
      ctx.setLineDash([]);
    }

    drawings.forEach(d => _drawShape(d, false));
    if (pending && mouse) {
      _drawShape({ type: tool, a: pending, b: getPointer(mouse) }, true);
    }
    ctx.restore();

    if (cvd.length) {
      ctx.save();
      ctx.beginPath(); ctx.rect(pSub.x, pSub.y, pSub.w, pSub.h); ctx.clip();
      if (_volMax > 0) {
          for (let i = lo; i <= hi; i++) {
              const c = candles[i];
              const x = xFor(i);
              const col = c.close >= c.open ? theme.up : theme.down;
              ctx.fillStyle = col; ctx.globalAlpha = 0.3;
              const yVol = yForVol(c.volume);
              ctx.fillRect(x - bodyW / 2, yVol, bodyW, (pSub.y + pSub.h) - yVol);
              ctx.globalAlpha = 1.0;
          }
      }
      ctx.strokeStyle = '#3498db'; ctx.lineWidth = 1; ctx.beginPath();
      let started = false;
      const t2i = new Map(candles.map((c, i) => [c.time, i]));
      for (const pt of cvd) {
        const idx = t2i.get(pt.time);
        if (idx == null || idx < lo - 1 || idx > hi + 1) continue;
        const x = xFor(idx), y = yForCVD(pt.value);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    if (n > 0) {
      const lastC = candles[n - 1];
      const y = yFor(lastC.close);
      const col = lastC.close >= lastC.open ? theme.up : theme.down;
      ctx.save();
      ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      ctx.fillStyle = col;
      ctx.fillRect(p.x + p.w, y - 10, 60, 20);
      ctx.fillStyle = '#fff'; ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(fmtPrice(lastC.close), p.x + p.w + 5, y);
    }

    const fullPlot = { x: PAD.left, y: PAD.top, w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };
    if (mouse && mouse.x >= fullPlot.x && mouse.x <= fullPlot.x + fullPlot.w) {
      const idx = Math.max(0, Math.round(indexAt(mouse.x)));
      const px = xFor(idx);
      ctx.strokeStyle = theme.crosshair; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, fullPlot.y); ctx.lineTo(px, fullPlot.y + fullPlot.h); ctx.stroke();
      
      if (mouse.y >= fullPlot.y && mouse.y <= fullPlot.y + fullPlot.h) {
          ctx.beginPath(); ctx.moveTo(fullPlot.x, mouse.y); ctx.lineTo(fullPlot.x + fullPlot.w, mouse.y); ctx.stroke();
          
          let tagText = '';
          if (mouse.y <= p.y + p.h) {
             tagText = fmtPrice(priceAt(mouse.y));
          } else if (cvd.length && mouse.y >= pSub.y) {
             tagText = fmtPrice(cvdAt(mouse.y));
          }
          if (tagText) {
             ctx.setLineDash([]); ctx.fillStyle = theme.bg;
             ctx.fillRect(fullPlot.x + fullPlot.w, mouse.y - 10, 60, 20);
             ctx.fillStyle = theme.text; ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
             ctx.fillText(tagText, fullPlot.x + fullPlot.w + 5, mouse.y);
          }
      }
      ctx.setLineDash([]);
      
      if (tool === 'pan') {
        if (idx <= n - 1) {
          const c = candles[idx];
          const chg = ((c.close - c.open) / c.open) * 100;
          let extra = `<br>Vol: ${fmtPrice(c.volume || 0)}`;
          if (cvd.length) {
              const t2i = new Map(candles.map((cd, i) => [cd.time, i]));
              const cvdPt = cvd.find(pt => t2i.get(pt.time) === idx);
              if (cvdPt) extra += `<br>CVD: ${fmtPrice(cvdPt.value)}`;
          }
          tip.innerHTML = `${fmtTime(c.time)}<br>O ${fmtPrice(c.open)} H ${fmtPrice(c.high)}<br>L ${fmtPrice(c.low)} C ${fmtPrice(c.close)}<br><span style="color:${chg >= 0 ? theme.up : theme.down}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>${extra}`;
        } else {
          let t;
          if (n >= 2) t = candles[n-1].time + (idx - (n - 1)) * (candles[n-1].time - candles[n-2].time);
          else t = candles[0].time + (idx * 3600);
          tip.innerHTML = `${fmtTime(t)}<br>—`;
        }
        tip.style.display = 'block';
        tip.style.left = Math.max(2, (px + 12 + 150 > W ? px - 160 : px + 12)) + 'px';
        tip.style.top = (p.y + 4) + 'px';
      }
    } else {
      tip.style.display = 'none';
    }
  }

  function _drawShape(d, preview) {
    const a = d.a, b = d.b;
    const s = d.settings || toolSettings[d.type] || {};
    ctx.globalAlpha = preview ? 0.7 : 1;
    if (d.type === 'hline') {
      const y = yFor(a.price);
      const col = s.color || theme.hline;
      ctx.strokeStyle = col; ctx.lineWidth = s.width || 1.3; ctx.setLineDash(s.dashed ? [4,4] : []);
      ctx.beginPath(); ctx.moveTo(plot().x, y); ctx.lineTo(plot().x + plot().w, y); ctx.stroke();
      ctx.fillStyle = col; ctx.font = '9px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(d.label ? `${d.label} (${fmtPrice(a.price)})` : fmtPrice(a.price), plot().x + 4, y - 2);
      ctx.setLineDash([]);
    } else if (d.type === 'trend' || d.type === 'ray') {
      if (!b) return;
      let x1 = xFor(a.index), y1 = yFor(a.price), x2 = xFor(b.index), y2 = yFor(b.price);
      if (d.type === 'ray') { // extend beyond b to the right edge
        const dx = x2 - x1, dy = y2 - y1;
        if (Math.abs(dx) > 0.01) { const t = (plot().x + plot().w - x1) / dx; if (t > 1) { x2 = x1 + dx * t; y2 = y1 + dy * t; } }
      }
      ctx.strokeStyle = s.color || (d.type === 'ray' ? theme.ray : theme.trend); ctx.lineWidth = s.width || 1.5; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    } else if (d.type === 'rect') {
      if (!b) return;
      const x1 = xFor(a.index), y1 = yFor(a.price), x2 = xFor(b.index), y2 = yFor(b.price);
      const col = s.color || theme.rect;
      ctx.strokeStyle = col; ctx.lineWidth = s.width || 1.2; ctx.setLineDash(s.dashed ? [4,4] : []);
      ctx.fillStyle = col + '22'; // slight opacity for fill
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      if (d.label) {
        ctx.fillStyle = col; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(d.label, Math.min(x1, x2) + Math.abs(x2 - x1)/2, Math.min(y1, y2) + Math.abs(y2 - y1)/2);
      }
      ctx.setLineDash([]);
    } else if (d.type === 'fib') {
      if (!b) return;
      const x1 = xFor(a.index), x2 = xFor(b.index);
      const left = Math.min(x1, x2), right = Math.max(x1, x2);
      const col = s.color || theme.fib;
      // connecting line
      ctx.strokeStyle = col; ctx.lineWidth = s.width || 1; ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(x1, yFor(a.price)); ctx.lineTo(x2, yFor(b.price)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '9px monospace'; ctx.textBaseline = 'middle';
      const lvls = s.levels || FIB_LEVELS;
      for (const L of lvls) {
        const price = b.price + (a.price - b.price) * L;
        const y = yFor(price);
        ctx.strokeStyle = col; ctx.globalAlpha = (preview ? 0.6 : 0.85);
        ctx.lineWidth = ((L === 0 || L === 1) ? 1.3 : 1) * (s.width || 1);
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(Math.max(right, plot().x + plot().w), y); ctx.stroke();
        ctx.fillStyle = col; ctx.textAlign = 'left';
        ctx.fillText(`${parseFloat(L).toFixed(3)} (${fmtPrice(price)})`, left + 3, y - 6);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ─── Hit testing (for eraser) ───────────────────
  function _segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  }
  function _hitIndex(px, py) {
    for (let i = drawings.length - 1; i >= 0; i--) {
      const d = drawings[i];
      if (d.type === 'hline') { if (Math.abs(py - yFor(d.a.price)) < 6) return i; }
      else if (d.type === 'trend' || d.type === 'ray') {
        if (_segDist(px, py, xFor(d.a.index), yFor(d.a.price), xFor(d.b.index), yFor(d.b.price)) < 6) return i;
      } else if (d.type === 'rect') {
        const x1 = xFor(d.a.index), y1 = yFor(d.a.price), x2 = xFor(d.b.index), y2 = yFor(d.b.price);
        const near = _segDist(px, py, x1, y1, x2, y1) < 6 || _segDist(px, py, x2, y1, x2, y2) < 6 ||
          _segDist(px, py, x2, y2, x1, y2) < 6 || _segDist(px, py, x1, y2, x1, y1) < 6;
        if (near) return i;
      } else if (d.type === 'fib') {
        const lvls = d.settings?.levels || FIB_LEVELS;
        for (const L of lvls) { if (Math.abs(py - yFor(d.b.price + (d.a.price - d.b.price) * L)) < 5) return i; }
      }
    }
    return -1;
  }

  // ─── Interaction ────────────────────────────────
  function relPos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  function onWheel(e) {
    e.preventDefault();
    if (!candles.length) return;
    const m = relPos(e);
    const idx = indexAt(m.x);
    const factor = e.deltaY < 0 ? 0.82 : 1.22;
    let s = span() * factor;
    s = Math.min(Math.max(s, 5), Math.max(candles.length * 2, 100));
    const ratio = (idx - view.start) / span();
    view.start = idx - ratio * s;
    view.end = view.start + s;
    clampView(); render();
  }

  function onDown(e) {
    const m = relPos(e);
    mouse = m;
    if (tool === 'pan') {
      drag = { x: m.x, start: view.start, end: view.end };
      canvas.style.cursor = 'grabbing';
    }
  }
  function onMove(e) {
    mouse = relPos(e);
    if (drag) {
      const p = plot();
      const dIdx = ((mouse.x - drag.x) / p.w) * (drag.end - drag.start);
      view.start = drag.start - dIdx;
      view.end = drag.end - dIdx;
      clampView();
    }
    render();
  }
  function onUp() {
    if (drag) { drag = null; canvas.style.cursor = tool === 'pan' ? 'grab' : 'crosshair'; }
  }
  function onLeave() { mouse = null; render(); }

  function onClick(e) {
    if (tool === 'pan') return; // pan handled by drag
    const m = relPos(e);
    const pt = getPointer(m);
    if (tool === 'hline') { drawings.push({ type: 'hline', a: pt, settings: JSON.parse(JSON.stringify(toolSettings['hline'])) }); saveDrawings(); _setTool('pan'); render(); return; }
    if (tool === 'erase') { const hit = _hitIndex(m.x, m.y); if (hit >= 0) { drawings.splice(hit, 1); saveDrawings(); render(); } return; }
    // 2-point tools
    if (!pending) { pending = pt; render(); }
    else { drawings.push({ type: tool, a: pending, b: pt, settings: JSON.parse(JSON.stringify(toolSettings[tool])) }); pending = null; saveDrawings(); _setTool('pan'); render(); }
  }
  function onKey(e) {
    if (e.key === 'Escape') { pending = null; _setTool('pan'); render(); }
  }

  // ─── Toolbar UI (overlay) ───────────────────────
  const TOOLS = [
    ['pan', '✋', 'Stumti / mastelis (vilkti, ratukas)'],
    ['trend', '╱', 'Trendo linija'],
    ['hline', '─', 'Horizontali linija'],
    ['ray', '➹', 'Spindulys (ray)'],
    ['fib', 'F', 'Fibonacci lygiai'],
    ['rect', '▭', 'Stačiakampis'],
    ['erase', '⌫', 'Trintukas (spausk ant brėžinio)'],
  ];
  const bar = document.createElement('div');
  bar.style.cssText = `position:absolute;top:6px;left:6px;z-index:7;display:flex;flex-direction:column;gap:2px;
    background:var(--bg-elevated,rgba(255,255,255,.85));border:1px solid var(--border-default,#ddd);
    border-radius:6px;padding:3px;box-shadow:0 1px 4px rgba(0,0,0,.1);`;
  const toolBtns = {};
  TOOLS.forEach(([id, icon, title]) => {
    const b = document.createElement('button');
    b.title = title; b.textContent = icon;
    b.style.cssText = `width:24px;height:24px;border:none;border-radius:4px;background:none;cursor:pointer;
      font-size:13px;line-height:1;color:var(--text-secondary,#555);display:flex;align-items:center;justify-content:center;`;
    b.addEventListener('click', () => _setTool(id));
    bar.appendChild(b); toolBtns[id] = b;
  });
  const sep = document.createElement('div'); sep.style.cssText = 'height:1px;background:var(--border-default,#ddd);margin:2px 0;';
  bar.appendChild(sep);
  const mkAction = (icon, title, fn) => {
    const b = document.createElement('button');
    b.title = title; b.textContent = icon;
    b.style.cssText = `width:24px;height:24px;border:none;border-radius:4px;background:none;cursor:pointer;
      font-size:12px;line-height:1;color:var(--text-secondary,#555);display:flex;align-items:center;justify-content:center;`;
    b.addEventListener('click', fn); bar.appendChild(b); return b;
  };
  mkAction('↶', 'Atšaukti paskutinį', () => { drawings.pop(); saveDrawings(); pending = null; render(); });
  mkAction('🗑', 'Išvalyti visus brėžinius', () => { drawings = []; saveDrawings(); pending = null; render(); });
  
  const btnMagnet = document.createElement('button');
  btnMagnet.title = 'Magnet (pritraukti prie žvakių)'; btnMagnet.textContent = '🧲';
  btnMagnet.style.cssText = `width:24px;height:24px;border:none;border-radius:4px;background:none;cursor:pointer;
    font-size:13px;line-height:1;color:var(--text-secondary,#555);display:flex;align-items:center;justify-content:center;margin-top:2px;`;
  btnMagnet.addEventListener('click', () => {
    magnetEnabled = !magnetEnabled;
    btnMagnet.style.background = magnetEnabled ? 'var(--trading-accent,#ffd740)' : 'none';
    btnMagnet.style.color = magnetEnabled ? '#1a1a1a' : 'var(--text-secondary,#555)';
  });
  bar.appendChild(btnMagnet);

  container.appendChild(bar);

  const settingsPanel = document.createElement('div');
  settingsPanel.style.cssText = `position:absolute;top:6px;left:40px;z-index:7;display:none;flex-direction:column;gap:6px;
    background:var(--bg-elevated,rgba(255,255,255,.95));border:1px solid var(--border-default,#ddd);
    border-radius:6px;padding:8px;box-shadow:0 2px 8px rgba(0,0,0,.15);font-family:var(--font-sans,sans-serif);font-size:11px;
    color:var(--text-primary,#222);min-width:140px;`;
  container.appendChild(settingsPanel);
  
  function updateSettingsUI() {
    if (!toolSettings[tool]) { settingsPanel.style.display = 'none'; return; }
    settingsPanel.style.display = 'flex';
    settingsPanel.innerHTML = '';
    const s = toolSettings[tool];
    
    const hdr = document.createElement('div');
    hdr.textContent = 'Įrankio nustatymai';
    hdr.style.fontWeight = 'bold'; hdr.style.marginBottom = '2px';
    settingsPanel.appendChild(hdr);

    const mkRow = (lblText, inpEl) => {
      const r = document.createElement('div'); r.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;';
      const lbl = document.createElement('label'); lbl.textContent = lblText;
      r.appendChild(lbl); r.appendChild(inpEl); settingsPanel.appendChild(r);
    };

    const inpColor = document.createElement('input'); inpColor.type = 'color'; inpColor.value = s.color;
    inpColor.style.cssText = 'width:24px;height:24px;padding:0;border:none;cursor:pointer;background:none;';
    inpColor.addEventListener('input', e => { s.color = e.target.value; render(); });
    mkRow('Spalva', inpColor);

    const inpWidth = document.createElement('input'); inpWidth.type = 'range'; inpWidth.min = '1'; inpWidth.max = '5'; inpWidth.step = '0.5'; inpWidth.value = s.width;
    inpWidth.style.width = '60px';
    inpWidth.addEventListener('input', e => { s.width = parseFloat(e.target.value); render(); });
    mkRow('Storis', inpWidth);

    if (tool === 'fib') {
      const rowFib = document.createElement('div');
      rowFib.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
      const lblFib = document.createElement('label'); lblFib.textContent = 'Lygiai (atskirti kableliu)';
      const inpFib = document.createElement('input'); inpFib.type = 'text'; inpFib.value = s.levels.join(', ');
      inpFib.style.cssText = 'width:100%;box-sizing:border-box;padding:4px;border:1px solid var(--border-default,#ddd);border-radius:4px;font-size:11px;background:var(--bg-default,#fff);color:var(--text-primary,#222);';
      inpFib.addEventListener('input', e => {
        const arr = e.target.value.split(',').map(x => parseFloat(x.trim())).filter(x => !isNaN(x));
        if (arr.length) { s.levels = arr; render(); }
      });
      rowFib.appendChild(lblFib); rowFib.appendChild(inpFib);
      settingsPanel.appendChild(rowFib);
    }
  }

  // Zoom controls (bottom-right)
  const zoomBar = document.createElement('div');
  zoomBar.style.cssText = `position:absolute;bottom:26px;right:70px;z-index:7;display:flex;flex-direction:column;gap:2px;`;
  const mkZoom = (icon, title, fn) => {
    const b = document.createElement('button');
    b.title = title; b.textContent = icon;
    b.style.cssText = `width:24px;height:24px;border:1px solid var(--border-default,#ddd);border-radius:4px;
      background:var(--bg-elevated,rgba(255,255,255,.85));cursor:pointer;font-size:14px;line-height:1;
      color:var(--text-secondary,#555);display:flex;align-items:center;justify-content:center;`;
    b.addEventListener('click', fn); zoomBar.appendChild(b); return b;
  };
  const zoomBy = (factor) => {
    const mid = (view.start + view.end) / 2;
    let s = Math.min(Math.max(span() * factor, 5), Math.max(candles.length * 2, 100));
    view.start = mid - s / 2; view.end = mid + s / 2; clampView(); render();
  };
  mkZoom('＋', 'Priartinti', () => zoomBy(0.7));
  mkZoom('－', 'Atitolinti', () => zoomBy(1.4));
  mkZoom('⤢', 'Rodyti viską', () => { view = { start: 0, end: Math.max(candles.length - 1, 1) }; render(); });
  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      container.requestFullscreen?.() || container.webkitRequestFullscreen?.();
    } else {
      document.exitFullscreen?.() || document.webkitExitFullscreen?.();
    }
  };
  mkZoom('⛶', 'Pilnas ekranas', toggleFullScreen);
  container.appendChild(zoomBar);

  const onFullscreenChange = () => {
    if (document.fullscreenElement === container || document.webkitFullscreenElement === container) {
      container.style.backgroundColor = cssVar('--bg-base', '#090b0f');
    } else {
      container.style.backgroundColor = '';
    }
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  function _setTool(id) {
    tool = id;
    pending = null; // any half-finished drawing is discarded on tool change
    canvas.style.cursor = id === 'pan' ? 'grab' : 'crosshair';
    Object.entries(toolBtns).forEach(([k, b]) => {
      const active = k === id;
      b.style.background = active ? 'var(--trading-accent,#ffd740)' : 'none';
      b.style.color = active ? '#1a1a1a' : 'var(--text-secondary,#555)';
    });
    if (typeof updateSettingsUI === 'function') updateSettingsUI();
  }

  // ─── Sizing ─────────────────────────────────────
  function resize() {
    const rect = container.getBoundingClientRect();
    W = Math.floor(rect.width); H = Math.floor(rect.height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(W * dpr));
    canvas.height = Math.max(1, Math.floor(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  _setTool('pan');
  resize();

  return {
    setData(data, symbol) {
      const changed = !candles.length || (data && data.length && candles.length && data[0].time !== candles[0].time);
      candles = Array.isArray(data) ? data : [];
      // Default zoom: show the most recent ~150 candles (room to pan left into history).
      const n = candles.length;
      const win = Math.min(150, Math.max(n - 1, 1));
      const rightPadding = Math.min(20, Math.floor(win * 0.15));
      view = { start: Math.max(0, n - 1 - win), end: Math.max(n - 1, 1) + rightPadding };
      
      if (symbol) {
         if (symbol !== currentSymbol) {
             currentSymbol = symbol;
             pending = null;
             try {
                const stored = localStorage.getItem(`chart_drawings_${symbol}`);
                drawings = stored ? JSON.parse(stored) : [];
             } catch { drawings = []; }
         }
      } else if (changed) {
         drawings = []; pending = null;
      }
      render();
    },
    setSMA(points) { sma = Array.isArray(points) ? points : []; render(); },
    setVWAP(ptsObj) { vwap = ptsObj || { d: [], w: [], m: [] }; render(); },
    setCVD(points) { cvd = Array.isArray(points) ? points : []; render(); },
    setLevels(sup, res) { support = sup || []; resistance = res || []; render(); },
    toggleLevels(v) { showLevels = v == null ? !showLevels : !!v; render(); return showLevels; },
    levelsVisible() { return showLevels; },
    addSetupLines(lines) {
      if (!candles.length) return;
      for (const l of lines) {
         if (l.type === 'hline') {
            drawings.push({
               type: 'hline',
               a: { index: candles.length - 1, price: l.price },
               label: l.label,
               settings: { color: l.color, width: 1.5, dashed: l.dashed }
            });
         } else if (l.type === 'rect') {
            drawings.push({
               type: 'rect',
               a: { index: Math.max(0, candles.length - 100), price: l.min },
               b: { index: candles.length + 50, price: l.max },
               label: l.label,
               settings: { color: l.color, width: 1.5, dashed: l.dashed }
            });
         }
      }
      saveDrawings();
      render();
    },
    resize,
    destroy() {
      try { ro.disconnect(); } catch { /* noop */ }
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
      try { container.removeChild(canvas); container.removeChild(tip); container.removeChild(bar); container.removeChild(zoomBar); container.removeChild(settingsPanel); } catch { /* noop */ }
    },
  };
}
