/* xau-lab tracker motion. Dependency-free; every effect is an enhancement — pages read fine if this file never loads.
   - walk():  canvas first-passage simulation (random-walk paths between take-profit and stop-out barriers)
   - count-up numbers, pointer tilt/glare, stack parallax, section rail, reveal fallback */
(() => {
  'use strict';
  const d = document, root = d.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const $$ = (s, r = d) => [...r.querySelectorAll(s)];
  const hasIO = 'IntersectionObserver' in window;
  const XAU = (window.XAU = {});

  /* ---------- stagger index for CSS (--n) ---------- */
  function stagger(r = d) {
    $$('.cards, .tally, #live-jobs', r).forEach(g => [...g.children].forEach((el, i) => el.style.setProperty('--n', i)));
    const stack = d.querySelector('.stack');
    if (stack) stack.style.setProperty('--count', Math.max(4, stack.children.length));
  }

  /* ---------- count-up ---------- */
  const NUM = /^(\D*?)(-?\d[\d,]*(?:\.\d+)?)(\D*)$/;
  const COUNT = '.intro h1 b, .tally b, .card footer span:first-child, .ring span, .stat dd, .job .num';
  const seen = hasIO ? new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { seen.unobserve(e.target); tick(e.target); }
  }), { threshold: 0.3 }) : null;
  function shape(el) {
    const m = NUM.exec(el.dataset.final);
    const dec = (m[2].split('.')[1] || '').length, comma = m[2].includes(',');
    return { to: parseFloat(m[2].replace(/,/g, '')), put: v => {
      el.textContent = m[1] + (comma ? v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec)) + m[3];
    } };
  }
  function tick(el) {
    const { to, put } = shape(el), t0 = performance.now(), dur = 1100;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      if (k < 1) { put(to * (1 - Math.pow(1 - k, 3))); requestAnimationFrame(step); }
      else el.textContent = el.dataset.final; // always land on the exact source text
    };
    requestAnimationFrame(step);
  }
  function count(r = d) {
    if (reduce.matches || !seen) return;
    $$(COUNT, r).forEach(el => {
      if (el.dataset.final || el.children.length) return;
      const text = el.textContent.trim();
      if (!NUM.test(text)) return;
      el.dataset.final = text;
      shape(el).put(0);
      seen.observe(el);
    });
  }
  // Content arrives after sign-in (app.js injects it), so app.js calls scan() once the markup is in place.
  XAU.scan = r => { stagger(r); count(r); setTimeout(() => XAU.settle && XAU.settle(), 3200); };

  /* ---------- pointer: tilt + glare + spotlight border + stack parallax ---------- */
  const TILT = '.card, .job, .proof, .stat', SPOT = '.panel, .intro, .hero';
  let hot = [];
  const cool = el => { el.classList.remove('hot'); ['--rx', '--ry', '--mx', '--my'].forEach(p => el.style.removeProperty(p)); };
  d.addEventListener('pointermove', e => {
    if (!fine.matches || reduce.matches || !(e.target instanceof Element)) return;
    const stack = d.querySelector('.stack');
    if (stack) {
      stack.style.setProperty('--tx', ((e.clientX / innerWidth - 0.5) * 30).toFixed(1) + 'deg');
      stack.style.setProperty('--ty', ((e.clientY / innerHeight - 0.5) * -16).toFixed(1) + 'deg');
    }
    const tilt = e.target.closest(TILT), now = [tilt, e.target.closest(SPOT)].filter(Boolean);
    hot.filter(el => !now.includes(el)).forEach(cool);
    hot = now;
    for (const el of now) {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      el.classList.add('hot');
      el.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
      el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
      if (el === tilt) {
        const amp = Math.min(9, 2600 / r.width); // wide elements tilt less
        el.style.setProperty('--ry', ((px - 0.5) * amp).toFixed(2) + 'deg');
        el.style.setProperty('--rx', ((0.5 - py) * Math.min(9, amp * 1.4)).toFixed(2) + 'deg');
      }
    }
  }, { passive: true });
  root.addEventListener('pointerleave', () => { hot.forEach(cool); hot = []; });

  /* ---------- reveal fallback + section rail ---------- */
  function reveals() {
    const supported = window.CSS && CSS.supports && CSS.supports('animation-timeline: view()');
    if (supported || reduce.matches || !hasIO) return;
    const els = $$('.reveal');
    if (!els.length) return;
    root.classList.add('io');
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px' });
    els.forEach(el => io.observe(el));
  }
  function rail() {
    const nav = d.querySelector('.secnav');
    if (!nav || !hasIO) return;
    const map = new Map();
    $$('a[href^="#"]', nav).forEach(a => { const s = d.getElementById(a.hash.slice(1)); if (s) map.set(s, a); });
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      map.forEach(a => a.removeAttribute('aria-current'));
      const a = map.get(e.target);
      a.setAttribute('aria-current', 'true');
      nav.scrollTo({ left: a.offsetLeft - nav.clientWidth / 2 + a.offsetWidth / 2, behavior: reduce.matches ? 'auto' : 'smooth' });
    }), { rootMargin: '-25% 0px -65% 0px' });
    map.forEach((a, s) => io.observe(s));
  }

  /* ---------- first-passage simulation ----------
     World: x = time 0..1, y = price in risk units (stop at -1, take-profit at +R), z = depth lane 0..1.
     Each path is a driftless Gaussian walk that starts one spread below the entry line. */
  function walk(cv) {
    const ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return;
    const hero = cv.dataset.walk === 'hero';
    const host = cv.closest('.sim') || cv.parentElement;
    host.hidden = false;
    const area = cv.closest('.intro, .hero') || host;
    const out = {};
    $$('[data-share]', host).forEach(el => (out[el.dataset.share] = el));
    const segs = $$('.split i', host), btns = $$('[data-rr]', host);
    const STEPS = 150, SPREAD = 0.08, FADE = 1500, YAW = -0.24, PITCH = 0.13;
    const C = {};
    let W = 0, H = 0, R = 2, Rt = 2, sigma = Math.sqrt(Rt / 50);
    let paths = [], tally = [0, 0, 0, 0]; // index = state: 1 take-profit, 2 stop-out, 3 timeout
    let yaw = YAW, pitch = PITCH, yawT = YAW, pitchT = PITCH;
    let cy = 1, sy = 0, cp = 1, sp = 0, depth = 0, F = 1, unit = 1, X = 0, Y = 0;
    let running = false, visible = false, raf = 0, last = 0, acc = 0, spawnAt = 0, hudAt = 0;

    function colours() {
      const probe = d.createElement('i');
      probe.style.display = 'none';
      host.appendChild(probe);
      const fallback = { gold: '#e8b84a', ok: '#4cc38a', bad: '#e5645a', mute: '#8a8f9c' };
      for (const k in fallback) {
        probe.style.color = `var(--${k})`;
        const v = getComputedStyle(probe).color;
        ctx.fillStyle = '#010203'; ctx.fillStyle = v; // an unparseable colour leaves the sentinel in place
        C[k] = ctx.fillStyle === '#010203' ? fallback[k] : v;
      }
      probe.remove();
    }
    function gauss() {
      return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(6.283185307 * Math.random());
    }
    function spawn() {
      const ys = new Float32Array(STEPS + 1);
      ys[0] = -SPREAD;
      return { z: Math.random(), ys, n: 0, s: 0, end: 0 };
    }
    function advance(p, now) {
      const y = p.ys[p.n] + gauss() * sigma;
      p.n++;
      if (y >= Rt) { p.ys[p.n] = Rt; p.s = 1; }
      else if (y <= -1) { p.ys[p.n] = -1; p.s = 2; }
      else { p.ys[p.n] = y; if (p.n >= STEPS) p.s = 3; }
      if (p.s) { p.end = now; tally[p.s]++; }
    }
    function proj(x, y, z) {
      const px = (x - 0.5) * W * 0.84, py = ((R - 1) / 2 - y) * unit, pz = z * depth;
      const x1 = px * cy - pz * sy, z1 = px * sy + pz * cy;
      const y1 = py * cp - z1 * sp, z2 = py * sp + z1 * cp;
      const k = F / (F + z2);
      X = W / 2 + x1 * k; Y = H * 0.5 + y1 * k;
    }
    function line(x0, y0, z0, x1, y1, z1) {
      ctx.beginPath(); proj(x0, y0, z0); ctx.moveTo(X, Y); proj(x1, y1, z1); ctx.lineTo(X, Y); ctx.stroke();
    }
    function quad(a, b, c, e) {
      ctx.beginPath();
      [a, b, c, e].forEach((p, i) => { proj(p[0], p[1], p[2]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.closePath(); ctx.fill();
    }
    function label(text, x, y, dy, align) {
      if (!hero) return;
      proj(x, y, 0);
      ctx.globalAlpha = 0.95; ctx.textAlign = align || 'left';
      ctx.fillText(text, X + (align === 'right' ? -4 : 4), Y + dy);
    }
    function barrier(y, colour, text, dy) {
      ctx.fillStyle = ctx.strokeStyle = colour;
      ctx.globalAlpha = 0.07; quad([0, y, 0], [1, y, 0], [1, y, 1], [0, y, 1]);
      ctx.lineWidth = 1; ctx.globalAlpha = 0.14;
      for (let j = 1; j < 8; j++) line(j / 8, y, 0, j / 8, y, 1);
      ctx.globalAlpha = 0.35; line(0, y, 1, 1, y, 1); line(0, y, 0, 0, y, 1); line(1, y, 0, 1, y, 1);
      ctx.lineWidth = 1.8; ctx.globalAlpha = 0.95; line(0, y, 0, 1, y, 0);
      label(text, 0, y, dy);
    }
    function draw(now) {
      if (!W || !H) return;
      ctx.clearRect(0, 0, W, H);
      const a = yaw + (running ? Math.sin(now / 3800) * 0.05 : 0);
      cy = Math.cos(a); sy = Math.sin(a); cp = Math.cos(pitch); sp = Math.sin(pitch);
      depth = Math.min(W * 0.5, 380); F = W * 1.6; unit = (H * 0.7) / (R + 1);
      ctx.font = '600 11px ui-monospace, "SF Mono", Menlo, monospace';
      ctx.lineJoin = 'round'; ctx.setLineDash([]);

      // timeout wall, barriers, entry line
      ctx.fillStyle = ctx.strokeStyle = C.mute;
      ctx.globalAlpha = 0.05; quad([1, -1, 0], [1, R, 0], [1, R, 1], [1, -1, 1]);
      ctx.lineWidth = 1; ctx.globalAlpha = 0.4; line(1, -1, 0, 1, R, 0); ctx.globalAlpha = 0.2; line(1, -1, 1, 1, R, 1);
      label('超时', 1, -1, 16, 'right');
      barrier(R, C.ok, '止盈 +' + Rt + 'R', -8);
      barrier(-1, C.bad, '止损 −1R', 16);
      ctx.fillStyle = ctx.strokeStyle = C.gold;
      ctx.lineWidth = 1; ctx.globalAlpha = 0.6; line(0, 0, 0, 0, 0, 1);
      ctx.setLineDash([4, 5]);
      ctx.globalAlpha = 0.22; line(0, 0, 1, 1, 0, 1);
      ctx.globalAlpha = 0.7; line(0, 0, 0, 1, 0, 0);
      ctx.setLineDash([]);
      label('入场', 0, 0, -7);

      // paths, far lanes first
      const colour = [C.gold, C.ok, C.bad, C.mute];
      paths.sort((p, q) => q.z - p.z);
      for (const p of paths) {
        const age = p.s ? (now - p.end) / FADE : 0;
        if (age >= 1 || p.n < 1) continue;
        const near = 1 - p.z * 0.62;
        ctx.strokeStyle = ctx.fillStyle = colour[p.s];
        ctx.globalAlpha = (p.s ? (1 - age) * 0.85 : 0.9) * near;
        ctx.lineWidth = p.s ? 1.15 : 1.5;
        ctx.beginPath();
        for (let i = 0; i <= p.n; i++) {
          proj(i / STEPS, Math.min(p.ys[i], R), p.z);
          i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
        }
        ctx.stroke();
        ctx.beginPath(); ctx.arc(X, Y, p.s ? 2 : 2.4, 0, 6.2832); ctx.fill(); // head / impact point
        if (!p.s) { ctx.globalAlpha *= 0.18; ctx.beginPath(); ctx.arc(X, Y, 7, 0, 6.2832); ctx.fill(); }
        else if (age < 0.45 && running) { // impact ripple on the barrier
          ctx.globalAlpha = (1 - age / 0.45) * near; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(X, Y, 3 + age * 34, 0, 6.2832); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    function hud() {
      if (!out.win) return;
      const w = tally[1], l = tally[2], o = tally[3], n = w + l + o;
      const pc = (v, of) => (of ? (100 * v / of).toFixed(1) + '%' : '—');
      out.win.textContent = pc(w, n); out.loss.textContent = pc(l, n); out.out.textContent = pc(o, n);
      if (out.rate) out.rate.textContent = pc(w, w + l);
      if (out.be) out.be.textContent = (100 / (1 + Rt)).toFixed(1) + '%';
      if (out.n) out.n.textContent = n.toLocaleString('en-US');
      [w, l, o].forEach((v, i) => { if (segs[i]) segs[i].style.flexGrow = n ? Math.max(v / n, 0.004) : 1; });
    }
    function update(dt, now) {
      R += (Rt - R) * Math.min(1, dt / 220);
      yaw += (yawT - yaw) * Math.min(1, dt / 260);
      pitch += (pitchT - pitch) * Math.min(1, dt / 260);
      const cap = hero ? (W < 520 ? 12 : 24) : 9;
      let live = 0;
      for (const p of paths) if (!p.s) live++;
      if (live < cap && now >= spawnAt) { paths.push(spawn()); spawnAt = now + (hero ? 110 : 320); }
      acc += dt * 0.05; // 50 steps per second
      while (acc >= 1) { acc--; for (const p of paths) if (!p.s) advance(p, now); }
      paths = paths.filter(p => !p.s || now - p.end < FADE);
      if (now >= hudAt) { hud(); hudAt = now + 300; }
    }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = now - last;
      if (dt < 12) return; // cap near 60 fps on high-refresh displays
      last = now;
      update(Math.min(dt, 80), now);
      draw(now);
    }
    function still() { // reduced motion: one finished picture and the tally of a larger batch, no animation
      const now = performance.now();
      tally = [0, 0, 0, 0];
      paths = [];
      for (let i = 0; i < 1500; i++) {
        const p = spawn();
        while (!p.s) advance(p, now);
        if (i < (hero ? 26 : 10)) paths.push(p);
      }
      R = Rt; hud(); draw(now);
    }
    function sync() {
      if (reduce.matches) { cancelAnimationFrame(raf); running = false; still(); return; }
      const on = visible && !d.hidden;
      if (on && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
      else if (!on && running) { running = false; cancelAnimationFrame(raf); }
    }
    function size() {
      const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      if (!r.width || !r.height) return;
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!running) draw(performance.now());
    }

    btns.forEach(b => b.addEventListener('click', () => {
      Rt = Number(b.dataset.rr) || 2; sigma = Math.sqrt(Rt / 50);
      btns.forEach(o => o.setAttribute('aria-pressed', String(o === b)));
      const now = performance.now();
      paths.forEach(p => { if (!p.s) { p.s = 3; p.end = now - FADE * 0.5; } }); // retire in-flight paths uncounted
      tally = [0, 0, 0, 0];
      if (reduce.matches) still(); else hud();
    }));
    area.addEventListener('pointermove', e => {
      const r = area.getBoundingClientRect();
      yawT = YAW + ((e.clientX - r.left) / r.width - 0.5) * 0.36;
      pitchT = PITCH - ((e.clientY - r.top) / r.height - 0.5) * 0.16;
    }, { passive: true });
    area.addEventListener('pointerleave', () => { yawT = YAW; pitchT = PITCH; });

    colours(); size(); hud();
    if ('ResizeObserver' in window) new ResizeObserver(size).observe(cv); else addEventListener('resize', size);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { colours(); if (!running) draw(performance.now()); });
    reduce.addEventListener('change', sync);
    d.addEventListener('visibilitychange', sync);
    if (hasIO) new IntersectionObserver(es => { visible = es[es.length - 1].isIntersecting; sync(); }).observe(cv);
    else { visible = true; sync(); }
  }

  function init() {
    XAU.scan();
    reveals();
    rail();
    $$('canvas[data-walk]').forEach(cv => { try { walk(cv); } catch (e) { /* decoration only */ } });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
})();

// Safety net: an entrance animation that never ran (stalled animation clock, e.g. after a
// cross-page view transition in an embedded browser) must not leave content invisible.
(function () {
  var ENTRANCE = { rise: 1, grow: 1, drop: 1, slide: 1 };
  function settle() {
    if (!document.getAnimations) return;
    document.getAnimations().forEach(function (a) {
      try {
        if (ENTRANCE[a.animationName] && a.playState !== 'finished' && !(a.effect && a.effect.getComputedTiming().timeline) &&
            a.effect && isFinite(a.effect.getComputedTiming().endTime) && !(a.timeline && a.timeline.constructor.name !== 'DocumentTimeline')) a.finish();
      } catch (e) {}
    });
  }
  if (window.XAU) window.XAU.settle = settle;
  setTimeout(settle, 3200);
  addEventListener('pageshow', function () { setTimeout(settle, 3200); });
})();
