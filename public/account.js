/* ResuMail accounts, plans and payments (front end). Exposes window.Account for app.js. */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(`rm.${k}`); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(`rm.${k}`, JSON.stringify(v)); } catch (_) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(`rm.${k}`); } catch (_) { /* ignore */ } },
  };
  const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
  const fmtDate = (d) => { try { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return ''; } };

  function toast(msg, type = '', ms = 4200) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', type === 'err' ? 'alert' : 'status');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, ms);
  }
  function setLoading(btn, on) { if (!btn) return; btn.classList.toggle('is-loading', on); btn.disabled = on; }

  async function api(path, body, { timeout = 30000, headers } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(path, {
        method: body ? 'POST' : 'GET',
        headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, headers || {}),
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: ctrl.signal,
      });
      let data = null;
      try { data = await res.json(); } catch (_) { /* not JSON */ }
      if (!res.ok || !data || data.ok === false) {
        const e = new Error((data && data.error) || `Server error (${res.status}).`);
        e.code = (data && data.code) || `HTTP_${res.status}`;
        e.status = res.status;
        e.data = data || {};
        e.retryAfter = (data && data.retryAfter) || Number(res.headers.get('Retry-After')) || 0;
        throw e;
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw Object.assign(new Error('The request timed out. Check your internet connection.'), { code: 'TIMEOUT', data: {} });
      if (e instanceof TypeError) throw Object.assign(new Error('Could not reach the ResuMail server.'), { code: 'NETWORK', data: {} });
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  const scripts = {};
  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = resolve;
        s.onerror = () => { delete scripts[src]; reject(new Error('A required component could not be loaded. Check your connection.')); };
        document.head.appendChild(s);
      });
    }
    return scripts[src];
  }

  /* ---------------- tier badges ---------------- */
  const ICONS = {
    free: '<circle cx="12" cy="12" r="7.5"/>',
    trial: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
    standard: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    premium: '<path d="M3.5 8l4.5 3.5L12 5l4 6.5L20.5 8 19 18H5z"/>',
  };
  const NAMES = { free: 'Free', trial: 'Trial', standard: 'Standard', premium: 'Premium' };
  const tierHtml = (id) => `<span class="tier tier-${esc(id)}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id] || ICONS.free}</svg>${esc(NAMES[id] || id)}</span>`;
  const LOCK_SVG = '<svg class="lock-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>';

  /* ---------------- state ---------------- */
  const FALLBACK_PLANS = [
    { id: 'free', name: 'Free', price: 0, credits: 0, monthly: 10, minGap: 30, templates: false, manual: false },
    { id: 'trial', name: 'Trial', price: 29, credits: 100, minGap: 10, templates: true, manual: true },
    { id: 'standard', name: 'Standard', price: 99, credits: 1000, minGap: 5, templates: true, manual: true, recommended: true },
    { id: 'premium', name: 'Premium', price: 299, credits: 0, minGap: 2, templates: true, manual: true, lifetime: true, unlimited: true },
  ];
  const A = {
    user: null,
    known: false,
    config: { plans: FALLBACK_PLANS, gapChoices: [2, 3, 5, 10, 15, 20, 30, 45, 60, 90], templates: [], payments: { upi: false, razorpay: false } },
  };
  const listeners = [];
  const emit = () => listeners.forEach((fn) => { try { fn(A.user); } catch (e) { console.error(e); } });
  const planById = (id) => A.config.plans.find((p) => p.id === id) || FALLBACK_PLANS.find((p) => p.id === id);

  function freeUsage() {
    const p = planById('free');
    return { plan: 'free', name: 'Free', minGap: p.minGap, templates: false, manual: false, unlimited: false, limit: p.monthly, used: 0, remaining: p.monthly };
  }
  const usage = () => (A.user && A.user.usage) || freeUsage();
  const can = (feature) => !!usage()[feature];

  function setUser(u) {
    A.user = u || null;
    if (u) LS.set('acct', { initials: u.initials, plan: u.usage.plan }); else LS.del('acct');
    render(); emit();
  }
  function setUsage(us) {
    if (!A.user || !us) return;
    A.user.usage = us;
    LS.set('acct', { initials: A.user.initials, plan: us.plan });
    render(); emit();
  }

  /* ---------------- rendering ---------------- */
  function usageLine(u) {
    if (u.unlimited) return 'Unlimited emails';
    if (u.plan === 'free') return `${u.remaining} of ${u.limit} free emails left this month`;
    return `${Number(u.remaining).toLocaleString('en-IN')} emails left in your pack`;
  }
  function render() {
    const u = A.user;
    const cached = !A.known && !u ? LS.get('acct', null) : null;
    const signedIn = !!u || !!cached;
    $('#navSignIn').hidden = signedIn;
    $('#navSignUp').hidden = signedIn;
    $('#navProfile').hidden = !signedIn;
    if (signedIn) {
      $('#navAvatar').textContent = u ? u.initials : cached.initials;
      $('#navTier').innerHTML = tierHtml(u ? u.usage.plan : cached.plan);
    }
    $('#acctOut').hidden = !!u || !!cached;
    $('#acctIn').hidden = !u;
    if (u) {
      const us = u.usage;
      $('#barTier').innerHTML = tierHtml(us.plan);
      $('#barUsage').textContent = usageLine(us);
      $('#barGap').textContent = `· ${us.minGap}s minimum gap`;
      $('#barUpgrade').hidden = us.plan === 'premium';
    }
    $$('.plan [data-plan]').forEach((b) => {
      const cur = u && u.usage.plan === b.dataset.plan;
      b.classList.toggle('is-current', !!cur);
      b.textContent = cur ? 'Your current plan' : ({ free: 'Start free', trial: 'Get Trial', standard: 'Get Standard', premium: 'Get Premium' })[b.dataset.plan];
      b.disabled = !!cur || (u && u.usage.plan === 'premium' && b.dataset.plan !== 'premium');
    });
    $$('.plan').forEach((card) => card.classList.toggle('is-current', !!(u && u.usage.plan === card.dataset.tier)));
    if ($('#profileDlg').open) renderProfile();
  }

  /* ---------------- dialogs ---------------- */
  function openDlg(d) { if (!d.open) d.showModal(); }
  $$('dialog.dlg').forEach((d) => {
    d.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) { d.close(); return; }
      if (e.target === d) { // click on the backdrop
        const r = d.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
      }
    });
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-show-pass]');
    if (!b) return;
    const inp = b.parentElement.querySelector('input');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.textContent = show ? 'Hide' : 'Show';
  });

  /* ---------------- cooldown timers ---------------- */
  const timers = new WeakMap();
  function startCooldown(form, seconds) {
    const box = $('[data-cooldown]', form);
    const btn = $('button[type=submit]', form);
    clearInterval(timers.get(form));
    const end = Date.now() + seconds * 1000;
    const tick = () => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      $('[data-cooldown-time]', box).textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      if (!left) { clearInterval(timers.get(form)); box.hidden = true; btn.disabled = false; $('[data-msg]', form).textContent = ''; }
    };
    box.hidden = false; btn.disabled = true; tick();
    timers.set(form, setInterval(tick, 1000));
  }
  function formError(form, e) {
    const msg = $('[data-msg]', form);
    msg.className = 'inline-msg err';
    if (e.code === 'LOCKED' || e.code === 'SIGNUP_LIMIT' || e.code === 'BLOCKED' || e.code === 'RATE_LIMIT') {
      msg.textContent = e.message;
      if (e.retryAfter) startCooldown(form, e.retryAfter);
    } else msg.textContent = e.message;
  }

  /* ---------------- auth ---------------- */
  const authDlg = $('#authDlg');
  let authWaiters = [];
  const TAB_TEXT = {
    login: ['Welcome back', 'Sign in to send your resume.'],
    signup: ['Create your free account', '10 free emails every month. Upgrade any time.'],
    forgot: ['Reset your password', 'We\'ll email you a 6-digit code.'],
  };
  function showTab(tab, sub) {
    $$('#authTabs .seg-btn').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on); });
    $('#authTabs').hidden = tab === 'forgot';
    $('#loginForm').hidden = tab !== 'login';
    $('#signupForm').hidden = tab !== 'signup';
    $('#forgotForm').hidden = tab !== 'forgot';
    $('#authTitle').textContent = TAB_TEXT[tab][0];
    $('#authSub').textContent = sub || TAB_TEXT[tab][1];
    const form = $(`#${tab}Form`);
    const first = $('input:not([type=checkbox])', form);
    if (first && authDlg.open) setTimeout(() => first.focus(), 30);
  }
  function openAuth(tab = 'login', reason = '') {
    showTab(tab, reason);
    openDlg(authDlg);
    const first = $(`#${tab}Form input`);
    if (first) setTimeout(() => first.focus(), 30);
  }
  /** Resolves true once signed in (opens the sign-in dialog if needed). */
  function ensureSignedIn(reason) {
    if (A.user) return Promise.resolve(true);
    openAuth(LS.get('hadAccount', false) ? 'login' : 'signup', reason);
    return new Promise((resolve) => authWaiters.push(resolve));
  }
  authDlg.addEventListener('close', () => { const w = authWaiters; authWaiters = []; w.forEach((r) => r(!!A.user)); });
  $$('#authTabs .seg-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  authDlg.addEventListener('click', (e) => { const g = e.target.closest('[data-tab-go]'); if (g) showTab(g.dataset.tabGo); });

  function signedIn(u, msg) {
    LS.set('hadAccount', true);
    setUser(u);
    authDlg.close();
    toast(msg, 'ok');
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget; const btn = $('button[type=submit]', f);
    const email = f.email.value.trim(); const password = f.password.value;
    $('[data-msg]', f).textContent = '';
    if (!email || !password) { $('[data-msg]', f).textContent = 'Enter your email and password.'; return; }
    setLoading(btn, true);
    try {
      const d = await api('api/auth/login', { email, password });
      f.password.value = '';
      signedIn(d.user, `Welcome back, ${d.user.name.split(' ')[0]}.`);
    } catch (err) { formError(f, err); } finally { setLoading(btn, false); if (!$('[data-cooldown]', f).hidden) btn.disabled = true; }
  });

  $('#signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget; const btn = $('button[type=submit]', f); const msg = $('[data-msg]', f);
    const name = f.name.value.trim(); const email = f.email.value.trim(); const password = f.password.value;
    msg.textContent = '';
    let problem = '';
    if (name.length < 2) problem = 'Enter your full name.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) problem = 'Enter a valid email address.';
    else if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) problem = 'Use at least 8 characters with letters and numbers.';
    else if (!f.terms.checked) problem = 'Please accept the Terms and Privacy Policy.';
    if (problem) { msg.textContent = problem; return; }
    setLoading(btn, true);
    try {
      const d = await api('api/auth/signup', { name, email, password, acceptTerms: true });
      f.password.value = '';
      signedIn(d.user, 'Account created. You\'re on the Free plan with 10 emails a month.');
    } catch (err) {
      formError(f, err);
      if (err.code === 'EMAIL_TAKEN') { $('#loginForm').email.value = email; }
    } finally { setLoading(btn, false); if (!$('[data-cooldown]', f).hidden) btn.disabled = true; }
  });

  $('#forgotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget; const btn = $('button[type=submit]', f); const msg = $('[data-msg]', f);
    const stage2 = !$('[data-reset-fields]', f).hidden;
    msg.textContent = ''; msg.className = 'inline-msg';
    setLoading(btn, true);
    try {
      if (!stage2) {
        const d = await api('api/auth/forgot', { email: f.email.value.trim() });
        $('[data-reset-fields]', f).hidden = false;
        btn.textContent = 'Reset password';
        msg.className = 'inline-msg ok'; msg.textContent = d.message;
        f.code.focus();
      } else {
        const d = await api('api/auth/reset', { email: f.email.value.trim(), code: f.code.value.trim(), password: f.password.value });
        f.reset(); $('[data-reset-fields]', f).hidden = true; btn.textContent = 'Send code';
        signedIn(d.user, 'Password updated. You\'re signed in.');
      }
    } catch (err) { formError(f, err); } finally { setLoading(btn, false); }
  });

  /* ---------------- profile ---------------- */
  const profileDlg = $('#profileDlg');
  let ordersCache = [];
  const STATUS = { created: ['Awaiting payment', 'muted'], submitted: ['Verifying', 'warn'], paid: ['Paid', 'ok'], rejected: ['Rejected', 'bad'] };

  function perksFor(us) {
    const p = planById(us.plan);
    const out = [
      [true, us.unlimited ? 'Unlimited emails' : us.plan === 'free' ? `${p.monthly} emails every month` : `${Number(p.credits).toLocaleString('en-IN')} emails per pack`],
      [true, `Minimum gap: ${us.minGap} seconds`],
    ];
    if (!us.templates) out.push([true, 'Recommended template + your own']);
    out.push([us.templates, 'All email templates'], [us.manual, 'Manual entry mode']);
    if (us.lifetime) out.push([true, 'Lifetime access']);
    return out;
  }

  function renderProfile() {
    const u = A.user;
    if (!u) return;
    const us = u.usage;
    $('#pfAvatar').textContent = u.initials;
    $('#pfName').textContent = u.name;
    $('#pfEmail').textContent = u.email;
    $('#pfTier').innerHTML = tierHtml(us.plan);
    $('#pfPlan').dataset.tier = us.plan;
    $('#pfSince').textContent = us.plan !== 'free' && u.planSince ? `since ${fmtDate(u.planSince)}` : '';
    const meter = $('#pfMeterWrap');
    if (us.unlimited) {
      $('#pfBig').innerHTML = '∞ <small>unlimited emails, for life</small>';
      meter.hidden = true;
      $('#pfNote').textContent = `${Number(us.sentTotal || 0).toLocaleString('en-IN')} emails sent so far.`;
    } else if (us.plan === 'free') {
      $('#pfBig').innerHTML = `${us.remaining} <small>of ${us.limit} emails left this month</small>`;
      meter.hidden = false;
      $('#pfMeter').style.width = `${Math.round((us.remaining / us.limit) * 100)}%`;
      $('#pfNote').textContent = us.expiredPack
        ? `Your ${NAMES[us.expiredPack]} pack is used up, so you're back on Free. Resets on ${fmtDate(us.resetsAt)}.`
        : `Resets on ${fmtDate(us.resetsAt)}.`;
    } else {
      const total = planById(us.plan).credits || us.remaining;
      $('#pfBig').innerHTML = `${Number(us.remaining).toLocaleString('en-IN')} <small>emails left in your pack</small>`;
      meter.hidden = false;
      $('#pfMeter').style.width = `${Math.min(100, Math.round((us.remaining / Math.max(total, us.remaining)) * 100))}%`;
      $('#pfNote').textContent = 'Your emails never expire. Buy another pack any time to add more.';
    }
    $('#pfPerks').innerHTML = perksFor(us).map(([ok, t]) => `<li class="${ok ? 'ok' : 'no'}">${esc(t)}</li>`).join('');
    $('#pfUpgrade').hidden = us.plan === 'premium';
    $('#pfUpgrade').textContent = us.plan === 'free' ? 'Upgrade plan' : 'Buy more or upgrade';
    $('#pfMember').textContent = `Member since ${fmtDate(u.memberSince)}`;
    $('#pfAdmin').hidden = !u.admin;
    renderOrders();
  }
  function renderOrders() {
    const list = $('#pfOrders');
    if (!ordersCache.length) { list.innerHTML = '<li class="muted small">No payments yet.</li>'; return; }
    list.innerHTML = ordersCache.map((o) => {
      const [label, cls] = STATUS[o.status] || [o.status, 'muted'];
      const how = o.method === 'coupon' ? 'Coupon' : o.method === 'upi' ? 'UPI' : 'Card / Netbanking';
      return `<li><div><b>${esc(NAMES[o.plan])}</b> · ${o.amount ? rupees(o.amount) : 'Free'}<small>${esc(fmtDate(o.created_at))} · ${how} · ${esc(o.id)}${o.note && o.status === 'rejected' ? ` · ${esc(o.note)}` : ''}</small></div>
        <span class="ost ost-${cls}">${esc(label)}</span>${o.status === 'created' && o.method === 'upi' ? `<button type="button" class="link-btn" data-resume="${esc(o.id)}">Finish</button>` : ''}</li>`;
    }).join('');
  }
  async function loadOrders() {
    try {
      const d = await api('api/billing/orders');
      ordersCache = d.orders || [];
      renderOrders();
      if (A.config.payments.razorpay && ordersCache.some((o) => o.method === 'razorpay' && o.status === 'created')) {
        const s = await api('api/billing/razorpay/sync', {});
        if (s.updated) { setUser(s.user); toast('Payment confirmed. Your plan is active.', 'ok'); loadOrders(); }
      }
    } catch (_) { /* profile still works without the list */ }
  }
  async function openProfile() {
    if (!(await ensureSignedIn('Sign in to see your profile.'))) return;
    renderProfile();
    openDlg(profileDlg);
    loadOrders();
    try { const d = await api('api/me'); if (d.user) setUser(d.user); else { setUser(null); profileDlg.close(); } } catch (_) { /* keep cached */ }
  }
  $('#navProfile').addEventListener('click', openProfile);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-profile]')) openProfile();
    else if (e.target.closest('[data-upgrade]')) openPay({});
    else { const a = e.target.closest('[data-auth]'); if (a) openAuth(a.dataset.auth); }
  });
  $('#pfUpgrade').addEventListener('click', () => { profileDlg.close(); openPay({}); });
  $('#pfOrders').addEventListener('click', (e) => {
    const b = e.target.closest('[data-resume]'); if (!b) return;
    const o = ordersCache.find((x) => x.id === b.dataset.resume); if (!o) return;
    profileDlg.close(); openPay({ plan: o.plan, autoContinue: true });
  });
  $('#pfLogout').addEventListener('click', async () => {
    try { await api('api/auth/logout', {}); } catch (_) { /* clear locally anyway */ }
    profileDlg.close(); ordersCache = [];
    setUser(null);
    toast('Signed out.');
  });
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget; const btn = $('button[type=submit]', f); const msg = $('[data-msg]', f);
    msg.textContent = '';
    setLoading(btn, true);
    try {
      await api('api/auth/password', { current: f.current.value, next: f.next.value });
      f.reset(); msg.className = 'inline-msg small ok'; msg.textContent = 'Password updated. Other devices were signed out.';
    } catch (err) { msg.className = 'inline-msg small err'; msg.textContent = err.message; } finally { setLoading(btn, false); }
  });

  /** Applies a coupon from the profile. 100% coupons activate straight away. */
  $('#pfCouponForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('#pfCoupon').value.trim();
    const msg = $('#pfCouponMsg'); const btn = $('button', e.currentTarget);
    msg.className = 'inline-msg small';
    if (!code) { msg.textContent = 'Enter a coupon code.'; return; }
    setLoading(btn, true);
    try {
      const { quote } = await api('api/billing/quote', { coupon: code });
      if (quote.amount === 0) {
        if (!confirm(`This coupon unlocks the ${NAMES[quote.plan]} plan for free. Activate it now?`)) return;
        const d = await api('api/billing/checkout', { coupon: code, plan: quote.plan });
        $('#pfCoupon').value = '';
        setUser(d.user); loadOrders();
        msg.className = 'inline-msg small ok'; msg.textContent = `${NAMES[quote.plan]} plan activated.`;
        toast(`${NAMES[quote.plan]} plan activated. Enjoy!`, 'ok');
      } else {
        profileDlg.close();
        openPay({ plan: quote.plan, coupon: code });
      }
    } catch (err) { msg.className = 'inline-msg small err'; msg.textContent = err.message; } finally { setLoading(btn, false); }
  });

  /* ---------------- checkout ---------------- */
  const payDlg = $('#payDlg');
  const pay = { plan: 'standard', coupon: '', quote: null, method: 'upi', order: null };

  function payStep(n) {
    $('#payStep1').hidden = n !== 1;
    $('#payStep2').hidden = n !== 2;
    $('#payDone').hidden = n !== 3;
    $('.pay-head', payDlg).hidden = n === 3;
  }
  function renderPlanOpts() {
    const cur = usage().plan;
    $('#planOpts').innerHTML = A.config.plans.filter((p) => p.id !== 'free').map((p) => {
      const on = p.id === pay.plan;
      const what = p.unlimited ? 'Unlimited · lifetime' : `${p.credits.toLocaleString('en-IN')} emails`;
      return `<button type="button" class="plan-opt${on ? ' is-on' : ''}" role="radio" aria-checked="${on}" data-plan="${p.id}">
        ${tierHtml(p.id)}${p.recommended ? '<span class="rec">Recommended</span>' : ''}
        <b>${rupees(p.price)}</b><small>${what} · ${p.minGap}s gap</small>${cur === p.id ? '<em class="cur">Current</em>' : ''}</button>`;
    }).join('');
  }
  function renderSummary() {
    const p = planById(pay.plan);
    const q = pay.quote && pay.quote.plan === pay.plan ? pay.quote : null;
    const total = q ? q.amount : p.price;
    $('#paySummary').innerHTML = `<div><dt>${esc(p.name)} plan</dt><dd>${rupees(p.price)}</dd></div>`
      + (q && q.discount ? `<div class="disc"><dt>Coupon (${q.coupon.percentOff}% off)</dt><dd>−${rupees(q.discount)}</dd></div>` : '')
      + `<div class="total"><dt>Total</dt><dd>${total ? rupees(total) : 'Free'}</dd></div>`;
    const m = A.config.payments;
    $('#payMethods').hidden = !(m.upi && m.razorpay) || total === 0;
    $$('#payMethods .seg-btn').forEach((b) => b.classList.toggle('is-on', b.dataset.m === pay.method));
    const go = $('#payGo');
    if (total === 0) { go.textContent = `Activate ${p.name} for free`; go.disabled = false; $('#payMsg').textContent = ''; } else if (!m.upi && !m.razorpay) {
      go.textContent = 'Payments coming soon'; go.disabled = true;
      $('#payMsg').textContent = 'Online payment is not switched on yet. If you have a coupon, apply it above.';
    } else { go.textContent = `Continue to pay ${rupees(total)}`; go.disabled = false; $('#payMsg').textContent = ''; }
  }
  async function openPay({ plan, coupon = '', autoContinue = false } = {}) {
    if (!(await ensureSignedIn('Create a free account or sign in to upgrade.'))) return;
    if (usage().plan === 'premium') { toast('You already have Premium: unlimited emails for life.', 'ok'); return; }
    const cur = usage().plan;
    pay.plan = plan && plan !== 'free' ? plan : (cur === 'trial' ? 'standard' : cur === 'standard' ? 'standard' : 'standard');
    pay.coupon = ''; pay.quote = null; pay.order = null;
    pay.method = A.config.payments.upi ? 'upi' : 'razorpay';
    $('#payCoupon').value = coupon; $('#payCouponMsg').textContent = '';
    renderPlanOpts(); renderSummary(); payStep(1);
    openDlg(payDlg);
    if (coupon) await applyPayCoupon();
    if (autoContinue) $('#payGo').click();
  }
  $('#planOpts').addEventListener('click', (e) => {
    const b = e.target.closest('.plan-opt'); if (!b) return;
    if (pay.quote && pay.quote.plan !== b.dataset.plan) {
      $('#payCouponMsg').className = 'inline-msg small';
      $('#payCouponMsg').textContent = `Your coupon is for the ${NAMES[pay.quote.plan]} plan, so it won't apply to ${NAMES[b.dataset.plan]}.`;
    } else if (pay.quote) $('#payCouponMsg').textContent = '';
    pay.plan = b.dataset.plan; renderPlanOpts(); renderSummary();
  });
  $$('#payMethods .seg-btn').forEach((b) => b.addEventListener('click', () => { pay.method = b.dataset.m; renderSummary(); }));

  async function applyPayCoupon() {
    const code = $('#payCoupon').value.trim();
    const msg = $('#payCouponMsg'); const btn = $('#payCouponForm button');
    msg.className = 'inline-msg small';
    if (!code) { pay.coupon = ''; pay.quote = null; msg.textContent = ''; renderSummary(); return; }
    setLoading(btn, true);
    try {
      const { quote } = await api('api/billing/quote', { coupon: code, plan: pay.plan });
      pay.coupon = code; pay.quote = quote; pay.plan = quote.plan;
      msg.className = 'inline-msg small ok';
      msg.textContent = quote.amount === 0 ? `Coupon applied: ${NAMES[quote.plan]} is free for you.` : `Coupon applied: ${quote.coupon.percentOff}% off ${NAMES[quote.plan]}.`;
      renderPlanOpts(); renderSummary();
    } catch (err) {
      pay.coupon = ''; pay.quote = null;
      msg.className = 'inline-msg small err'; msg.textContent = err.message; renderSummary();
    } finally { setLoading(btn, false); }
  }
  $('#payCouponForm').addEventListener('submit', (e) => { e.preventDefault(); applyPayCoupon(); });

  function done(title, text) {
    $('#doneTitle').textContent = title;
    $('#doneText').textContent = text;
    payStep(3);
  }

  $('#payGo').addEventListener('click', async () => {
    const btn = $('#payGo'); const msg = $('#payMsg');
    msg.textContent = '';
    if ($('#payCoupon').value.trim() && !pay.quote) await applyPayCoupon();
    setLoading(btn, true);
    try {
      const body = { plan: pay.plan, method: pay.method };
      if (pay.quote && pay.quote.plan === pay.plan) body.coupon = pay.coupon;
      const d = await api('api/billing/checkout', body);
      if (d.activated) {
        setUser(d.user);
        done(`${NAMES[pay.plan]} is active`, 'Your coupon was applied and your plan is ready to use.');
        return;
      }
      pay.order = d;
      if (d.upi) await showUpi(d); else if (d.razorpay) await openRazorpay(d);
    } catch (err) { msg.textContent = err.message; } finally { setLoading(btn, false); }
  });

  async function showUpi(d) {
    $('#upiAmt').textContent = d.upi.amount.toLocaleString('en-IN');
    $('#upiName').textContent = d.upi.name;
    $('#upiVpa').textContent = d.upi.vpa;
    $('#upiOrder').textContent = d.orderId;
    const open = $('#upiOpen');
    open.href = d.upi.uri;
    open.hidden = !matchMedia('(pointer: coarse)').matches;
    $('#utrInput').value = ''; $('#utrMsg').textContent = '';
    payStep(2);
    const box = $('#upiQr');
    box.innerHTML = '<span class="muted small">Loading QR…</span>';
    try {
      await loadScript('vendor/qrcode.js');
      const qr = window.qrcode(0, 'M');
      qr.addData(d.upi.uri);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch (e) { box.innerHTML = '<span class="muted small">Use the UPI ID to pay.</span>'; }
  }
  $('#upiCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#upiVpa').textContent); toast('UPI ID copied.', 'ok'); } catch (_) { toast('Copy failed. Select the UPI ID and copy it.'); }
  });
  $('#payBack').addEventListener('click', () => payStep(1));
  $('#utrForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const utr = $('#utrInput').value.replace(/\s+/g, '');
    const msg = $('#utrMsg'); const btn = $('button[type=submit]', e.currentTarget);
    msg.textContent = '';
    if (!/^\d{12}$/.test(utr)) { msg.textContent = 'Enter the 12-digit UPI transaction ID (UTR) from your payment app.'; return; }
    setLoading(btn, true);
    try {
      await api('api/billing/upi', { orderId: pay.order.orderId, utr });
      done('Payment submitted', `Thanks! We're verifying UTR ${utr}. Your ${NAMES[pay.plan]} plan will be activated as soon as it's confirmed, usually within a few hours. You can track it in your profile.`);
    } catch (err) { msg.textContent = err.message; } finally { setLoading(btn, false); }
  });

  async function openRazorpay(d) {
    await loadScript('https://checkout.razorpay.com/v1/checkout.js');
    const rz = new window.Razorpay(Object.assign({}, d.razorpay, {
      theme: { color: '#0f766e' },
      handler: async (resp) => {
        try {
          const v = await api('api/billing/razorpay/verify', Object.assign({ orderId: d.orderId }, resp));
          setUser(v.user);
          done(`${NAMES[pay.plan]} is active`, 'Payment received. Thank you!');
        } catch (err) { $('#payMsg').textContent = err.message; }
      },
    }));
    rz.on('payment.failed', (r) => { $('#payMsg').textContent = (r && r.error && r.error.description) || 'Payment failed. Please try again.'; });
    rz.open();
  }

  /* ---------------- locked features ---------------- */
  const LOCKS = {
    templates: ['Unlock all templates', 'Ready-made templates for freshers, referrals, follow-ups, career switches and more come with the Trial, Standard and Premium plans. On Free you can use the Recommended template or write your own.'],
    manual: ['Unlock manual entry', '"I\'ll write it myself" mode is part of the Trial, Standard and Premium plans. On Free, your introduction is written from your resume, and you can still edit every word.'],
    gap: ['Send faster', 'Shorter gaps between emails come with paid plans: 10 seconds on Trial, 5 on Standard, and from 2 seconds on Premium.'],
    quota: ['You\'re out of emails', 'Upgrade to keep sending: Trial adds 100 emails, Standard adds 1,000, and Premium is unlimited for life.'],
  };
  const lockDlg = $('#lockDlg');
  function showLocked(feature) {
    const [title, text] = LOCKS[feature] || LOCKS.templates;
    $('#lockTitle').textContent = title;
    $('#lockText').textContent = text;
    openDlg(lockDlg);
  }
  $('#lockGo').addEventListener('click', () => { lockDlg.close(); openPay({}); });

  /* ---------------- pricing section ---------------- */
  $$('.plan [data-plan]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.plan === 'free') {
      if (await ensureSignedIn()) document.getElementById('app').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    openPay({ plan: b.dataset.plan });
  }));

  /* ---------------- boot ---------------- */
  render();
  const ready = api('api/bootstrap', null, { timeout: 15000 }).then((cfg) => {
    A.config = Object.assign(A.config, cfg);
    A.known = true;
    setUser(cfg.user);
    return cfg;
  }).catch((e) => {
    A.known = true;
    render();
    throw e;
  });
  ready.catch(() => {});

  window.Account = {
    ready,
    api,
    tierHtml,
    LOCK_SVG,
    get user() { return A.user; },
    get config() { return A.config; },
    get known() { return A.known; },
    signedIn: () => !!A.user,
    usage,
    can,
    minGap: () => usage().minGap,
    gapChoices: () => A.config.gapChoices,
    planName: (id) => NAMES[id] || id,
    onChange: (fn) => listeners.push(fn),
    setUsage,
    setUser,
    ensureSignedIn,
    openAuth,
    openProfile,
    openPay,
    showLocked,
  };
})();
