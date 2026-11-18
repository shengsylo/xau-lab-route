/* xau-lab private content client. Dependency-free, no build step.
   The static site holds no research content: after an email + password sign-in against Supabase Auth,
   tasks and live status are read from Postgres through PostgREST (row level security: owners only)
   and rendered here. Everything that comes back from the database is treated as untrusted text. */
(function () {
  'use strict';

  /* ================= pure helpers (also loaded by the Node test) ================= */
  const STATUSES = { open: '待开始', active: '进行中', blocked: '卡住', done: '完成', killed: '已否决' };
  const STEPS = ['todo', 'active', 'done', 'blocked'];
  const VERDICTS = ['pass', 'fail', 'pending'];
  const SEVERITIES = ['high', 'med', 'low'];
  const JOB_STATES = { running: '运行中', done: '完成', stopped: '已停止' };
  const ID = /^[TL]\d{1,6}$/;
  const PRJ = new URLSearchParams(location.search).get('p') === 'L' ? 'L' : 'T'; // shared table: T = xau-lab, L = LotionExpensesApp
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

  const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  const arr = v => (Array.isArray(v) ? v : []);
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const pick = (v, list, dflt) => (typeof v === 'string' && list.indexOf(v) !== -1 ? v : dflt);
  function text(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return ''; } }
    return String(v);
  }
  /** Escape for element text and for double-quoted attribute values. */
  const esc = v => text(v).replace(/[&<>"'`]/g, c => ESC[c]);
  /** Escape, then allow only `code`, **bold** and line breaks (same markup as the old tools/tracker.py fmt()). Text context only. */
  function fmt(v) {
    return text(v).replace(/[&<>"']/g, c => ESC[c])
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\r?\n/g, '<br>');
  }
  function pct(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n)) * 10) / 10 : 0;
  }
  function day(iso) {
    const t = new Date(typeof iso === 'string' ? iso : NaN);
    if (isNaN(t)) return '';
    const p = n => String(n).padStart(2, '0');
    return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
  }
  const empty = label => `<span class="empty">${label}</span>`;
  const emptyLi = label => `<li class="empty">${label}</li>`;

  /** One row of public.tasks -> a view model with every class/URL value already whitelisted. */
  function normalize(row) {
    row = obj(row);
    const t = obj(row.data);
    const rawId = text(row.id);
    const status = own(STATUSES, t.status) ? t.status : 'open';
    const path = arr(t.path).map(obj), issues = arr(t.issues).map(obj);
    const done = path.filter(s => s.status === 'done').length;
    return {
      id: ID.test(rawId) ? rawId : '', // '' = never used in a URL or a CSS identifier
      rawId, status, title: t.title, summary: t.summary, created: t.created,
      problem: t.problem, idea: t.idea, solution: t.solution,
      path, issues, proof: arr(t.proof).map(obj), data: arr(t.data).map(obj), files: arr(t.files), log: arr(t.log).map(obj),
      updated: day(row.updated_at),
      pct: path.length ? Math.round(100 * done / path.length) : (status === 'done' ? 100 : 0),
      openIssues: issues.filter(i => i.open === undefined || i.open === null || !!i.open).length,
    };
  }
  const idNum = t => (t.id ? Number(t.id.slice(1)) : -1);
  const newestFirst = (a, b) => idNum(b) - idNum(a);

  function renderCard(t) {
    return `<a class="card st-${t.status}"${t.id ? ` href="task.html?id=${t.id}"` : ''} style="--pct:${t.pct}${t.id ? ';view-transition-name:' + t.id.toLowerCase() : ''}">` +
      `<header><code>${esc(t.rawId)}</code><b class="chip">${STATUSES[t.status]}</b></header>` +
      `<h2>${fmt(t.title)}</h2><p>${fmt(t.summary)}</p>` +
      `<div class="bar"><i></i></div>` +
      `<footer><span>${t.pct}%</span><span>${t.openIssues} 个未解决问题</span><time>${esc(t.updated)}</time></footer></a>`;
  }
  const renderCards = tasks => tasks.map(renderCard).join('');
  function renderTally(tasks) {
    return Object.keys(STATUSES).map(s => {
      const n = tasks.filter(t => t.status === s).length;
      return n ? `<li class="st-${s}"><b>${n}</b><span>${STATUSES[s]}</span></li>` : '';
    }).join('');
  }
  /** The task page, as one HTML string per slot of the shell (tools/task.template.html). */
  function renderTask(t) {
    const step = s => pick(s.status, STEPS, 'todo');
    return {
      hero:
        `<div class="headrow"><div class="ring"><span>${t.pct}%</span></div>` +
        `<div><code>${esc(t.rawId)}</code> <b class="chip">${STATUSES[t.status]}</b></div></div>` +
        `<h1${t.id ? ` style="view-transition-name:${t.id.toLowerCase()}"` : ''}>${fmt(t.title)}</h1>` +
        `<p class="lede">${fmt(t.summary)}</p>` +
        `<div class="meta"><span>创建 ${esc(t.created)}</span><span>更新 ${esc(t.updated)}</span></div>`,
      slabs: t.path.map((s, i) => `<li class="slab s-${step(s)}" style="--i:${i}"><span>${fmt(s.step)}</span></li>`).join('') ||
        '<li class="slab s-todo" style="--i:0"><span>—</span></li>',
      problem: fmt(t.problem) || empty('未填'),
      idea: fmt(t.idea) || empty('未填'),
      solution: fmt(t.solution) || empty('还没有结论'),
      proof: t.proof.map(p => {
        const v = pick(p.verdict, VERDICTS, 'pending');
        return `<article class="proof v-${v}"><b>${v}</b><h3>${fmt(p.claim)}</h3><p>${fmt(p.evidence)}</p></article>`;
      }).join('') || `<p class="empty">还没有证据</p>`,
      path: t.path.map(s => `<li class="s-${step(s)}"><i></i><span>${fmt(s.step)}</span></li>`).join('') || emptyLi('未定步骤'),
      issues: t.issues.map(i => {
        const sev = pick(i.severity, SEVERITIES, 'med');
        const open = i.open === undefined || i.open === null || !!i.open;
        return `<li class="sev-${sev}${open ? '' : ' closed'}"><b>${sev}</b><span>${fmt(i.text)}</span></li>`;
      }).join('') || emptyLi('没有未解决的问题'),
      data: t.data.map(x => `<div class="stat"><dt>${fmt(x.k)}</dt><dd>${fmt(x.v)}</dd><small>${fmt(x.note)}</small></div>`).join('') ||
        `<p class="empty">还没有数据</p>`,
      files: t.files.map(p => `<li><code>${fmt(p)}</code></li>`).join('') || emptyLi('—'),
      log: t.log.slice().reverse().map(e => `<li><time>${esc(e.at)}</time><span>${fmt(e.text)}</span></li>`).join('') || emptyLi('—'),
    };
  }
  function renderJobs(jobs) {
    return arr(jobs).map(obj).map(j => {
      const state = own(JOB_STATES, j.state) ? j.state : 'stopped';
      const task = text(j.task), p = pct(j.pct);
      return `<a class="job j-${state}" style="--pct:${p}"${ID.test(task) ? ` href="task.html?id=${task}"` : ''}>` +
        `<header><i class="beacon"></i><b class="chip">${JOB_STATES[state]}</b><strong>${esc(j.name)}</strong><span class="num">${p}%</span></header>` +
        `<div class="bar"><i></i></div>` +
        `<p>${esc(j.detail)}</p>` +
        `<footer><span>${esc(j.done)}</span><span>${esc(j.last_event)}</span><span>${j.eta ? '预计完成 ' + esc(j.eta) : ''}</span></footer></a>`;
    }).join('');
  }
  function ageText(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    return m < 1 ? '刚刚更新' : m < 60 ? m + ' 分钟前更新' : Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分钟前更新';
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { esc, fmt, pct, day, normalize, newestFirst, renderCard, renderCards, renderTally, renderTask, renderJobs, ageText, ID, STATUSES };
  }
  if (typeof document === 'undefined') return;

  /* ================= browser ================= */
  const d = document, root = d.documentElement;
  const $ = (s, r) => (r || d).querySelector(s);
  const KEY = 'xau.session';
  const STALE_MIN = 3; // tools/status.py refreshes the row every 60 s
  const now = () => Math.floor(Date.now() / 1000);
  const scan = () => { try { if (window.XAU && window.XAU.scan) window.XAU.scan(); } catch (e) { /* motion is optional */ } };
  const httpCode = n => Math.trunc(Number(n)) || 0;
  const fail = (kind, status) => Object.assign(new Error(kind), { kind, status });

  /* ---------- config (docs/config.js, generated from .env: publishable key only) ---------- */
  let configError = '';
  function readConfig() {
    const c = window.XAU_CONFIG;
    if (!c || typeof c.url !== 'string' || typeof c.key !== 'string' || !c.url || !c.key) {
      configError = '缺少 config.js（项目地址和 publishable key），无法连接数据库。';
      return null;
    }
    let u;
    try { u = new URL(c.url); } catch (e) { configError = 'config.js 里的地址无效。'; return null; }
    const local = ['localhost', '127.0.0.1', '[::1]'].indexOf(u.hostname) !== -1;
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) { configError = 'config.js 里的地址必须是 https。'; return null; }
    let role = '';
    try { role = text(JSON.parse(atob(c.key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role); } catch (e) { /* not a JWT-style key */ }
    if (/^sb_secre[t]_/.test(c.key) || role === 'service_role') {
      configError = 'config.js 里放的是 secret key，已拒绝使用。请立刻在 Supabase 后台轮换这把 key。';
      return null;
    }
    return { url: u.origin, key: c.key };
  }
  const cfg = readConfig();

  /* ---------- session ---------- */
  let session = null, refreshing = null, refreshTimer = 0;
  function valid(s) {
    return s && typeof s.access_token === 'string' && typeof s.refresh_token === 'string' && Number.isFinite(s.expires_at) ? s : null;
  }
  function stored() {
    try { return valid(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { return null; }
  }
  function fromToken(j) {
    j = obj(j);
    return valid({
      access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: Number(j.expires_at) || now() + (Number(j.expires_in) || 3600),
    });
  }
  function save(s) {
    session = s;
    try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch (e) { /* private mode: session lives for this page only */ }
    root.dataset.auth = s ? 'in' : 'out';
    schedule();
  }
  function schedule() {
    clearTimeout(refreshTimer);
    if (!session) return;
    const left = session.expires_at - now(); // refresh 90 s early, or halfway when the token is short-lived
    const ms = Math.min(2147000000, Math.max(5000, (left > 180 ? left - 90 : left / 2) * 1000));
    refreshTimer = setTimeout(() => {
      refresh().then(ok => { if (!ok) gate('登录已过期，请重新登录。'); })
        .catch(() => { refreshTimer = setTimeout(schedule, 30000); });
    }, ms);
  }

  /* ---------- Supabase over plain fetch ---------- */
  async function request(path, opt) {
    opt = opt || {};
    const headers = { apikey: cfg.key, Accept: 'application/json' };
    if (opt.token) headers.Authorization = 'Bearer ' + opt.token;
    if (opt.body) headers['Content-Type'] = 'application/json';
    const ctl = 'AbortController' in window ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), 15000);
    try {
      const res = await fetch(cfg.url + path, {
        method: opt.method || 'GET', headers, cache: 'no-store', credentials: 'omit',
        body: opt.body ? JSON.stringify(opt.body) : undefined, signal: ctl ? ctl.signal : undefined,
      });
      let json = null;
      try { json = await res.json(); } catch (e) { /* empty body */ }
      return { ok: res.ok, status: res.status, json };
    } catch (e) {
      throw fail('net');
    } finally { clearTimeout(timer); }
  }
  async function signIn(email, password) {
    const r = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    const s = r.ok ? fromToken(r.json) : null;
    if (s) return save(s);
    const code = text(obj(r.json).error_code);
    throw fail(code === 'email_not_confirmed' ? 'unconfirmed' : r.status === 429 ? 'rate' : (r.status === 400 || r.status === 401) ? 'cred' : 'http', r.status);
  }
  /** Resolves true when a usable session is in place, false when the user must sign in again. */
  function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const mine = session;
      if (!mine) return false;
      const other = stored(); // another tab may already have rotated the refresh token
      if (other && other.refresh_token !== mine.refresh_token && other.expires_at - now() > 60) { session = other; schedule(); return true; }
      const r = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: mine.refresh_token } });
      // The request was in flight: if the user signed out (here or in another tab) or another session was
      // adopted meanwhile, this answer belongs to a session that is gone. Never write its tokens back.
      if (session !== mine) { if (session) return true; throw fail('auth'); }
      const s = r.ok ? fromToken(r.json) : null;
      if (s) { save(s); return true; }
      if (r.status === 400 || r.status === 401 || r.status === 403) {
        const again = stored();
        if (again && again.refresh_token !== mine.refresh_token) { session = again; schedule(); return true; }
        save(null);
        return false;
      }
      throw fail('http', r.status);
    })();
    const done = () => { refreshing = null; };
    refreshing.then(done, done);
    return refreshing;
  }
  /** Authenticated read. Refreshes before expiry and once on 401. */
  async function api(path) {
    if (!session) throw fail('auth');
    if (session.expires_at - now() < 30 && !(await refresh())) throw fail('auth');
    let r = await request(path, { token: session.access_token });
    if (r.status === 401) {
      if (!(await refresh())) throw fail('auth');
      r = await request(path, { token: session.access_token });
      if (r.status === 401) { save(null); throw fail('auth'); }
    }
    if (!r.ok) throw fail('http', r.status);
    return r.json;
  }
  const isOwner = async () => arr(await api('/rest/v1/owners?select=user_id&limit=1')).length > 0;

  /* ---------- shared UI ---------- */
  const page = d.body.dataset.page;
  const form = $('form.login'), msgEl = form && $('.msg', form), stateEl = $('#state');
  let gen = 0; // bumps on every load / sign-out so a late response never renders into the wrong state

  function msg(t) { if (msgEl) msgEl.textContent = t || ''; }
  function state(kind, t, retry) {
    if (!stateEl) return;
    stateEl.hidden = !kind;
    stateEl.className = 'state authed' + (kind ? ' s-' + kind : '');
    stateEl.textContent = t || '';
    if (retry) {
      const b = d.createElement('button');
      b.type = 'button'; b.textContent = '重试';
      b.addEventListener('click', load);
      stateEl.appendChild(b);
    }
  }
  function problem(e) {
    if (e && e.kind === 'auth') return gate('登录已过期，请重新登录。');
    if (e && e.kind === 'net') return state('error', '连不上数据库，请检查网络。', true);
    if (e && e.kind === 'http') return state('error', '读取失败（HTTP ' + httpCode(e.status) + '）。' + (e.status === 404 ? '数据库表可能还没建好。' : ''), true);
    state('error', '页面出错了。', true);
  }
  /** Back to the signed-out face: drop the session and every piece of fetched content from the DOM. */
  function gate(message) {
    gen++;
    if (session || root.dataset.auth !== 'out') save(null);
    clear();
    state(null);
    msg(message);
  }
  function signOut() {
    const token = session && session.access_token;
    gate('已退出。');
    if (token && cfg) request('/auth/v1/logout?scope=local', { method: 'POST', token }).catch(() => {});
  }
  function load() { return page === 'task' ? loadTask() : loadIndex(); }
  function clear() { if (page === 'task') clearTask(); else clearIndex(); }

  /* ---------- index: cards + live jobs ---------- */
  const TITLE = PRJ === 'L' ? 'Millionaire 记账 App' : '黄金概率实验';
  let liveOn = false, stamp = NaN, shown = '';
  function clearIndex() {
    liveOn = false; stamp = NaN; shown = '';
    $('#intro-title').textContent = TITLE;
    for (const id of ['tally', 'cards', 'live-jobs']) $('#' + id).innerHTML = '';
    for (const id of ['tally', 'cards', 'live']) $('#' + id).hidden = true;
    $('#updated').textContent = '';
    $('#live-age').textContent = '';
  }
  async function loadIndex() {
    const my = ++gen;
    state('loading', '读取中…');
    try {
      const rows = await api('/rest/v1/tasks?select=id,slug,data,updated_at&id=like.' + PRJ + '*&order=id.desc');
      if (my !== gen) return;
      const tasks = arr(rows).map(normalize).sort(newestFirst);
      if (!tasks.length) {
        const owner = await isOwner();
        if (my !== gen) return;
        clearIndex();
        return owner ? state('empty', '还没有任务。') : state('denied', '这个账号没有访问权限。');
      }
      $('#intro-title').innerHTML = TITLE + ' <b>' + tasks.length + '</b> 个任务';
      const tally = $('#tally'), cards = $('#cards');
      tally.innerHTML = renderTally(tasks); tally.hidden = false;
      cards.innerHTML = renderCards(tasks); cards.hidden = false;
      const latest = tasks.map(t => t.updated).sort().pop();
      $('#updated').textContent = latest ? '更新 ' + latest : '';
      state(null);
      scan();
      liveOn = true;
      loadLive();
    } catch (e) { if (my === gen) problem(e); }
  }
  function age() {
    const el = $('#live-age');
    if (!el || isNaN(stamp)) return;
    const ms = Date.now() - stamp;
    el.textContent = ageText(ms);
    el.classList.toggle('stale', ms > STALE_MIN * 60000);
  }
  async function loadLive() {
    if (!liveOn || !session || d.hidden) return;
    const my = gen;
    try {
      const rows = await api('/rest/v1/status?id=eq.1&select=data,updated_at');
      if (my !== gen) return;
      const row = obj(arr(rows)[0]), jobs = arr(obj(row.data).jobs);
      const live = $('#live');
      if (!jobs.length) { live.hidden = true; shown = ''; return; }
      stamp = Date.parse(text(row.updated_at));
      const sig = JSON.stringify(jobs);
      if (sig !== shown) { // unchanged: keep the DOM so nothing re-animates
        shown = sig;
        $('#live-jobs').innerHTML = renderJobs(jobs);
        live.hidden = false;
        scan();
      }
      age();
    } catch (e) {
      if (my !== gen) return;
      if (e && e.kind === 'auth') gate('登录已过期，请重新登录。'); else age(); // keep the last panel; the age label turns stale
    }
  }

  /* ---------- task page ---------- */
  const SLOTS = ['problem', 'idea', 'proof', 'solution', 'path', 'issues', 'data', 'files', 'log'];
  const PLACEHOLDER = [0, 1, 2].map(i => `<li class="slab s-todo" style="--i:${i}"></li>`).join('');
  function clearTask() {
    const main = $('main');
    main.className = ''; main.style.removeProperty('--pct');
    $('#hero-copy').innerHTML = '';
    $('#stack').innerHTML = PLACEHOLDER;
    for (const k of SLOTS) $('[data-f="' + k + '"]').innerHTML = '';
    $('#secnav').hidden = true; $('#grid').hidden = true;
    d.title = 'xau-lab';
  }
  async function loadTask() {
    const my = ++gen;
    const id = new URLSearchParams(location.search).get('id') || '';
    if (!ID.test(id)) return state('error', '任务编号无效。');
    state('loading', '读取中…');
    try {
      const rows = await api('/rest/v1/tasks?select=id,slug,data,updated_at&id=eq.' + id);
      if (my !== gen) return;
      if (!arr(rows).length) {
        const owner = await isOwner();
        if (my !== gen) return;
        clearTask();
        return owner ? state('empty', '没有 ' + id + ' 这个任务。') : state('denied', '这个账号没有访问权限。');
      }
      const t = normalize(rows[0]), html = renderTask(t), main = $('main');
      main.className = 'st-' + t.status; main.style.setProperty('--pct', t.pct);
      $('#hero-copy').innerHTML = html.hero;
      $('#stack').innerHTML = html.slabs;
      for (const k of SLOTS) $('[data-f="' + k + '"]').innerHTML = html[k];
      $('#secnav').hidden = false; $('#grid').hidden = false;
      d.title = id + ' · ' + text(t.title);
      state(null);
      scan();
      if (/^#[a-z]+$/.test(location.hash)) { const s = $(location.hash); if (s) s.scrollIntoView(); }
    } catch (e) { if (my === gen) problem(e); }
  }

  /* ---------- wiring ---------- */
  if (form) form.addEventListener('submit', async e => {
    e.preventDefault(); // credentials only ever travel in the POST body to Supabase Auth
    if (!cfg) return msg(configError);
    const email = form.elements.email.value.trim(), password = form.elements.password.value;
    if (!email || !password) return msg('请输入邮箱和密码。');
    const btn = $('button[type="submit"]', form);
    btn.disabled = true; btn.textContent = '登录中…'; msg('');
    try {
      await signIn(email, password);
      form.elements.password.value = '';
      load();
    } catch (err) {
      const k = err && err.kind;
      msg(k === 'cred' ? '邮箱或密码不对。' : k === 'unconfirmed' ? '这个邮箱还没确认。' : k === 'rate' ? '尝试太频繁，稍后再试。' :
        k === 'net' ? '连不上服务器，请检查网络。' : '登录失败（HTTP ' + httpCode(err && err.status) + '）。');
    } finally { btn.disabled = false; btn.textContent = '登录'; }
  });
  const out = $('#signout');
  if (page === 'index' && out) {
    const sw = d.createElement('a');
    sw.href = PRJ === 'L' ? 'index.html' : 'index.html?p=L';
    sw.textContent = PRJ === 'L' ? 'xau-lab' : 'Millionaire';
    sw.style.cssText = 'margin-right:.9em;color:inherit';
    out.before(sw);
  }
  if (out) out.addEventListener('click', signOut);

  addEventListener('storage', e => { // sign-in / sign-out in another tab
    if (e.key !== KEY && e.key !== null) return;
    const s = stored();
    if (!s && session) { session = null; gate('已在其他标签页退出。'); }
    else if (s && !session) { session = s; root.dataset.auth = 'in'; schedule(); msg(''); load(); }
    else if (s) { session = s; schedule(); }
  });
  d.addEventListener('visibilitychange', () => {
    if (d.hidden || !session) return;
    if (session.expires_at - now() < 90) refresh().then(ok => { if (!ok) gate('登录已过期，请重新登录。'); }).catch(() => {});
    loadLive();
  });
  // A page restored from the back/forward cache comes back frozen as it was: rendered content, the old
  // in-memory session, and no 'storage' events while it slept. Re-check it against localStorage.
  addEventListener('pageshow', e => {
    if (!e.persisted || !cfg) return;
    const s = stored();
    if (!s) { session = null; gate(''); }
    else if (!session || s.refresh_token !== session.refresh_token) { session = s; root.dataset.auth = 'in'; schedule(); msg(''); load(); }
    else loadLive();
  });
  if (page === 'index') { setInterval(loadLive, 60000); setInterval(age, 30000); }

  clear();
  if (!cfg) {
    session = null; root.dataset.auth = 'out';
    msg(configError);
    if (form) $('button[type="submit"]', form).disabled = true;
    return;
  }
  session = stored();
  root.dataset.auth = session ? 'in' : 'out';
  if (session) { schedule(); load(); }
})();
