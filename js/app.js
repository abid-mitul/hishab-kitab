/* Hishab Kitab — main app (Phase 1)
 * Developed by: Md Abid Hassan Mitul. Internal Use Only. */
(function () {
  'use strict';

  /* ---------------- storage & state ---------------- */
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Storage full — sync soon'); } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var S = {
    api: (window.HK_CONFIG && window.HK_CONFIG.API_URL) || LS.get('hk_api', ''),
    session: LS.get('hk_session', null),            // {token,user,role}
    data: LS.get('hk_cache', null),                 // {expenses,categories,flags,settings}
    outbox: LS.get('hk_outbox', []),
    prefs: LS.get('hk_prefs', { lang: 'en', theme: 'auto', lastUser: '' }),
    month: ym(new Date()),
    listF: null, selectMode: false, selected: {}, binSel: {},
    syncing: false, lastSync: LS.get('hk_lastsync', ''), installEvt: null, charts: [], logCache: null
  };
  var COLORS = ['#0f6b63', '#e07a4f', '#3a72b8', '#c98a12', '#8e5bb5', '#2f8f5b', '#c8443b', '#4fa3a5', '#b5835a', '#6b7a8f', '#d4689a', '#7aa33a'];
  var $app = document.getElementById('app'), $sheet = document.getElementById('sheet-root');

  /* ---------------- helpers ---------------- */
  function L() { return I18N[S.prefs.lang] || I18N.en; }
  function t(k, vars) {
    var s = L()[k]; if (s === undefined) s = I18N.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split('{' + v + '}').join(vars[v]); });
    return s;
  }
  function bn(s) { s = String(s); return S.prefs.lang === 'bn' ? s.replace(/[0-9]/g, function (d) { return '০১২৩৪৫৬৭৮৯'[d]; }) : s; }
  function num(n, dec) { return bn(Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: dec === undefined ? 0 : dec })); }
  function money(n) { return '৳' + num(Math.round(Number(n || 0))); }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dstr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function ym(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function today() { return dstr(new Date()); }
  function parseD(s) { var p = String(s).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function daysIn(ymS) { var p = ymS.split('-'); return new Date(+p[0], +p[1], 0).getDate(); }
  function shiftYm(ymS, k) { var p = ymS.split('-'); return ym(new Date(+p[0], +p[1] - 1 + k, 1)); }
  function monthName(ymS) { var p = ymS.split('-'); return L().months[+p[1] - 1] + ' ' + bn(p[0]); }
  function prettyDate(s) {
    if (!s) return ''; if (s === today()) return t('today');
    if (s === dstr(new Date(Date.now() - 864e5))) return t('yesterday');
    var d = parseD(s); return bn(d.getDate()) + ' ' + L().months[d.getMonth()].slice(0, S.prefs.lang === 'bn' ? 20 : 3) + (d.getFullYear() !== new Date().getFullYear() ? ' ' + bn(d.getFullYear()) : '');
  }
  function prettyTs(s) {
    if (!s) return ''; var d = new Date(s); if (isNaN(d)) return s;
    var h = d.getHours(), m = pad(d.getMinutes()), ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
    return prettyDate(dstr(d)) + ', ' + bn(h + ':' + m) + ' ' + ap;
  }
  function isAdmin() { return S.session && S.session.role === 'admin'; }
  function me() { return S.session ? S.session.user : ''; }
  function userLabel(u) { return u === 'Husband' ? t('husband') : u === 'Wife' ? t('wife') : esc(u); }
  function cats() { return (S.data && S.data.categories) || []; }
  function cat(id) { return cats().filter(function (c) { return c.id === id; })[0] || { id: id, name: id, nameBn: id, icon: '📦', budget: 0 }; }
  function catName(c) { c = typeof c === 'string' ? cat(c) : c; return S.prefs.lang === 'bn' ? (c.nameBn || c.name) : c.name; }
  function payName(id) { var p = PAYMENTS.filter(function (x) { return x.id === id; })[0]; return p ? p[S.prefs.lang] : id; }
  function spentForList() { return (S.data && S.data.settings && S.data.settings.spentFor) || []; }
  function sfName(n) { if (!n) return t('notSpecified'); var x = spentForList().filter(function (s) { return s.name === n; })[0]; return x && S.prefs.lang === 'bn' ? x.nameBn || x.name : n; }
  function active() { return ((S.data && S.data.expenses) || []).filter(function (e) { return e.status !== 'deleted'; }); }
  function inMonth(list, ymS) { return list.filter(function (e) { return String(e.date).slice(0, 7) === ymS; }); }
  function sum(list) { return list.reduce(function (a, e) { return a + (Number(e.amount) || 0); }, 0); }
  function groupSum(list, key) { var o = {}; list.forEach(function (e) { var k = typeof key === 'function' ? key(e) : e[key]; o[k] = (o[k] || 0) + Number(e.amount || 0); }); return o; }
  function median(a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function openFlags() { return ((S.data && S.data.flags) || []).filter(function (f) { return f.status === 'open'; }); }
  function pendingIds() { var o = {}; S.outbox.forEach(function (op) { if (op.data && op.data.id) o[op.data.id] = 1; }); return o; }
  function save() { LS.set('hk_cache', S.data); LS.set('hk_outbox', S.outbox); }
  function savePrefs() { LS.set('hk_prefs', S.prefs); }

  var toastT;
  function toast(msg, ms) {
    var el = document.getElementById('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('show'); }, ms || 2600);
  }
  function footer() { return '<div class="footer"><b>' + esc(t('footer1')) + '</b><br>' + esc(t('footer2')) + '</div>'; }

  /* ---------------- API ---------------- */
  function api(action, body) {
    body = body || {}; body.action = action; if (S.session) body.token = S.session.token;
    return fetch(S.api, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (res) {
        if (!res.ok && res.error === 'AUTH') { logoutLocal(); toast(t('sessionExpired')); throw new Error('AUTH'); }
        return res;
      });
  }

  /* ---------------- sync engine ---------------- */
  function queue(op, data) {
    var o = { opId: uid(), op: op, data: data, at: new Date().toISOString() };
    S.outbox.push(o); applyLocal(o); save(); flush(); return o;
  }
  function applyLocal(o) {
    var d = o.data, ex = S.data.expenses;
    if (o.op === 'add') {
      if (!ex.some(function (e) { return e.id === d.id; }))
        ex.push({ id: d.id, date: d.date, amount: Number(d.amount), category: d.category, payment: d.payment, spentFor: d.spentFor || '',
          place: d.place || '', note: d.note || '', receiptUrl: d.receiptData ? 'local' : '', createdBy: me(), createdAt: d.createdAt, status: 'active' });
    } else if (o.op === 'edit') {
      ex.forEach(function (e) { if (e.id === d.id) { ['date', 'amount', 'category', 'payment', 'spentFor', 'place', 'note'].forEach(function (f) { if (d[f] !== undefined) e[f] = f === 'amount' ? Number(d[f]) : d[f]; }); e.updatedBy = me(); e.updatedAt = o.at; } });
    } else if (o.op === 'delete') {
      var set = {}; d.ids.forEach(function (i) { set[i] = 1; });
      ex.forEach(function (e) { if (set[e.id]) { e.status = 'deleted'; e.deletedAt = o.at; e.deletedBy = me(); } });
    } else if (o.op === 'flag') {
      S.data.flags.push({ id: d.id, expenseId: d.expenseId, note: d.note, createdBy: me(), createdAt: o.at, status: 'open' });
    } else if (o.op === 'resolveFlag') {
      S.data.flags.forEach(function (f) { if (f.id === d.id) { f.status = 'resolved'; f.resolvedBy = me(); } });
    }
  }
  function flush() {
    if (S.syncing || !S.session || !S.api) return Promise.resolve();
    if (!navigator.onLine) { updateSyncPill(); return Promise.resolve(); }
    S.syncing = true; updateSyncPill();
    var ops = S.outbox.slice();
    return api(ops.length ? 'sync' : 'state', ops.length ? { ops: ops } : {})
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || 'error');
        var done = {}, failed = [];
        (res.results || []).forEach(function (r) { done[r.opId] = 1; if (!r.ok) failed.push(r.error); });
        S.outbox = S.outbox.filter(function (o) { return !done[o.opId]; });
        S.data = res.state; S.outbox.forEach(applyLocal);
        S.lastSync = new Date().toISOString(); LS.set('hk_lastsync', S.lastSync); save();
        if (failed.length) toast('⚠️ ' + failed[0], 4000);
        S.syncing = false; refresh();
      })
      .catch(function (e) { S.syncing = false; updateSyncPill(); if (String(e.message) !== 'AUTH') console.warn('sync failed', e); });
  }
  /** Online-only operation (admin tools): sends immediately. */
  function runNow(op, data) {
    if (!navigator.onLine) { toast(t('needsOnline')); return Promise.reject(new Error('offline')); }
    var loader = toastLoading();
    return api('sync', { ops: S.outbox.concat([{ opId: 'now_' + uid(), op: op, data: data }]) }).then(function (res) {
      loader();
      if (!res.ok) throw new Error(res.error);
      var done = {}; (res.results || []).forEach(function (r) { done[r.opId] = r; });
      S.outbox = S.outbox.filter(function (o) { return !done[o.opId]; });
      S.data = res.state; save(); S.lastSync = new Date().toISOString(); LS.set('hk_lastsync', S.lastSync);
      var mine = (res.results || []).filter(function (r) { return r.opId.indexOf('now_') === 0; })[0];
      if (mine && !mine.ok) throw new Error(mine.error);
      return mine ? mine.data : null;
    }).catch(function (e) { loader(); if (e.message !== 'AUTH') toast('⚠️ ' + e.message, 4000); throw e; });
  }
  function toastLoading() { var el = document.getElementById('toast'); el.innerHTML = '<span class="spin" style="width:16px;height:16px;vertical-align:-3px"></span> ' + esc(t('loading')); el.classList.add('show'); clearTimeout(toastT); return function () { el.classList.remove('show'); }; }

  function updateSyncPill() {
    var el = document.getElementById('syncpill'); if (!el) return;
    var n = S.outbox.length;
    if (!navigator.onLine) { el.className = 'pill off'; el.innerHTML = '● ' + t('offline') + (n ? ' · ' + bn(n) : ''); }
    else if (S.syncing) { el.className = 'pill'; el.innerHTML = '<span class="spin" style="width:12px;height:12px;border-width:2px"></span>'; }
    else if (n) { el.className = 'pill off'; el.innerHTML = '↻ ' + bn(n) + ' ' + t('pendingSync'); }
    else { el.className = 'pill'; el.innerHTML = '✓ ' + t('online'); }
  }

  /* ---------------- analytics & alerts ---------------- */
  function monthStats(ymS) {
    var list = inMonth(active(), ymS), total = sum(list), dim = daysIn(ymS), cur = ymS === ym(new Date());
    var day = cur ? new Date().getDate() : dim;
    var todayAmt = cur ? sum(list.filter(function (e) { return e.date === today(); })) : 0;
    var forecast = cur && day >= 3 ? total / day * dim : total;
    // same-days comparison with previous month
    var pm = shiftYm(ymS, -1), lim = Math.min(day, daysIn(pm));
    var prevSame = sum(inMonth(active(), pm).filter(function (e) { return +String(e.date).slice(8, 10) <= lim; }));
    var nowSame = sum(list.filter(function (e) { return +String(e.date).slice(8, 10) <= day; }));
    return { list: list, total: total, dim: dim, day: day, cur: cur, today: todayAmt, avg: total / Math.max(1, day), forecast: forecast,
      prevSame: prevSame, nowSame: nowSame, budget: (S.data.settings && S.data.settings.overallBudget) || 0 };
  }

  function computeAlerts() {
    if (!S.data) return [];
    var out = [], m = monthStats(ym(new Date())), B = m.budget;
    function add(level, text, link) { out.push({ level: level, text: text, link: link }); }
    if (isAdmin() && openFlags().length) add('warn', t('aFlags', { n: bn(openFlags().length) }), '#/flags');
    if (S.outbox.length) add('info', t('aPending', { n: bn(S.outbox.length) }));
    if (B > 0) {
      var pct = Math.round(m.total / B * 100);
      if (m.total >= B) add('danger', t('aOverallOver', { spent: num(m.total), budget: num(B) }), '#/budgets');
      else if (pct >= 80) add('warn', t('aOverallNear', { pct: bn(pct), spent: num(m.total), budget: num(B) }), '#/budgets');
      if (m.total < B && m.day >= 5 && m.forecast > B) add('warn', t('aForecast', { fc: num(m.forecast), over: num(m.forecast - B) }));
    } else if (isAdmin()) add('info', t('aNoBudget'), '#/budgets');
    var byCat = groupSum(m.list, 'category');
    cats().forEach(function (c) {
      if (!(c.budget > 0)) return;
      var s = byCat[c.id] || 0, p = Math.round(s / c.budget * 100), v = { cat: (c.icon || '') + ' ' + catName(c), spent: num(s), budget: num(c.budget), pct: bn(p) };
      if (s >= c.budget) add('danger', t('aCatOver', v), '#/budgets');
      else if (p >= 80) add('warn', t('aCatNear', v), '#/budgets');
      else if (m.day >= 7) { var fc = s / m.day * m.dim; if (fc > c.budget * 1.1) add('info', t('aCatForecast', { cat: v.cat, fc: num(fc), budget: v.budget })); }
    });
    // unusual single expenses this month
    var all = active(), cutoff = dstr(new Date(Date.now() - 120 * 864e5)), unusual = [];
    m.list.forEach(function (e) {
      var hist = all.filter(function (x) { return x.category === e.category && x.id !== e.id && x.date >= cutoff; }).map(function (x) { return Number(x.amount); });
      if (hist.length < 4) return;
      var md = median(hist);
      if (e.amount >= md * 3 && e.amount - md >= 500) unusual.push({ e: e, md: md });
    });
    unusual.sort(function (a, b) { return b.e.date < a.e.date ? -1 : 1; }).slice(0, 3).forEach(function (u) {
      add('warn', t('aUnusual', { cat: cat(u.e.category).icon + ' ' + catName(u.e.category), amt: num(u.e.amount), date: prettyDate(u.e.date), typ: num(u.md) }));
    });
    if (m.day >= 7 && m.today >= 1000 && m.day > 1) {
      var avgPrev = (m.total - m.today) / (m.day - 1);
      if (avgPrev > 0 && m.today > avgPrev * 2) add('info', t('aTodayHigh', { today: num(m.today), avg: num(avgPrev) }));
    }
    // month-over-month by category (same days)
    var pm = shiftYm(ym(new Date()), -1), lim = Math.min(m.day, daysIn(pm));
    var prevBy = groupSum(inMonth(all, pm).filter(function (e) { return +e.date.slice(8, 10) <= lim; }), 'category');
    var nowBy = groupSum(m.list.filter(function (e) { return +e.date.slice(8, 10) <= m.day; }), 'category');
    var moves = [];
    Object.keys(Object.assign({}, prevBy, nowBy)).forEach(function (k) {
      var a = nowBy[k] || 0, b = prevBy[k] || 0;
      if (b >= 500 && a >= b * 1.3 && a - b >= 1000) moves.push({ k: k, up: true, pct: Math.round((a / b - 1) * 100), a: a, b: b });
      else if (m.day >= 10 && b >= 1000 && a <= b * 0.7 && b - a >= 1000) moves.push({ k: k, up: false, pct: Math.round((1 - a / b) * 100), a: a, b: b });
    });
    moves.sort(function (x, y) { return Math.abs(y.a - y.b) - Math.abs(x.a - x.b); }).slice(0, 4).forEach(function (mv) {
      var c = cat(mv.k).icon + ' ' + catName(mv.k);
      if (mv.up) add('info', t('aUp', { cat: c, pct: bn(mv.pct), now: num(mv.a), prev: num(mv.b) }));
      else add('good', t('aDown', { cat: c, pct: bn(mv.pct) }));
    });
    var order = { danger: 0, warn: 1, info: 2, good: 3 };
    return out.sort(function (a, b) { return order[a.level] - order[b.level]; });
  }
  function alertCount() { return computeAlerts().filter(function (a) { return a.level === 'danger' || a.level === 'warn'; }).length; }

  /* ---------------- router ---------------- */
  function route() { return (location.hash || '#/home').slice(2).split('/'); }
  function go(h) { if (location.hash === h) refresh(); else location.hash = h; }
  window.addEventListener('hashchange', function () { S.selectMode = false; S.selected = {}; refresh(); window.scrollTo(0, 0); });

  function refresh() {
    S.charts.forEach(function (c) { try { c.destroy(); } catch (e) {} }); S.charts = [];
    document.documentElement.lang = S.prefs.lang;
    if (!S.api) return renderSetup();
    if (!S.session) return renderLogin();
    if (!S.data) return renderLoading();
    var r = route(), page = r[0];
    var map = { home: renderHome, add: renderAdd, list: renderList, alerts: renderAlerts, more: renderMore, budgets: renderBudgets,
      categories: renderCategories, spentfor: renderSpentFor, bin: renderBin, log: renderLog, flags: renderFlags };
    var adminPages = { categories: 1, spentfor: 1, bin: 1, log: 1, flags: 1 };
    if (adminPages[page] && !isAdmin()) page = 'home';
    (map[page] || renderHome)(r);
    updateSyncPill();
  }

  function layout(title, sub, body, opts) {
    opts = opts || {};
    var r = route()[0], ac = alertCount();
    var nav = [['home', '🏠', t('home')], ['list', '🧾', t('list')], ['add', '+', ''], ['alerts', '🔔', t('alerts')], ['more', '☰', t('more')]];
    $app.innerHTML =
      '<div class="shell"><div class="topbar">' + (opts.back ? '<button class="icon-btn" data-go="' + opts.back + '">←</button>' : '') +
      '<div style="flex:1;min-width:0"><h1>' + title + '</h1>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>' +
      '<button id="syncpill" class="pill" data-act="sync"></button></div>' + body + footer() + '</div>' +
      '<nav class="nav">' + nav.map(function (n) {
        if (n[0] === 'add') return '<a href="#/add" class="fab" aria-label="' + t('addExpense') + '">+</a>';
        return '<a href="#/' + n[0] + '" class="' + (r === n[0] ? 'active' : '') + '"><span class="i">' + n[1] + '</span>' + n[2] +
          (n[0] === 'alerts' && ac ? '<span class="badge">' + bn(ac) + '</span>' : '') + '</a>';
      }).join('') + '</nav>';
  }

  /* ---------------- setup & login ---------------- */
  function renderSetup() {
    $app.innerHTML = '<div class="login"><div class="logo">হি<span class="dot">.</span></div><h1>' + t('apiSetup') + '</h1>' +
      '<div class="tl small" style="max-width:340px">' + t('apiHint') + '</div>' +
      '<div style="width:100%;max-width:420px"><input id="apiurl" class="input" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(S.api) + '">' +
      '<button class="btn block" style="margin-top:12px" id="apigo">' + t('connect') + '</button></div>' + footer() + '</div>';
    document.getElementById('apigo').onclick = function () {
      var u = document.getElementById('apiurl').value.trim();
      if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(u)) return toast('Invalid URL');
      var done = toastLoading();
      fetch(u).then(function (r) { return r.json(); }).then(function (j) {
        done(); if (!j.ok) throw new Error();
        S.api = u; LS.set('hk_api', u); refresh();
      }).catch(function () { done(); toast('⚠️ Could not reach that URL', 3500); });
    };
  }

  function renderLogin() {
    var sel = S.prefs.lastUser || '', pin = '';
    function draw() {
      $app.innerHTML = '<div class="login"><div class="logo">হি<span class="dot">.</span></div><h1>' + t('appName') + '</h1><div class="tl">' + t('tagline') + '</div>' +
        '<div class="muted small" style="margin-bottom:10px">' + t('whoAreYou') + '</div><div class="users">' +
        [['Husband', '👨'], ['Wife', '👩']].map(function (u) { return '<button class="user-btn ' + (sel === u[0] ? 'on' : '') + '" data-u="' + u[0] + '"><span class="ue">' + u[1] + '</span>' + userLabel(u[0]) + '</button>'; }).join('') +
        '</div>' + (sel ? '<div class="muted small" style="margin-top:20px">' + t('enterPin') + '</div><div class="pin-dots" id="dots"></div><div class="pin-err" id="perr"></div>' +
        '<div class="keypad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (k) { return '<button data-k="' + k + '">' + bn(k) + '</button>'; }).join('') +
        '<button class="k-alt" data-k="del">⌫</button><button data-k="0">' + bn(0) + '</button><button class="k-alt" data-k="ok" style="color:var(--primary);font-size:24px">✓</button></div>' : '') +
        '<div style="margin-top:18px"><div class="seg"><button class="' + (S.prefs.lang === 'en' ? 'on' : '') + '" data-lang="en">English</button><button class="' + (S.prefs.lang === 'bn' ? 'on' : '') + '" data-lang="bn">বাংলা</button></div></div>' +
        footer() + '</div>';
      dots();
      $app.querySelectorAll('[data-u]').forEach(function (b) { b.onclick = function () { sel = b.dataset.u; pin = ''; draw(); }; });
      $app.querySelectorAll('[data-lang]').forEach(function (b) { b.onclick = function () { S.prefs.lang = b.dataset.lang; savePrefs(); draw(); }; });
      $app.querySelectorAll('[data-k]').forEach(function (b) { b.onclick = function () { key(b.dataset.k); }; });
    }
    function dots() { var d = document.getElementById('dots'); if (!d) return; var n = Math.max(4, pin.length); d.innerHTML = ''; for (var i = 0; i < n; i++) d.innerHTML += '<i class="' + (i < pin.length ? 'f' : '') + '"></i>'; }
    function key(k) {
      if (k === 'del') pin = pin.slice(0, -1);
      else if (k === 'ok') return submit();
      else if (pin.length < 6) pin += k;
      dots();
    }
    function submit() {
      if (pin.length < 4) return;
      if (!navigator.onLine) return err(t('needsOnline'));
      var done = toastLoading();
      api('login', { user: sel, pin: pin, device: navigator.userAgent }).then(function (res) {
        done();
        if (!res.ok) { pin = ''; dots(); return err(res.error === 'WRONG_PIN' ? t('wrongPin') : res.error); }
        S.session = { token: res.token, user: res.user, role: res.role }; LS.set('hk_session', S.session);
        S.prefs.lastUser = res.user; savePrefs();
        S.data = res.state; S.outbox.forEach(applyLocal); save();
        location.hash = '#/home'; refresh(); flush();
      }).catch(function (e) { done(); err(t('error') + ': ' + e.message); });
    }
    function err(m) { var e = document.getElementById('perr'); if (!e) return; e.textContent = m; e.classList.remove('shake'); void e.offsetWidth; e.classList.add('shake'); }
    document.onkeydown = function (ev) {
      if (S.session || !sel) return;
      if (/^[0-9]$/.test(ev.key)) key(ev.key); else if (ev.key === 'Backspace') key('del'); else if (ev.key === 'Enter') key('ok');
    };
    draw();
  }
  function logoutLocal() { S.session = null; LS.del('hk_session'); S.data = null; LS.del('hk_cache'); S.logCache = null; refresh(); }
  function renderLoading() {
    $app.innerHTML = '<div class="boot"><div class="spin"></div><div>' + t('loading') + '</div></div>';
    api('state').then(function (res) { if (res.ok) { S.data = res.state; save(); refresh(); } })
      .catch(function () { $app.innerHTML = '<div class="boot"><div>⚠️ ' + t('error') + '</div><button class="btn" onclick="location.reload()">' + t('retry') + '</button></div>'; });
  }

  /* ---------------- HOME / DASHBOARD ---------------- */
  function renderHome() {
    var m = monthStats(S.month), B = m.budget, pct = B ? Math.min(100, m.total / B * 100) : 0;
    var cls = B && m.total >= B ? 'over' : B && pct >= 80 ? 'warn' : '';
    var diff = m.prevSame ? (m.nowSame - m.prevSame) / m.prevSame * 100 : null;
    var al = computeAlerts().filter(function (a) { return a.level !== 'info' || /aPending/.test(a.text); }).slice(0, 2);
    var greet = (me() === 'Husband' ? '👨 ' : '👩 ') + userLabel(me());
    var body =
      '<div class="card hero"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;position:relative;z-index:1">' +
      '<div class="lbl">' + t('spent') + '</div><div class="month-switch"><button data-m="-1">‹</button><span>' + monthName(S.month) + '</span><button data-m="1">›</button></div></div>' +
      '<div class="big">' + money(m.total) + '</div>' +
      (B ? '<div class="bar"><i class="' + cls + '" style="width:' + pct.toFixed(1) + '%"></i></div><div class="row"><span>' + t('budget') + ' ' + money(B) + '</span><span>' +
        (m.total <= B ? t('remaining') + ' ' + money(B - m.total) : t('overBy') + ' ' + money(m.total - B)) + '</span></div>'
        : '<div class="row"><span>' + t('noBudget') + '</span><span>' + bn(m.list.length) + ' ' + t('entries') + '</span></div>') + '</div>' +
      al.map(alertHtml).join('') +
      '<div class="kpis">' +
      kpi(m.cur ? t('todaySpent') : t('entries'), m.cur ? money(m.today) : bn(m.list.length)) +
      kpi(t('dailyAvg'), money(m.avg)) +
      kpi(t('forecast'), m.cur ? money(m.forecast) : '—', B && m.cur && m.forecast > B ? '<span class="up">▲ ' + money(m.forecast - B) + '</span>' : '') +
      kpi(t('vsLastMonth'), diff === null ? '—' : (diff > 0 ? '▲ ' : '▼ ') + bn(Math.abs(Math.round(diff))) + '%', '', diff === null ? '' : diff > 0 ? 'up' : 'down') +
      '</div>';
    if (!m.list.length) body += '<div class="card empty"><div class="e">🧾</div>' + t('noData') + '<div style="margin-top:14px"><a class="btn" href="#/add">+ ' + t('addExpense') + '</a></div></div>';
    else body +=
      '<div class="grid two">' +
      '<div class="card"><h3>' + t('byCategory') + '</h3><div class="chart-box"><canvas id="cCat"></canvas></div></div>' +
      '<div class="card"><h3>' + t('dailyTrend') + '</h3><div class="chart-box"><canvas id="cDay"></canvas></div></div></div>' +
      '<div class="card" style="margin-top:14px"><h3>' + t('budgetVsActual') + ' <a class="small" href="#/budgets">' + t('budgets') + ' ›</a></h3>' + budgetBars(m) + '</div>' +
      '<div class="grid two">' +
      '<div class="card"><h3>' + t('byPayment') + '</h3><div class="chart-box sm"><canvas id="cPay"></canvas></div></div>' +
      '<div class="card"><h3>' + t('byPerson') + '</h3><div class="chart-box sm"><canvas id="cWho"></canvas></div></div>' +
      '<div class="card"><h3>' + t('bySpentFor') + '</h3><div class="chart-box sm"><canvas id="cFor"></canvas></div></div>' +
      '<div class="card"><h3>' + t('topPlaces') + '</h3>' + topPlaces(m.list) + '</div></div>' +
      '<div class="card" style="margin-top:14px"><h3>' + t('last6') + '</h3><div class="chart-box sm"><canvas id="c6"></canvas></div></div>';
    layout(t('appName'), greet, body);
    $app.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { S.month = shiftYm(S.month, +b.dataset.m); refresh(); }; });
    if (m.list.length) drawHomeCharts(m);
  }
  function kpi(k, v, d, cls) { return '<div class="kpi"><div class="k">' + k + '</div><div class="v ' + (cls || '') + '">' + v + '</div>' + (d ? '<div class="d">' + d + '</div>' : '') + '</div>'; }
  function budgetBars(m) {
    var by = groupSum(m.list, 'category'), rows = cats().filter(function (c) { return c.budget > 0 || by[c.id]; })
      .sort(function (a, b) { return (by[b.id] || 0) - (by[a.id] || 0); });
    if (!rows.length) return '<div class="muted small">' + t('noData') + '</div>';
    return rows.map(function (c) { return progRow(c, by[c.id] || 0); }).join('');
  }
  function progRow(c, s) {
    var b = c.budget || 0, p = b ? s / b * 100 : 0, cls = b && s >= b ? 'over' : b && p >= 80 ? 'warn' : '';
    return '<div class="prog"><div class="top"><b>' + esc(c.icon) + ' ' + esc(catName(c)) + '</b><span>' + money(s) + (b ? ' / ' + money(b) + ' · ' + bn(Math.round(p)) + '%' : '') + '</span></div>' +
      (b ? '<div class="track"><i class="' + cls + '" style="width:' + Math.min(100, p).toFixed(1) + '%"></i></div>' : '') + '</div>';
  }
  function topPlaces(list) {
    var g = groupSum(list.filter(function (e) { return e.place; }), function (e) { return e.place.trim(); }), k = Object.keys(g).sort(function (a, b) { return g[b] - g[a]; }).slice(0, 5);
    if (!k.length) return '<div class="muted small">—</div>';
    return k.map(function (p, i) { return '<div class="rank"><span class="n">' + bn(i + 1) + '</span><span class="name">' + esc(p) + '</span><span class="amt">' + money(g[p]) + '</span></div>'; }).join('');
  }
  function chartDefaults() {
    if (!window.Chart) return false;
    var cs = getComputedStyle(document.documentElement);
    Chart.defaults.font.family = "'Hind Siliguri', system-ui, sans-serif";
    Chart.defaults.color = cs.getPropertyValue('--muted').trim();
    Chart.defaults.borderColor = cs.getPropertyValue('--line').trim();
    return true;
  }
  function mk(id, cfg) { var el = document.getElementById(id); if (!el) return; S.charts.push(new Chart(el, cfg)); }
  function moneyTip() { return { callbacks: { label: function (c) { return ' ' + (c.label ? c.label + ': ' : '') + money(c.raw); } } }; }
  function doughnut(id, labels, data) {
    mk(id, { type: 'doughnut', data: { labels: labels, datasets: [{ data: data, backgroundColor: COLORS, borderWidth: 2, borderColor: getComputedStyle(document.documentElement).getPropertyValue('--card').trim() }] },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, padding: 8, font: { size: 12 } } }, tooltip: moneyTip() } } });
  }
  function hbar(id, labels, data, color) {
    mk(id, { type: 'bar', data: { labels: labels, datasets: [{ data: data, backgroundColor: color || COLORS, borderRadius: 6, maxBarThickness: 26 }] },
      options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: moneyTip() },
        scales: { x: { ticks: { callback: function (v) { return bn(v >= 1000 ? Math.round(v / 1000) + 'k' : v); } } }, y: { grid: { display: false } } } } });
  }
  function drawHomeCharts(m) {
    if (!chartDefaults()) return;
    var byC = groupSum(m.list, 'category'), ck = Object.keys(byC).sort(function (a, b) { return byC[b] - byC[a]; });
    doughnut('cCat', ck.map(function (k) { return cat(k).icon + ' ' + catName(k); }), ck.map(function (k) { return byC[k]; }));
    var days = [], vals = [], cum = [], run = 0, byD = groupSum(m.list, 'date');
    for (var d = 1; d <= m.dim; d++) { var k = S.month + '-' + pad(d); days.push(bn(d)); vals.push(byD[k] || 0); run += byD[k] || 0; cum.push(m.cur && d > m.day ? null : run); }
    var primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
    var dsets = [{ type: 'bar', label: t('spent'), data: vals, backgroundColor: primary, borderRadius: 4, yAxisID: 'y' },
      { type: 'line', label: t('total'), data: cum, borderColor: '#e07a4f', pointRadius: 0, borderWidth: 2, tension: .3, yAxisID: 'y2' }];
    if (m.budget) dsets.push({ type: 'line', label: t('budget'), data: days.map(function () { return m.budget; }), borderColor: '#c8443b', borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5, yAxisID: 'y2' });
    mk('cDay', { data: { labels: days, datasets: dsets }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + money(c.parsed.y); } } } },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { position: 'left', beginAtZero: true, ticks: { callback: function (v) { return bn(v >= 1000 ? Math.round(v / 1000) + 'k' : v); } } },
        y2: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { callback: function (v) { return bn(v >= 1000 ? Math.round(v / 1000) + 'k' : v); } } } } } });
    var byP = groupSum(m.list, 'payment'), pk = PAYMENTS.map(function (p) { return p.id; }).filter(function (k) { return byP[k]; });
    hbar('cPay', pk.map(payName), pk.map(function (k) { return byP[k]; }));
    var byW = groupSum(m.list, 'createdBy'), wk = Object.keys(byW);
    doughnut('cWho', wk.map(userLabel), wk.map(function (k) { return byW[k]; }));
    var byF = groupSum(m.list, function (e) { return e.spentFor || ''; }), fk = Object.keys(byF).sort(function (a, b) { return byF[b] - byF[a]; });
    hbar('cFor', fk.map(sfName), fk.map(function (k) { return byF[k]; }));
    var ms = [], mv = []; for (var i = 5; i >= 0; i--) { var y = shiftYm(S.month, -i); ms.push(L().months[+y.slice(5) - 1].slice(0, S.prefs.lang === 'bn' ? 20 : 3)); mv.push(sum(inMonth(active(), y))); }
    mk('c6', { type: 'bar', data: { labels: ms, datasets: [{ data: mv, backgroundColor: mv.map(function (_, i) { return i === 5 ? primary : primary + '66'; }), borderRadius: 6, maxBarThickness: 40 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return ' ' + money(c.parsed.y); } } } },
        scales: { x: { grid: { display: false } }, y: { ticks: { callback: function (v) { return bn(v >= 1000 ? Math.round(v / 1000) + 'k' : v); } } } } } });
  }

  /* ---------------- ADD / EDIT ---------------- */
  function renderAdd(r) {
    var editId = r[1], editing = editId ? active().filter(function (e) { return e.id === editId; })[0] : null;
    if (editId && (!editing || !isAdmin())) { go('#/list'); return; }
    var f = editing ? JSON.parse(JSON.stringify(editing)) : { date: today(), payment: LS.get('hk_lastpay', 'Cash'), category: '', spentFor: '', place: '', note: '', amount: '' };
    var receipt = null, removeReceipt = false;
    // most-used categories first
    var usage = groupSum(active().slice(-300).map(function (e) { return { category: e.category, amount: 1 }; }), 'category');
    var cl = cats().filter(function (c) { return c.active || c.id === f.category; }).slice().sort(function (a, b) { return (usage[b.id] || 0) - (usage[a.id] || 0) || a.order - b.order; });
    var places = Object.keys(groupSum(active().filter(function (e) { return e.place; }), 'place')).sort();
    var body = '<div class="card">' +
      '<div class="field"><label>' + t('amount') + '</label><div class="amount-wrap"><span>৳</span><input id="fAmt" type="number" inputmode="decimal" min="0" step="any" placeholder="0" value="' + esc(f.amount) + '"></div></div>' +
      '<div class="field"><label>' + t('category') + '</label><div class="chips" id="fCat">' + cl.map(function (c) { return '<button type="button" class="chip ' + (f.category === c.id ? 'on' : '') + '" data-v="' + esc(c.id) + '">' + esc(c.icon) + ' ' + esc(catName(c)) + '</button>'; }).join('') + '</div></div>' +
      '<div class="field"><label>' + t('payment') + '</label><div class="chips" id="fPay">' + PAYMENTS.map(function (p) { return '<button type="button" class="chip ' + (f.payment === p.id ? 'on' : '') + '" data-v="' + p.id + '">' + p.icon + ' ' + p[S.prefs.lang] + '</button>'; }).join('') + '</div></div>' +
      '<div class="row2"><div class="field"><label>' + t('date') + '</label><input id="fDate" type="date" class="input" max="' + today() + '" value="' + esc(f.date) + '"></div>' +
      '<div class="field"><label>' + t('spentFor') + ' <em>(' + t('optional') + ')</em></label><select id="fFor" class="input"><option value="">—</option>' +
      spentForList().map(function (s) { return '<option value="' + esc(s.name) + '"' + (f.spentFor === s.name ? ' selected' : '') + '>' + esc(S.prefs.lang === 'bn' ? s.nameBn || s.name : s.name) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="field"><label>' + t('place') + ' <em>(' + t('optional') + ')</em></label><input id="fPlace" class="input" list="placeList" autocomplete="off" placeholder="' + esc(t('placePh')) + '" value="' + esc(f.place) + '">' +
      '<datalist id="placeList">' + places.map(function (p) { return '<option value="' + esc(p) + '">'; }).join('') + '</datalist></div>' +
      '<div class="field"><label>' + t('note') + ' <em>(' + t('optional') + ')</em></label><input id="fNote" class="input" placeholder="' + esc(t('notePh')) + '" value="' + esc(f.note) + '"></div>' +
      '<div class="field"><label>' + t('receipt') + ' <em>(' + t('optional') + ')</em></label><div class="receipt-prev" id="rPrev"></div>' +
      '<input id="fFile" type="file" accept="image/*" capture="environment" class="hidden"></div>' +
      '<button class="btn block" id="fSave">✓ ' + t('save') + '</button>' +
      (editing ? '' : '<label class="check" style="justify-content:center;margin-top:8px"><input type="checkbox" id="fAnother"' + (LS.get('hk_another', false) ? ' checked' : '') + '> ' + t('saveAnother') + '</label>') +
      '</div>';
    layout(editing ? t('editExpense') : t('addExpense'), editing ? userLabel(editing.createdBy) + ' · ' + prettyTs(editing.createdAt) : '', body, { back: editing ? '#/list' : '' });
    function chipGroup(id, key) {
      document.getElementById(id).querySelectorAll('.chip').forEach(function (b) {
        b.onclick = function () { f[key] = b.dataset.v; this.parentNode.querySelectorAll('.chip').forEach(function (x) { x.classList.toggle('on', x === b); }); };
      });
    }
    chipGroup('fCat', 'category'); chipGroup('fPay', 'payment');
    function drawReceipt() {
      var el = document.getElementById('rPrev'), has = receipt || (f.receiptUrl && !removeReceipt);
      el.innerHTML = has ? (receipt ? '<img src="' + receipt + '">' : '<a href="' + esc(f.receiptUrl) + '" target="_blank" rel="noopener">📎 ' + t('receipt') + '</a>') +
        ' <button type="button" class="btn sm dghost" id="rDel">' + t('removeReceipt') + '</button>'
        : '<label class="file-btn" for="fFile">📷 ' + t('addReceipt') + '</label>';
      var d = document.getElementById('rDel'); if (d) d.onclick = function () { if (receipt) receipt = null; else removeReceipt = true; drawReceipt(); };
    }
    drawReceipt();
    document.getElementById('fFile').onchange = function (e) {
      var file = e.target.files[0]; if (!file) return;
      compressImage(file, 1280, 0.7).then(function (u) { receipt = u; removeReceipt = false; drawReceipt(); }).catch(function () { toast('Image error'); });
    };
    if (!editing) setTimeout(function () { document.getElementById('fAmt').focus(); }, 150);
    document.getElementById('fSave').onclick = function () {
      var amt = parseFloat(document.getElementById('fAmt').value);
      if (!(amt > 0)) return toast(t('amountRequired'));
      if (!f.category) return toast(t('categoryRequired'));
      var d = { date: document.getElementById('fDate').value || today(), amount: Math.round(amt * 100) / 100, category: f.category, payment: f.payment,
        spentFor: document.getElementById('fFor').value, place: document.getElementById('fPlace').value.trim(), note: document.getElementById('fNote').value.trim() };
      LS.set('hk_lastpay', f.payment);
      if (editing) {
        d.id = editing.id; if (receipt) d.receiptData = receipt; if (removeReceipt) d.removeReceipt = true;
        queue('edit', d); toast(navigator.onLine ? t('saved') : t('savedOffline')); go('#/list'); return;
      }
      d.id = uid(); d.createdAt = new Date().toISOString(); d.offline = !navigator.onLine; if (receipt) d.receiptData = receipt;
      queue('add', d);
      var another = document.getElementById('fAnother').checked; LS.set('hk_another', another);
      var warn = postSaveAlert(d);
      toast(warn || (navigator.onLine ? '✓ ' + t('saved') : t('savedOffline')), warn ? 4500 : 2200);
      if (another) refresh(); else go('#/home');
    };
  }
  function postSaveAlert(d) {
    var m = monthStats(ym(new Date())); if (d.date.slice(0, 7) !== ym(new Date())) return '';
    var c = cat(d.category), s = sum(m.list.filter(function (e) { return e.category === c.id; }));
    if (c.budget > 0 && s >= c.budget) return '🔴 ' + t('aCatOver', { cat: c.icon + ' ' + catName(c), spent: num(s), budget: num(c.budget) });
    if (c.budget > 0 && s / c.budget >= 0.8) return '🟠 ' + t('aCatNear', { cat: c.icon + ' ' + catName(c), pct: bn(Math.round(s / c.budget * 100)), spent: num(s), budget: num(c.budget) });
    if (m.budget > 0 && m.total >= m.budget) return '🔴 ' + t('aOverallOver', { spent: num(m.total), budget: num(m.budget) });
    if (m.budget > 0 && m.total / m.budget >= 0.8) return '🟠 ' + t('aOverallNear', { pct: bn(Math.round(m.total / m.budget * 100)), spent: num(m.total), budget: num(m.budget) });
    return '';
  }
  function compressImage(file, max, q) {
    return new Promise(function (res, rej) {
      var rd = new FileReader();
      rd.onload = function () {
        var img = new Image();
        img.onload = function () {
          var s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', q));
        };
        img.onerror = rej; img.src = rd.result;
      };
      rd.onerror = rej; rd.readAsDataURL(file);
    });
  }

  /* ---------------- LIST ---------------- */
  function defaultFilter() { var m = ym(new Date()); return { from: m + '-01', to: m + '-' + pad(daysIn(m)), cat: '', pay: '', who: '', sf: '', q: '' }; }
  function filtered() {
    var F = S.listF, q = (F.q || '').toLowerCase();
    return active().filter(function (e) {
      return (!F.from || e.date >= F.from) && (!F.to || e.date <= F.to) && (!F.cat || e.category === F.cat) && (!F.pay || e.payment === F.pay) &&
        (!F.who || e.createdBy === F.who) && (!F.sf || (F.sf === '_none' ? !e.spentFor : e.spentFor === F.sf)) &&
        (!q || (e.note + ' ' + e.place + ' ' + catName(e.category) + ' ' + e.amount).toLowerCase().indexOf(q) >= 0);
    }).sort(function (a, b) { return a.date === b.date ? (b.createdAt > a.createdAt ? 1 : -1) : (b.date > a.date ? 1 : -1); });
  }
  function renderList() {
    if (!S.listF) S.listF = defaultFilter();
    var F = S.listF, list = filtered(), pend = pendingIds(), flagged = {};
    openFlags().forEach(function (f) { flagged[f.expenseId] = 1; });
    var preset = function (k) { var m = ym(new Date()), pm = shiftYm(m, -1); return k === 'this' ? [m + '-01', m + '-' + pad(daysIn(m))] : k === 'last' ? [pm + '-01', pm + '-' + pad(daysIn(pm))] : ['', '']; };
    var curPreset = ['this', 'last', 'all'].filter(function (k) { var p = preset(k); return p[0] === F.from && p[1] === F.to; })[0] || '';
    var selN = Object.keys(S.selected).length, selAmt = sum(active().filter(function (e) { return S.selected[e.id]; }));
    var body = '<div class="searchbar"><input id="lq" class="input" placeholder="' + esc(t('search')) + '" value="' + esc(F.q) + '"></div>' +
      '<div class="filters">' +
      ['this', 'last', 'all'].map(function (k) { return '<button class="chip small ' + (curPreset === k ? 'on' : '') + '" data-pre="' + k + '">' + (k === 'this' ? t('thisMonth') : k === 'last' ? monthName(shiftYm(ym(new Date()), -1)) : t('all')) + '</button>'; }).join('') +
      '<input type="date" class="input" id="lf" value="' + F.from + '" title="' + t('from') + '"><input type="date" class="input" id="lt" value="' + F.to + '" title="' + t('to') + '">' +
      '</div><div class="filters">' +
      sel('lc', t('category'), cats().map(function (c) { return [c.id, c.icon + ' ' + catName(c)]; }), F.cat) +
      sel('lp', t('payment'), PAYMENTS.map(function (p) { return [p.id, p[S.prefs.lang]]; }), F.pay) +
      sel('lw', t('enteredBy'), [['Husband', t('husband')], ['Wife', t('wife')]], F.who) +
      sel('ls', t('spentFor'), spentForList().map(function (s) { return [s.name, S.prefs.lang === 'bn' ? s.nameBn || s.name : s.name]; }).concat([['_none', t('notSpecified')]]), F.sf) +
      '<button class="chip small" id="lclr">✕ ' + t('clear') + '</button></div>' +
      '<div class="sumline"><span>' + bn(list.length) + ' ' + t('entries') + '</span><span>' + t('total') + ': <b>' + money(sum(list)) + '</b></span></div>';
    if (isAdmin()) body += S.selectMode
      ? '<div class="selbar"><span>' + bn(selN) + ' ' + t('selected') + ' · ' + money(selAmt) + '</span><span class="sp"></span>' +
        '<button class="btn sm line" id="lall">' + t('selectAll') + '</button><button class="btn sm danger" id="ldel"' + (selN ? '' : ' disabled') + '>🗑 ' + t('deleteSelected') + '</button>' +
        '<button class="btn sm line" id="lcancel">' + t('cancel') + '</button></div>'
      : '<div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:6px"><button class="btn sm line" id="lsel">☑ ' + t('select') + '</button>' +
        (list.length ? '<button class="btn sm dghost" id="ldelall">🗑 ' + t('deleteFiltered') + '</button>' : '') + '</div>';
    if (!list.length) body += '<div class="empty"><div class="e">🔍</div>' + t('noData') + '</div>';
    var lastD = null, byDay = groupSum(list, 'date');
    list.slice(0, 600).forEach(function (e) {
      if (e.date !== lastD) { lastD = e.date; body += '<div class="day-h"><span>' + prettyDate(e.date) + '</span><span>' + money(byDay[e.date]) + '</span></div>'; }
      var c = cat(e.category);
      body += '<div class="exp" data-id="' + esc(e.id) + '">' + (S.selectMode ? '<input type="checkbox" ' + (S.selected[e.id] ? 'checked' : '') + '>' : '') +
        '<div class="ic">' + esc(c.icon) + '</div><div class="mid"><div class="t">' + esc(catName(c)) + (e.note ? ' · ' + esc(e.note) : '') + '</div>' +
        '<div class="s">' + payName(e.payment) + (e.place ? ' · ' + esc(e.place) : '') + (e.spentFor ? ' · ' + esc(sfName(e.spentFor)) : '') + (e.receiptUrl ? ' · 📎' : '') + '</div></div>' +
        '<div><div class="a">' + money(e.amount) + '</div><div class="tags">' + (pend[e.id] ? '<span class="tag p">↻</span>' : '') + (flagged[e.id] ? '<span class="tag f">⚑</span>' : '') +
        '<span class="tag ' + (e.createdBy === 'Wife' ? 'w' : 'h') + '">' + (e.createdBy === 'Wife' ? t('wife') : t('husband')) + '</span></div></div></div>';
    });
    layout(t('list'), '', body);
    var setF = function (k, v) { F[k] = v; refresh(); };
    document.getElementById('lq').oninput = debounce(function (e) { F.q = e.target.value; var pos = e.target.selectionStart; refresh(); var q = document.getElementById('lq'); q.focus(); q.setSelectionRange(pos, pos); }, 350);
    $app.querySelectorAll('[data-pre]').forEach(function (b) { b.onclick = function () { var p = preset(b.dataset.pre); F.from = p[0]; F.to = p[1]; refresh(); }; });
    document.getElementById('lf').onchange = function (e) { setF('from', e.target.value); };
    document.getElementById('lt').onchange = function (e) { setF('to', e.target.value); };
    [['lc', 'cat'], ['lp', 'pay'], ['lw', 'who'], ['ls', 'sf']].forEach(function (p) { document.getElementById(p[0]).onchange = function (e) { setF(p[1], e.target.value); }; });
    document.getElementById('lclr').onclick = function () { S.listF = defaultFilter(); refresh(); };
    $app.querySelectorAll('.exp').forEach(function (el) {
      el.onclick = function () {
        var id = el.dataset.id;
        if (S.selectMode) { if (S.selected[id]) delete S.selected[id]; else S.selected[id] = 1; refresh(); }
        else showDetail(id);
      };
    });
    if (!isAdmin()) return;
    var b;
    if ((b = document.getElementById('lsel'))) b.onclick = function () { S.selectMode = true; S.selected = {}; refresh(); };
    if ((b = document.getElementById('lcancel'))) b.onclick = function () { S.selectMode = false; S.selected = {}; refresh(); };
    if ((b = document.getElementById('lall'))) b.onclick = function () {
      var all = list.every(function (e) { return S.selected[e.id]; }); S.selected = {};
      if (!all) list.forEach(function (e) { S.selected[e.id] = 1; }); refresh();
    };
    if ((b = document.getElementById('ldel'))) b.onclick = function () { bulkDelete(Object.keys(S.selected)); };
    if ((b = document.getElementById('ldelall'))) b.onclick = function () { bulkDelete(list.map(function (e) { return e.id; })); };
  }
  function sel(id, label, opts, v) {
    return '<select id="' + id + '" class="input"><option value="">' + esc(label) + ': ' + t('all') + '</option>' +
      opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (v === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
  }
  function debounce(fn, ms) { var tm; return function (e) { clearTimeout(tm); tm = setTimeout(function () { fn(e); }, ms); }; }
  function bulkDelete(ids) {
    if (!ids.length) return;
    var amt = sum(active().filter(function (e) { return ids.indexOf(e.id) >= 0; }));
    confirmBox(t('confirmDelete', { n: bn(ids.length), amt: num(amt) }), t('delete'), true).then(function (ok) {
      if (!ok) return; queue('delete', { ids: ids }); S.selectMode = false; S.selected = {}; closeSheet(); toast('🗑 ' + bn(ids.length) + ' → ' + t('recycleBin')); refresh();
    });
  }

  /* ---------------- detail sheet ---------------- */
  function showDetail(id) {
    var e = active().filter(function (x) { return x.id === id; })[0]; if (!e) return;
    var c = cat(e.category), fl = ((S.data.flags) || []).filter(function (f) { return f.expenseId === id; });
    var rows = [[t('category'), esc(c.icon + ' ' + catName(c))], [t('date'), prettyDate(e.date) + ' (' + bn(e.date) + ')'], [t('payment'), payName(e.payment)],
      [t('spentFor'), esc(sfName(e.spentFor))], [t('place'), esc(e.place || '—')], [t('note'), esc(e.note || '—')],
      [t('enteredBy'), userLabel(e.createdBy) + ' · ' + prettyTs(e.createdAt)]];
    if (e.updatedBy) rows.push([t('updated'), userLabel(e.updatedBy) + ' · ' + prettyTs(e.updatedAt)]);
    if (e.receiptUrl) rows.push([t('receipt'), e.receiptUrl === 'local' ? '↻ ' + t('pendingSync') : '<a href="' + esc(e.receiptUrl) + '" target="_blank" rel="noopener">📎 Open</a>']);
    var html = '<h2 style="display:flex;justify-content:space-between"><span>' + esc(c.icon) + ' ' + money(e.amount) + '</span>' + (pendingIds()[id] ? '<span class="tag p" style="font-size:12px">↻ ' + t('pendingSync') + '</span>' : '') + '</h2>' +
      rows.map(function (r) { return '<div class="detail-row"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>'; }).join('');
    if (fl.length) html += '<div class="section-t">⚑ ' + t('openFlags') + '</div>' + fl.map(function (f) {
      return '<div class="alert ' + (f.status === 'open' ? 'warn' : 'good') + '"><span class="ai">' + (f.status === 'open' ? '⚑' : '✓') + '</span><div style="flex:1"><b>' + userLabel(f.createdBy) + ':</b> ' + esc(f.note) +
        '<div class="small muted">' + prettyTs(f.createdAt) + (f.status !== 'open' ? ' · ' + t('resolved') : '') + '</div>' +
        (isAdmin() && f.status === 'open' ? '<button class="btn sm ghost" style="margin-top:6px" data-res="' + esc(f.id) + '">✓ ' + t('resolve') + '</button>' : '') + '</div></div>';
    }).join('');
    html += '<div class="actions">' + (isAdmin() ? '<button class="btn ghost" id="dEdit">✎ ' + t('edit') + '</button><button class="btn dghost" id="dDel">🗑 ' + t('delete') + '</button>' : '') +
      '<button class="btn line" id="dFlag">⚑ ' + (isAdmin() ? '' : t('flag')) + '</button></div>';
    openSheet(html);
    var b;
    if ((b = document.getElementById('dEdit'))) b.onclick = function () { closeSheet(); go('#/add/' + id); };
    if ((b = document.getElementById('dDel'))) b.onclick = function () { bulkDelete([id]); };
    document.getElementById('dFlag').onclick = function () { flagDialog(id); };
    $sheet.querySelectorAll('[data-res]').forEach(function (x) { x.onclick = function () { queue('resolveFlag', { id: x.dataset.res }); toast('✓ ' + t('resolved')); showDetail(id); }; });
  }
  function flagDialog(id) {
    openSheet('<h2>⚑ ' + t('flag') + '</h2><div class="field"><label>' + t('flagNote') + '</label><textarea id="flN" class="input" rows="3" placeholder="' + esc(t('flagPh')) + '"></textarea></div>' +
      '<div class="actions"><button class="btn line" data-close>' + t('cancel') + '</button><button class="btn" id="flS">' + t('save') + '</button></div>');
    document.getElementById('flN').focus();
    document.getElementById('flS').onclick = function () {
      var n = document.getElementById('flN').value.trim(); if (!n) return;
      queue('flag', { id: uid(), expenseId: id, note: n }); closeSheet(); toast(isAdmin() ? '⚑ ' + t('saved') : t('flagSent')); refresh();
    };
  }

  /* ---------------- sheets & confirm ---------------- */
  function openSheet(html) {
    $sheet.innerHTML = '<div class="overlay"><div class="sheet"><div class="grab"></div>' + html + '</div></div>';
    var ov = $sheet.querySelector('.overlay');
    ov.onclick = function (e) { if (e.target === ov || e.target.hasAttribute('data-close')) closeSheet(); };
  }
  function closeSheet() { $sheet.innerHTML = ''; }
  function confirmBox(msg, okLabel, danger) {
    return new Promise(function (resolve) {
      openSheet('<h2>' + t('areYouSure') + '</h2><p>' + esc(msg) + '</p><div class="actions"><button class="btn line" id="cNo">' + t('cancel') + '</button><button class="btn ' + (danger ? 'danger' : '') + '" id="cYes">' + esc(okLabel || t('yes')) + '</button></div>');
      document.getElementById('cNo').onclick = function () { closeSheet(); resolve(false); };
      document.getElementById('cYes').onclick = function () { closeSheet(); resolve(true); };
    });
  }
  function promptBox(title, fields, okLabel) {
    return new Promise(function (resolve) {
      openSheet('<h2>' + title + '</h2>' + fields.map(function (f) {
        return '<div class="field"><label>' + f.label + '</label><input class="input" id="pb_' + f.id + '" type="' + (f.type || 'text') + '"' + (f.mode ? ' inputmode="' + f.mode + '"' : '') +
          ' value="' + esc(f.value === undefined ? '' : f.value) + '" placeholder="' + esc(f.ph || '') + '">' + (f.hint ? '<div class="small muted" style="margin-top:4px">' + f.hint + '</div>' : '') + '</div>';
      }).join('') + '<div class="actions"><button class="btn line" data-close>' + t('cancel') + '</button><button class="btn" id="pbOk">' + (okLabel || t('save')) + '</button></div>');
      var first = document.getElementById('pb_' + fields[0].id); first.focus(); try { first.select(); } catch (e) {}
      document.getElementById('pbOk').onclick = function () { var o = {}; fields.forEach(function (f) { o[f.id] = document.getElementById('pb_' + f.id).value.trim(); }); closeSheet(); resolve(o); };
    });
  }

  /* ---------------- ALERTS ---------------- */
  function alertHtml(a) {
    var ic = { danger: '🔴', warn: '🟠', info: '💡', good: '🟢' }[a.level];
    return '<div class="alert ' + a.level + '"><span class="ai">' + ic + '</span><div style="flex:1">' + esc(a.text) + (a.link ? ' <a href="' + a.link + '">›</a>' : '') + '</div></div>';
  }
  function renderAlerts() {
    var al = computeAlerts();
    layout(t('alerts'), monthName(ym(new Date())), al.length ? al.map(alertHtml).join('') : '<div class="card empty"><div class="e">✅</div>' + t('noAlerts') + '</div>');
  }

  /* ---------------- BUDGETS ---------------- */
  function renderBudgets() {
    var m = monthStats(ym(new Date())), by = groupSum(m.list, 'category'), B = m.budget;
    var body = '<div class="card"><h3>' + t('overallBudget') + (isAdmin() ? ' <button class="btn sm ghost" id="bAll">✎ ' + t('setBudget') + '</button>' : '') + '</h3>' +
      progRow({ icon: '💰', name: t('thisMonth'), nameBn: t('thisMonth'), budget: B }, m.total) + (B ? '' : '<div class="muted small">' + t('noBudget') + '</div>') + '</div>' +
      '<div class="card"><h3>' + t('categoryBudgets') + ' <small>' + monthName(ym(new Date())) + '</small></h3>' +
      cats().filter(function (c) { return c.active; }).map(function (c) {
        return '<div ' + (isAdmin() ? 'data-cb="' + esc(c.id) + '" style="cursor:pointer"' : '') + '>' + progRow(c, by[c.id] || 0) + (c.budget ? '' : '<div class="small muted" style="margin:-8px 0 12px">' + t('noBudget') + (isAdmin() ? ' · ✎' : '') + '</div>') + '</div>';
      }).join('') + (isAdmin() ? '<div class="small muted">' + t('budgetHint') + '</div>' : '') + '</div>';
    layout(t('budgets'), '', body, { back: '#/more' });
    if (!isAdmin()) return;
    document.getElementById('bAll').onclick = function () {
      promptBox(t('overallBudget'), [{ id: 'v', label: '৳ ' + t('perMonth'), type: 'number', mode: 'numeric', value: B || '', hint: t('budgetHint') }]).then(function (o) {
        if (o) runNow('setOverallBudget', { amount: Number(o.v) || 0 }).then(refresh);
      });
    };
    $app.querySelectorAll('[data-cb]').forEach(function (el) {
      el.onclick = function () {
        var c = cat(el.dataset.cb);
        promptBox(c.icon + ' ' + catName(c), [{ id: 'v', label: t('budget') + ' (৳ ' + t('perMonth') + ')', type: 'number', mode: 'numeric', value: c.budget || '', hint: t('budgetHint') }]).then(function (o) {
          if (o) runNow('saveCategory', Object.assign({}, c, { budget: Number(o.v) || 0 })).then(refresh);
        });
      };
    });
  }

  /* ---------------- MORE / SETTINGS ---------------- */
  function renderMore() {
    var adm = isAdmin(), fl = openFlags().length, binN = ((S.data.expenses) || []).filter(function (e) { return e.status === 'deleted'; }).length;
    function item(icon, label, attr, right, cls) { return '<a class="menu-item ' + (cls || '') + '" ' + attr + '><span class="mi">' + icon + '</span><span class="ml">' + label + '</span><span class="mr">' + (right || '›') + '</span></a>'; }
    var body = '<div class="card" style="display:flex;align-items:center;gap:14px"><div class="logo" style="width:52px;height:52px;font-size:26px;border-radius:16px;margin:0">' + (me() === 'Husband' ? '👨' : '👩') + '</div>' +
      '<div style="flex:1"><div style="font-weight:700;font-size:17px">' + userLabel(me()) + '</div><div class="small muted">' + (adm ? 'Admin' : '') + ' · ' +
      (S.lastSync ? prettyTs(S.lastSync) : '—') + '</div></div><button class="btn sm ghost" data-act="sync">↻ ' + t('syncNow') + '</button></div>' +
      '<div class="section-t">' + t('settings') + '</div><div class="card menu" style="padding:0">' +
      '<div class="menu-item"><span class="mi">🌐</span><span class="ml">' + t('language') + '</span><div class="seg"><button data-lang="en" class="' + (S.prefs.lang === 'en' ? 'on' : '') + '">English</button><button data-lang="bn" class="' + (S.prefs.lang === 'bn' ? 'on' : '') + '">বাংলা</button></div></div>' +
      '<div class="menu-item"><span class="mi">🌓</span><span class="ml">' + t('theme') + '</span><div class="seg">' + ['auto', 'light', 'dark'].map(function (k) { return '<button data-theme="' + k + '" class="' + (S.prefs.theme === k ? 'on' : '') + '">' + t('theme' + k[0].toUpperCase() + k.slice(1)) + '</button>'; }).join('') + '</div></div>' +
      item('💰', t('budgets'), 'href="#/budgets"') +
      item('🔑', t('changePin'), 'data-act="pin"') +
      (S.installEvt ? item('📲', t('installApp'), 'data-act="install"') : '') + '</div>';
    if (adm) body += '<div class="section-t">Admin · ' + t('husband') + '</div><div class="card menu" style="padding:0">' +
      item('⚑', t('openFlags'), 'href="#/flags"', fl ? '<span class="tag f">' + bn(fl) + '</span> ›' : '›') +
      item('🗂️', t('manageCategories'), 'href="#/categories"') +
      item('👥', t('manageSpentFor'), 'href="#/spentfor"') +
      item('♻️', t('recycleBin'), 'href="#/bin"', binN ? bn(binN) + ' ›' : '›') +
      item('📜', t('activityLog'), 'href="#/log"') +
      item('🔐', t('resetWifePin'), 'data-act="wifepin"') +
      item('⚠️', t('fullReset'), 'data-act="reset"', '›', 'danger') + '</div>';
    body += '<div class="card menu" style="padding:0;margin-top:14px">' + item('🔌', t('apiSetup'), 'data-act="api"') + item('🚪', t('logout'), 'data-act="logout"', '', 'danger') + '</div>';
    layout(t('more'), '', body);
    $app.querySelectorAll('[data-lang]').forEach(function (b) { b.onclick = function () { S.prefs.lang = b.dataset.lang; savePrefs(); refresh(); }; });
    $app.querySelectorAll('[data-theme]').forEach(function (b) { b.onclick = function () { S.prefs.theme = b.dataset.theme; savePrefs(); applyTheme(); refresh(); }; });
  }
  function applyTheme() {
    var tm = S.prefs.theme, dark = tm === 'dark' || (tm === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    var meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = dark ? '#0c1513' : '#0f6b63';
  }

  function doAction(a) {
    if (a === 'sync') { if (!navigator.onLine) return toast(t('offline')); flush().then(function () { toast(S.outbox.length ? t('pendingSync') : '✓ ' + t('synced')); }); }
    else if (a === 'logout') confirmBox(t('logout') + '?', t('logout')).then(function (ok) {
      if (!ok) return;
      if (S.outbox.length) { toast(t('aPending', { n: bn(S.outbox.length) })); return; }
      if (navigator.onLine) api('logout').catch(function () {}); logoutLocal(); location.hash = '#/home';
    });
    else if (a === 'pin') promptBox(t('changePin'), [{ id: 'o', label: t('oldPin'), type: 'password', mode: 'numeric' }, { id: 'n', label: t('newPin'), type: 'password', mode: 'numeric' }]).then(function (o) {
      if (o) runNow('changePin', { oldPin: o.o, newPin: o.n }).then(function () { toast('✓ ' + t('pinChanged')); });
    });
    else if (a === 'wifepin') promptBox(t('resetWifePin'), [{ id: 'n', label: t('newPin'), type: 'password', mode: 'numeric' }]).then(function (o) {
      if (o) runNow('resetPin', { user: 'Wife', newPin: o.n }).then(function () { toast('✓ ' + t('pinChanged')); });
    });
    else if (a === 'install' && S.installEvt) { S.installEvt.prompt(); S.installEvt = null; }
    else if (a === 'api') { S.api = ''; LS.del('hk_api'); if (window.HK_CONFIG) window.HK_CONFIG.API_URL = ''; refresh(); }
    else if (a === 'reset') resetDialog();
  }
  document.addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]'); if (g) { go(g.dataset.go || '#/home'); return; }
    var a = e.target.closest('[data-act]'); if (a) { e.preventDefault(); doAction(a.dataset.act); }
  });

  function resetDialog() {
    openSheet('<h2>⚠️ ' + t('resetTitle') + '</h2>' +
      '<label class="check"><input type="checkbox" id="rP"> ' + t('resetPermanent') + '</label>' +
      '<label class="check"><input type="checkbox" id="rB"> ' + t('resetBudgets') + '</label>' +
      '<label class="check"><input type="checkbox" id="rF" checked> ' + t('resetFlags') + '</label>' +
      '<label class="check"><input type="checkbox" id="rPh"> ' + t('resetPhotos') + '</label>' +
      '<div class="field" style="margin-top:12px"><label>' + t('resetType') + '</label><input class="input" id="rT" autocomplete="off" autocapitalize="characters"></div>' +
      '<div class="small muted">📜 ' + t('activityLog') + ' — kept.</div>' +
      '<div class="actions"><button class="btn line" data-close>' + t('cancel') + '</button><button class="btn danger" id="rGo" disabled>' + t('fullReset') + '</button></div>');
    var inp = document.getElementById('rT'), go2 = document.getElementById('rGo');
    inp.oninput = function () { go2.disabled = inp.value.trim() !== 'RESET'; };
    go2.onclick = function () {
      var o = { confirm: 'RESET', permanent: document.getElementById('rP').checked, budgets: document.getElementById('rB').checked,
        flags: document.getElementById('rF').checked, photos: document.getElementById('rPh').checked };
      closeSheet();
      confirmBox(t('fullReset') + ' — ' + (o.permanent ? t('resetPermanent') : t('recycleBin')), t('fullReset'), true).then(function (ok) {
        if (ok) runNow('reset', o).then(function (msg) { toast('✓ ' + t('resetDone') + (msg ? ': ' + msg : ''), 5000); refresh(); });
      });
    };
  }

  /* ---------------- CATEGORIES ---------------- */
  function renderCategories() {
    var used = groupSum(active(), 'category');
    var body = '<div class="card menu" style="padding:0">' + cats().map(function (c) {
      return '<a class="menu-item" data-cid="' + esc(c.id) + '" style="' + (c.active ? '' : 'opacity:.5') + '"><span class="mi">' + esc(c.icon) + '</span><span class="ml">' + esc(c.name) + ' <span class="muted small">/ ' + esc(c.nameBn) + '</span></span><span class="mr">' +
        (c.budget ? money(c.budget) : '') + (c.active ? '' : ' · ' + t('hide')) + ' ›</span></a>';
    }).join('') + '</div><button class="btn block ghost" id="cAdd">+ ' + t('addCategory') + '</button>';
    layout(t('manageCategories'), '', body, { back: '#/more' });
    document.getElementById('cAdd').onclick = function () { catDialog(null); };
    $app.querySelectorAll('[data-cid]').forEach(function (el) { el.onclick = function () { catDialog(cat(el.dataset.cid), !!used[el.dataset.cid]); }; });
  }
  function catDialog(c, isUsed) {
    var n = c || { name: '', nameBn: '', icon: '📦', budget: 0, active: true };
    openSheet('<h2>' + (c ? esc(c.icon + ' ' + c.name) : t('addCategory')) + '</h2>' +
      '<div class="row2"><div class="field"><label>' + t('nameEn') + '</label><input class="input" id="cN" value="' + esc(n.name) + '"></div>' +
      '<div class="field"><label>' + t('nameBn') + '</label><input class="input" id="cNb" value="' + esc(n.nameBn) + '"></div></div>' +
      '<div class="row2"><div class="field"><label>' + t('icon') + '</label><input class="input" id="cI" value="' + esc(n.icon) + '" maxlength="4"></div>' +
      '<div class="field"><label>' + t('budget') + ' (৳)</label><input class="input" id="cB" type="number" inputmode="numeric" value="' + (n.budget || '') + '" placeholder="0"></div></div>' +
      '<div class="actions">' + (c ? '<button class="btn dghost" id="cDel">' + (c.active ? (isUsed ? t('hide') : t('delete')) : t('show')) + '</button>' : '') +
      '<button class="btn" id="cSave">' + t('save') + '</button></div>');
    document.getElementById('cSave').onclick = function () {
      var d = { id: c ? c.id : undefined, name: document.getElementById('cN').value.trim(), nameBn: document.getElementById('cNb').value.trim(), icon: document.getElementById('cI').value.trim() || '📦',
        budget: Number(document.getElementById('cB').value) || 0, active: c ? c.active : true, order: c ? c.order : cats().length + 1 };
      if (!d.name) return toast(t('nameEn') + '?');
      closeSheet(); runNow('saveCategory', d).then(refresh);
    };
    var del = document.getElementById('cDel');
    if (del) del.onclick = function () {
      closeSheet();
      if (!c.active) runNow('saveCategory', Object.assign({}, c, { active: true })).then(refresh);
      else runNow('deleteCategory', { id: c.id }).then(refresh);
    };
  }

  /* ---------------- SPENT FOR ---------------- */
  function renderSpentFor() {
    var list = JSON.parse(JSON.stringify(spentForList()));
    function draw() {
      var body = '<div class="card">' + list.map(function (s, i) {
        return '<div class="row2" style="grid-template-columns:1fr 1fr auto;align-items:center;margin-bottom:8px"><input class="input" data-i="' + i + '" data-k="name" value="' + esc(s.name) + '" placeholder="' + t('nameEn') + '">' +
          '<input class="input" data-i="' + i + '" data-k="nameBn" value="' + esc(s.nameBn) + '" placeholder="' + t('nameBn') + '"><button class="icon-btn" data-rm="' + i + '">✕</button></div>';
      }).join('') + '<button class="btn sm ghost" id="sfAdd">+ ' + t('add') + '</button></div><button class="btn block" id="sfSave">' + t('save') + '</button>';
      layout(t('manageSpentFor'), '', body, { back: '#/more' });
      $app.querySelectorAll('input[data-i]').forEach(function (inp) { inp.oninput = function () { list[+inp.dataset.i][inp.dataset.k] = inp.value; }; });
      $app.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = function () { list.splice(+b.dataset.rm, 1); draw(); }; });
      document.getElementById('sfAdd').onclick = function () { list.push({ name: '', nameBn: '' }); draw(); };
      document.getElementById('sfSave').onclick = function () {
        var clean = list.filter(function (s) { return s.name.trim(); }).map(function (s) { return { name: s.name.trim(), nameBn: (s.nameBn || s.name).trim() }; });
        runNow('setSpentFor', { list: clean }).then(function () { toast('✓ ' + t('saved')); go('#/more'); });
      };
    }
    draw();
  }

  /* ---------------- RECYCLE BIN ---------------- */
  function renderBin() {
    var del = (S.data.expenses || []).filter(function (e) { return e.status === 'deleted'; }).sort(function (a, b) { return b.deletedAt > a.deletedAt ? 1 : -1; });
    var ids = Object.keys(S.binSel).filter(function (id) { return del.some(function (e) { return e.id === id; }); });
    var body = '<div class="alert info"><span class="ai">♻️</span><div>' + t('binHint') + '</div></div>';
    if (!del.length) body += '<div class="card empty"><div class="e">♻️</div>' + t('binEmpty') + '</div>';
    else {
      body += '<div class="selbar"><span>' + bn(ids.length) + ' ' + t('selected') + '</span><span class="sp"></span><button class="btn sm line" id="bAll">' + t('selectAll') + '</button>' +
        '<button class="btn sm ghost" id="bRes"' + (ids.length ? '' : ' disabled') + '>↩ ' + t('restore') + '</button><button class="btn sm danger" id="bPur"' + (ids.length ? '' : ' disabled') + '>' + t('deleteForever') + '</button></div>';
      del.forEach(function (e) {
        var c = cat(e.category), left = Math.max(0, 30 - Math.floor((Date.now() - new Date(e.deletedAt).getTime()) / 864e5));
        body += '<div class="exp" data-bid="' + esc(e.id) + '"><input type="checkbox" ' + (S.binSel[e.id] ? 'checked' : '') + '><div class="ic">' + esc(c.icon) + '</div><div class="mid"><div class="t">' + esc(catName(c)) + (e.note ? ' · ' + esc(e.note) : '') + '</div>' +
          '<div class="s">' + prettyDate(e.date) + ' · 🗑 ' + prettyTs(e.deletedAt) + '</div></div><div><div class="a">' + money(e.amount) + '</div><div class="tags"><span class="tag">' + bn(left) + ' ' + t('daysLeft') + '</span></div></div></div>';
      });
      body += '<button class="btn block dghost" id="bEmpty" style="margin-top:10px">🗑 ' + t('emptyBin') + ' (' + bn(del.length) + ')</button>';
    }
    layout(t('recycleBin'), '', body, { back: '#/more' });
    $app.querySelectorAll('[data-bid]').forEach(function (el) { el.onclick = function () { var id = el.dataset.bid; if (S.binSel[id]) delete S.binSel[id]; else S.binSel[id] = 1; refresh(); }; });
    var b;
    if ((b = document.getElementById('bAll'))) b.onclick = function () { var all = del.every(function (e) { return S.binSel[e.id]; }); S.binSel = {}; if (!all) del.forEach(function (e) { S.binSel[e.id] = 1; }); refresh(); };
    if ((b = document.getElementById('bRes'))) b.onclick = function () { runNow('restore', { ids: ids }).then(function (n) { S.binSel = {}; toast('↩ ' + bn(n || 0) + ' ' + t('restore')); refresh(); }); };
    if ((b = document.getElementById('bPur'))) b.onclick = function () { confirmBox(t('confirmPurge', { n: bn(ids.length) }), t('deleteForever'), true).then(function (ok) { if (ok) runNow('purge', { ids: ids }).then(function () { S.binSel = {}; refresh(); }); }); };
    if ((b = document.getElementById('bEmpty'))) b.onclick = function () { confirmBox(t('confirmEmpty'), t('emptyBin'), true).then(function (ok) { if (ok) runNow('emptyBin', {}).then(function () { S.binSel = {}; refresh(); }); }); };
  }

  /* ---------------- FLAGS ---------------- */
  function renderFlags() {
    var all = (S.data.flags || []).slice().sort(function (a, b) { return b.createdAt > a.createdAt ? 1 : -1; });
    var ex = {}; (S.data.expenses || []).forEach(function (e) { ex[e.id] = e; });
    var body = all.length ? all.slice(0, 100).map(function (f) {
      var e = ex[f.expenseId];
      return '<div class="card"><div style="display:flex;justify-content:space-between;gap:8px"><b>' + (f.status === 'open' ? '⚑ ' : '✓ ') + userLabel(f.createdBy) + '</b><span class="small muted">' + prettyTs(f.createdAt) + '</span></div>' +
        '<div style="margin:6px 0">' + esc(f.note) + '</div>' +
        (e ? '<div class="exp" data-open="' + esc(e.id) + '" style="margin:8px 0 0"><div class="ic">' + esc(cat(e.category).icon) + '</div><div class="mid"><div class="t">' + esc(catName(e.category)) + (e.note ? ' · ' + esc(e.note) : '') + '</div><div class="s">' + prettyDate(e.date) + ' · ' + payName(e.payment) + (e.status === 'deleted' ? ' · 🗑' : '') + '</div></div><div class="a">' + money(e.amount) + '</div></div>' : '') +
        (f.status === 'open' ? '<div class="actions">' + (e && e.status !== 'deleted' ? '<button class="btn sm ghost" data-ed="' + esc(e.id) + '">✎ ' + t('edit') + '</button>' : '') + '<button class="btn sm" data-res="' + esc(f.id) + '">✓ ' + t('resolve') + '</button></div>'
          : '<div class="small muted" style="margin-top:6px">' + t('resolved') + ' · ' + userLabel(f.resolvedBy) + ' · ' + prettyTs(f.resolvedAt) + '</div>') + '</div>';
    }).join('') : '<div class="card empty"><div class="e">⚑</div>' + t('noAlerts') + '</div>';
    layout(t('openFlags'), '', body, { back: '#/more' });
    $app.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { showDetail(b.dataset.open); }; });
    $app.querySelectorAll('[data-ed]').forEach(function (b) { b.onclick = function () { go('#/add/' + b.dataset.ed); }; });
    $app.querySelectorAll('[data-res]').forEach(function (b) { b.onclick = function () { queue('resolveFlag', { id: b.dataset.res }); toast('✓ ' + t('resolved')); refresh(); }; });
  }

  /* ---------------- ACTIVITY LOG ---------------- */
  function renderLog() {
    var q = S.logQ || '';
    function draw(rows) {
      var ql = q.toLowerCase(), f = (rows || []).filter(function (r) { return !ql || (r.user + ' ' + r.action + ' ' + r.details).toLowerCase().indexOf(ql) >= 0; });
      var body = '<div class="searchbar"><input class="input" id="logq" placeholder="🔍" value="' + esc(q) + '"></div><div class="card" style="padding:4px 16px">' +
        (rows === null ? '<div class="empty"><span class="spin"></span></div>' : f.length ? f.slice(0, 500).map(function (r) {
          var d = /delete|purge|reset|empty|failed/i.test(r.action);
          return '<div class="log-item"><div class="lt"><span class="la ' + (d ? 'd' : '') + '">' + esc(r.action) + '</span><span>' + userLabel(r.user) + '</span><span>· ' + prettyTs(r.timestamp) + '</span></div><div class="ld">' + esc(r.details) + '</div></div>';
        }).join('') : '<div class="empty">—</div>') + '</div>';
      layout(t('activityLog'), rows ? bn(f.length) + ' ' + t('entries') : '', body, { back: '#/more' });
      var inp = document.getElementById('logq');
      inp.oninput = debounce(function () { q = S.logQ = inp.value; draw(rows); var i2 = document.getElementById('logq'); i2.focus(); i2.setSelectionRange(q.length, q.length); }, 300);
    }
    draw(S.logCache);
    if (!navigator.onLine) { if (!S.logCache) toast(t('needsOnline')); return; }
    api('log', { limit: 2000 }).then(function (res) { if (res.ok && route()[0] === 'log') { S.logCache = res.log; draw(res.log); } }).catch(function () {});
  }

  /* ---------------- boot ---------------- */
  window.addEventListener('online', function () { flush(); });
  window.addEventListener('offline', updateSyncPill);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) flush(); });
  setInterval(function () { if (S.outbox.length || Date.now() - new Date(S.lastSync || 0).getTime() > 120000) flush(); }, 60000);
  matchMedia('(prefers-color-scheme: dark)').addEventListener && matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); S.installEvt = e; if (route()[0] === 'more') refresh(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
  applyTheme();
  if (S.data && !S.data.flags) S.data.flags = [];
  refresh();
  if (S.session) flush();
  window.HK = { S: S, flush: flush }; // debugging aid
})();
