/* ResuMail front-end. Vanilla JS, no build step. */
(() => {
  'use strict';

  /* ---------------- utilities ---------------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(`rm.${k}`); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(`rm.${k}`, JSON.stringify(v)); return true; } catch (_) { return false; } },
    del(k) { try { localStorage.removeItem(`rm.${k}`); } catch (_) { /* ignore */ } },
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const fmtDuration = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  };
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const extOf = (name) => (String(name).match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
  const A = window.Analyzer;
  const M = window.Merge;
  const Acc = window.Account;

  const scripts = {};
  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = resolve;
        s.onerror = () => { delete scripts[src]; reject(new Error('A required component could not be loaded. Check your connection and try again.')); };
        document.head.appendChild(s);
      });
    }
    return scripts[src];
  }

  function toast(msg, type = '', ms = 4200) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', type === 'err' ? 'alert' : 'status');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, ms);
  }
  function setLoading(btn, on) { btn.classList.toggle('is-loading', on); btn.disabled = on; }

  async function api(path, body, timeoutMs = 45000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        cache: 'no-store',
      });
      let data = null;
      try { data = await res.json(); } catch (_) { /* non-JSON */ }
      if (!res.ok || !data || data.ok === false) {
        const e = new Error((data && data.error) || (res.status === 413 ? 'Your resume is too large to send. Use a file under 2.5 MB.' : `Server error (${res.status}).`));
        e.code = (data && data.code) || (res.status === 413 ? 'TOO_LARGE' : res.status === 404 ? 'NO_BACKEND' : `HTTP_${res.status}`);
        e.status = res.status;
        e.data = data || {};
        e.retryAfter = (data && data.retryAfter) || Number(res.headers.get('Retry-After')) || 0;
        throw e;
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') { const x = new Error('The request timed out. Check your internet connection.'); x.code = 'TIMEOUT'; throw x; }
      if (e instanceof TypeError) { const x = new Error('Could not reach the ResuMail server. Is it running?'); x.code = 'NETWORK'; throw x; }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------------- defaults & state ---------------- */
  const DEFAULT_SUBJECT = 'Application for {{role}} – {{my_name}}';
  const DEFAULT_BODY = [
    'Hi {{first_name|there}},',
    '',
    'I hope you are doing well. I am writing to express my interest in {{role}} opportunities at {{company|your organization}}.',
    '',
    '{{intro}}',
    '',
    '{{highlights}}',
    '',
    'I have attached my resume for your review. I would be glad to discuss how I can contribute to your team, and I am available for a call or interview at your convenience.',
    '',
    'Thank you for your time and consideration.',
    '',
    'Best regards,',
    '{{my_name}}',
    '{{my_contact}}',
    '{{my_links}}',
  ].join('\n');
  const OLD_DEFAULT_BODY = ['Hi {{first_name|there}},', '', 'I hope you are doing well. I am writing to express my interest in {{role}} opportunities at {{company|your organization}}.', '', '{{intro}}', '',
    'I have attached my resume for your reference. I would be grateful for the chance to discuss how I can contribute to your team.', '', 'Thank you for your time and consideration.', '', 'Best regards,',
    '{{my_name}}', '{{my_phone}}', '{{my_email}}', '{{my_links}}'].join('\n');
  const MAX_RESUME = 2.5 * 1024 * 1024;
  const MAX_SKILLS = 10;
  const FATAL = new Set(['AUTH', 'LIMIT', 'BAD_SENDER', 'BAD_KEY', 'NO_SERVER_SENDER', 'BAD_HOST', 'TOO_LARGE', 'BAD_ATTACHMENT', 'VALIDATION', 'NO_BACKEND',
    'QUOTA', 'AUTH_REQUIRED', 'BLOCKED', 'TEST_LIMIT', 'PLAN_REQUIRED', 'LOCKED']);
  const RETRYABLE = new Set(['NETWORK', 'TIMEOUT', 'CONNECTION', 'THROTTLED', 'RATE_LIMIT', 'SEND_FAILED', 'SERVER', 'UNAVAILABLE']);
  const ME_DEFAULTS = { name: '', email: '', phone: '', linkedin: '', github: '', location: '', notice: '', role: '', experience: '', currentTitle: '', currentCompany: '', degree: '', college: '', certifications: '', achievement: '', skills: [], intro: '' };

  const savedCompose = LS.get('compose', {});
  if (savedCompose.body === OLD_DEFAULT_BODY) savedCompose.body = DEFAULT_BODY;
  const state = {
    step: 1,
    server: { serverSender: false, serverFrom: null },
    sender: Object.assign({ mode: 'own', provider: 'gmail', user: '', pass: '', fromName: '', host: '', port: '587', fromEmail: '', remember: false, verifiedKey: '' }, LS.get('sender', {})),
    accessKey: (() => { try { return sessionStorage.getItem('rm.key') || ''; } catch (_) { return ''; } })(),
    resume: LS.get('resume', null),
    mode: LS.get('mode', 'auto'),
    profile: LS.get('profile', null),
    introTouched: LS.get('introTouched', false),
    skillsTouched: LS.get('skillsTouched', false),
    introLength: LS.get('introLength', 'detailed'),
    me: Object.assign({}, ME_DEFAULTS, LS.get('me', {})),
    recipients: (LS.get('recipients', []) || []).map((r) => (r.status === 'sending' ? { ...r, status: 'pending' } : r)),
    compose: Object.assign({ subject: DEFAULT_SUBJECT, body: DEFAULT_BODY, attach: true, delay: '30', tpl: 'default' }, savedCompose),
    previewIndex: 0,
    run: { active: false, paused: false, stop: false, durations: [] },
    lastField: null,
  };
  if (!Array.isArray(state.me.skills)) state.me.skills = [];

  const persist = {
    sender() { const s = { ...state.sender }; if (!s.remember) s.pass = ''; LS.set('sender', s); },
    me: debounce(() => LS.set('me', state.me), 250),
    compose: debounce(() => LS.set('compose', state.compose), 250),
    recipients: debounce(() => { if (!LS.set('recipients', state.recipients)) toast('Your list is too large to save in this browser; it will be lost on reload.', 'err'); }, 300),
    flags() { LS.set('profile', state.profile); LS.set('introTouched', state.introTouched); LS.set('skillsTouched', state.skillsTouched); LS.set('introLength', state.introLength); },
  };

  /* ---------------- theme ---------------- */
  $('#themeToggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('rm.theme', next); } catch (_) { /* stored raw; read in <head> */ }
  });

  /* ---------------- steps ---------------- */
  function goto(n, { scroll = true } = {}) {
    state.step = n;
    $$('.panel').forEach((p) => { p.hidden = Number(p.dataset.panel) !== n; });
    $$('.step').forEach((b) => {
      const on = Number(b.dataset.step) === n;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    if (n === 3) renderList();
    if (n === 4) renderCompose();
    const bar = $('.stepper'); const active = $('.step.is-active');
    if (bar.scrollWidth > bar.clientWidth) bar.scrollTo({ left: active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2, behavior: 'smooth' });
    if (scroll) {
      const top = bar.getBoundingClientRect().top + window.scrollY - 80;
      if (Math.abs(window.scrollY - top) > 40) window.scrollTo({ top, behavior: 'smooth' });
    }
    updateSteps();
  }
  $$('.step').forEach((b) => b.addEventListener('click', () => goto(Number(b.dataset.step))));

  function senderKey() {
    const s = state.sender;
    if (s.mode === 'server') return `server|${hash(state.accessKey)}`;
    return hash([s.provider, s.user.trim().toLowerCase(), s.pass, s.host, s.port, s.fromEmail].join('|'));
  }
  const isVerified = () => !!state.sender.verifiedKey && state.sender.verifiedKey === senderKey();
  const pendingCount = () => state.recipients.filter((r) => r.status === 'pending').length;

  function updateSteps() {
    const done = {
      1: isVerified(),
      2: !!(state.me.name.trim() && state.me.intro.trim() && state.me.role.trim()),
      3: state.recipients.length > 0,
      4: state.recipients.length > 0 && pendingCount() === 0 && state.recipients.some((r) => r.status === 'sent'),
    };
    $$('.step').forEach((b) => b.classList.toggle('is-done', !!done[b.dataset.step] && Number(b.dataset.step) !== state.step));
    const s = state.sender;
    $('#stepSub1').textContent = done[1] ? (s.mode === 'server' ? 'Server sender' : (s.fromEmail || s.user)) : 'Connect your account';
    $('#stepSub2').textContent = state.resume ? state.resume.name : (state.mode === 'manual' ? 'Writing manually' : 'Analyze or write');
    $('#stepSub3').textContent = state.recipients.length ? `${state.recipients.length} recipient${state.recipients.length === 1 ? '' : 's'}` : 'Excel, CSV or paste';
    const sent = state.recipients.filter((r) => r.status === 'sent').length;
    $('#stepSub4').textContent = state.run.active ? 'Sending…' : sent ? `${sent} sent` : 'Preview and launch';
    const badge = $('#senderBadge');
    badge.textContent = done[1] ? 'Connected' : 'Not connected';
    badge.classList.toggle('ok', done[1]);
  }

  /* ================= STEP 1: SENDER ================= */
  const PROVIDER_UI = {
    gmail: { label: 'Gmail address', ph: 'you@gmail.com', pass: '16-character app password', help: true },
    yahoo: { label: 'Yahoo email', ph: 'you@yahoo.com', pass: 'Yahoo app password' },
    zoho: { label: 'Zoho email', ph: 'you@zohomail.com', pass: 'Zoho app password' },
    zoho_in: { label: 'Zoho email', ph: 'you@zohomail.in', pass: 'Zoho app password' },
    brevo: { label: 'Brevo SMTP login', ph: 'xxxx@smtp-brevo.com', pass: 'Brevo SMTP key', brevo: true },
    custom: { label: 'SMTP username', ph: 'you@yourdomain.com', pass: 'SMTP password', custom: true },
  };

  function fillSenderForm() {
    const s = state.sender;
    $('#provider').value = s.provider;
    $('#fromName').value = s.fromName;
    $('#smtpUser').value = s.user;
    $('#smtpPass').value = s.pass;
    $('#smtpHost').value = s.host;
    $('#smtpPort').value = s.port;
    $('#fromEmail').value = s.fromEmail;
    $('#fromEmailBrevo').value = s.fromEmail;
    $('#remember').checked = !!s.remember;
    $('#accessKey').value = state.accessKey;
    applyProvider(); applySenderMode();
  }
  function applyProvider() {
    const ui = PROVIDER_UI[state.sender.provider] || PROVIDER_UI.gmail;
    $('#userLabel').textContent = ui.label;
    $('#smtpUser').placeholder = ui.ph;
    $('#smtpUser').type = ui.brevo || ui.custom ? 'text' : 'email';
    $('#smtpPass').placeholder = ui.pass;
    $('#customFields').hidden = !ui.custom;
    $('#brevoFields').hidden = !ui.brevo;
    $('#gmailHelp').hidden = !ui.help || (state.sender.mode === 'server' && state.server.serverSender);
  }
  function applySenderMode() {
    const server = state.sender.mode === 'server' && state.server.serverSender;
    $('#ownSender').hidden = server;
    $('#serverSender').hidden = !server;
    $$('#senderModeSeg .seg-btn').forEach((b) => b.classList.toggle('is-on', b.dataset.mode === (server ? 'server' : 'own')));
    applyProvider();
  }
  function onSenderChange() {
    const s = state.sender;
    s.provider = $('#provider').value;
    s.fromName = $('#fromName').value.trim();
    s.user = $('#smtpUser').value.trim();
    s.pass = $('#smtpPass').value;
    s.host = $('#smtpHost').value.trim();
    s.port = $('#smtpPort').value;
    s.remember = $('#remember').checked;
    applyProvider(); persist.sender();
    $('#verifyMsg').textContent = '';
    updateSteps();
  }
  ['#provider', '#fromName', '#smtpUser', '#smtpPass', '#smtpHost', '#smtpPort', '#remember'].forEach((id) => {
    $(id).addEventListener('input', onSenderChange);
    $(id).addEventListener('change', onSenderChange);
  });
  ['#fromEmail', '#fromEmailBrevo'].forEach((id) => $(id).addEventListener('input', (e) => {
    state.sender.fromEmail = e.target.value.trim();
    $('#fromEmail').value = $('#fromEmailBrevo').value = state.sender.fromEmail;
    persist.sender(); updateSteps();
  }));
  $('#accessKey').addEventListener('input', (e) => {
    state.accessKey = e.target.value;
    try { sessionStorage.setItem('rm.key', state.accessKey); } catch (_) { /* ignore */ }
    updateSteps();
  });
  $('#togglePass').addEventListener('click', () => {
    const inp = $('#smtpPass'); const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    $('#togglePass').textContent = show ? 'Hide' : 'Show';
    $('#togglePass').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  $$('#senderModeSeg .seg-btn').forEach((b) => b.addEventListener('click', () => {
    state.sender.mode = b.dataset.mode; persist.sender(); applySenderMode(); updateSteps();
  }));

  function senderPayload() {
    const s = state.sender;
    if (s.mode === 'server' && state.server.serverSender) return { smtp: { useServer: true }, accessKey: state.accessKey };
    const smtp = { provider: s.provider, user: s.user, pass: s.pass, fromName: s.fromName || state.me.name };
    if (s.provider === 'custom') Object.assign(smtp, { host: s.host, port: Number(s.port), fromEmail: s.fromEmail });
    if (s.provider === 'brevo') smtp.fromEmail = s.fromEmail;
    return { smtp };
  }
  function senderAddress() {
    const s = state.sender;
    if (s.mode === 'server' && state.server.serverSender) return state.me.email || '';
    return (s.provider === 'custom' || s.provider === 'brevo') ? s.fromEmail : s.user;
  }
  function validateSender() {
    const s = state.sender;
    if (s.mode === 'server' && state.server.serverSender) return state.accessKey ? '' : 'Enter the access key.';
    if (!s.user) return 'Enter your email address.';
    if ((s.provider !== 'brevo' && s.provider !== 'custom') && !M.isEmail(s.user)) return 'That email address doesn\'t look right.';
    if (!s.pass) return 'Enter your app password.';
    if (s.provider === 'gmail' && s.pass.replace(/\s/g, '').length !== 16) return 'Gmail app passwords are exactly 16 letters. Create one at myaccount.google.com/apppasswords.';
    if (s.provider === 'custom' && !s.host) return 'Enter the SMTP host.';
    if ((s.provider === 'custom' || s.provider === 'brevo') && !M.isEmail(s.fromEmail)) return 'Enter a valid "From" email address.';
    return '';
  }

  async function verifySender() {
    const problem = validateSender();
    const msg = $('#verifyMsg');
    if (problem) { msg.textContent = problem; msg.className = 'inline-msg err'; throw Object.assign(new Error(problem), { code: 'BAD_SENDER' }); }
    if (!(await Acc.ensureSignedIn('Sign in or create a free account to connect your email.'))) {
      msg.textContent = 'Sign in to connect your email.'; msg.className = 'inline-msg err';
      throw Object.assign(new Error('Sign in to continue.'), { code: 'AUTH_REQUIRED' });
    }
    const btn = $('#verifyBtn');
    setLoading(btn, true);
    msg.textContent = ''; msg.className = 'inline-msg';
    try {
      const res = await api('api/verify', senderPayload(), 30000);
      state.sender.verifiedKey = senderKey();
      persist.sender();
      if (!state.me.email && state.sender.mode !== 'server') { state.me.email = senderAddress(); fillMe(); persist.me(); }
      if (!state.me.name && state.sender.fromName) { state.me.name = state.sender.fromName; fillMe(); persist.me(); }
      msg.textContent = `Connected as ${res.from}`; msg.className = 'inline-msg ok';
      updateSteps();
      return true;
    } catch (e) {
      state.sender.verifiedKey = ''; persist.sender();
      if (e.code === 'AUTH_REQUIRED') Acc.setUser(null);
      msg.textContent = e.message; msg.className = 'inline-msg err';
      updateSteps();
      throw e;
    } finally {
      setLoading(btn, false);
    }
  }
  $('#verifyBtn').addEventListener('click', async () => {
    try { await verifySender(); toast('Sender connected.', 'ok'); setTimeout(() => goto(2), 400); } catch (_) { /* shown inline */ }
  });

  /* ================= STEP 2: RESUME & PROFILE ================= */
  function bufToBase64(buf) {
    const bytes = new Uint8Array(buf); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function base64ToBuf(b64) {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  async function pdfToText(buf) {
    await loadScript('vendor/pdf.min.js');
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    const pdf = await lib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise;
    const out = [];
    for (let p = 1; p <= Math.min(pdf.numPages, 12); p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const lines = []; let cur = null;
      for (const it of tc.items) {
        if (typeof it.str !== 'string') continue;
        const y = it.transform[5]; const x = it.transform[4];
        if (!cur || Math.abs(cur.y - y) > Math.max(2, (it.height || 10) * 0.45)) { cur = { y, parts: [] }; lines.push(cur); }
        if (it.str) cur.parts.push({ x, s: it.str, w: it.width || 0 });
      }
      for (const l of lines) {
        l.parts.sort((a, b) => a.x - b.x);
        let s = ''; let end = null;
        for (const pt of l.parts) {
          if (end !== null && pt.x - end > 1 && !s.endsWith(' ') && !pt.s.startsWith(' ')) s += pt.x - end > 18 ? '  ' : ' ';
          s += pt.s; end = pt.x + pt.w;
        }
        if (s.trim()) out.push(s.trim());
      }
      page.cleanup();
    }
    pdf.destroy();
    return out.join('\n');
  }
  async function docxToText(buf) {
    await loadScript('vendor/mammoth.browser.min.js');
    const res = await window.mammoth.extractRawText({ arrayBuffer: buf.slice(0) });
    return res.value || '';
  }
  async function resumeText(buf, ext) {
    if (ext === 'pdf') return pdfToText(buf);
    if (ext === 'docx') return docxToText(buf);
    if (ext === 'txt') return new TextDecoder().decode(buf);
    return '';
  }

  const resumeDrop = $('#resumeDrop');
  const resumeInput = $('#resumeInput');
  function wireDrop(zone, input, onFile, guard) {
    zone.addEventListener('click', (e) => { if (guard && !guard()) return; if (e.target.closest('button')) return; input.click(); });
    zone.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && (!guard || guard()) && e.target === zone) { e.preventDefault(); input.click(); } });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('is-over');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) onFile(f);
    });
    input.addEventListener('change', () => { const f = input.files && input.files[0]; input.value = ''; if (f) onFile(f); });
  }
  let scanning = false;
  wireDrop(resumeDrop, resumeInput, handleResume, () => !state.resume && !scanning);
  $('#resumeReplace').addEventListener('click', () => resumeInput.click());
  $('#resumeRemove').addEventListener('click', () => {
    state.resume = null; LS.del('resume');
    renderResume(); updateSteps(); renderCompose();
  });

  function showScanner(on) {
    scanning = on;
    resumeDrop.classList.toggle('is-scanning', on);
    $('#resumeScanner').hidden = !on;
    if (on) { $('#resumeEmpty').hidden = true; $('#resumeChip').hidden = true; } else renderResume();
  }
  async function scannerTicker(stopSignal) {
    const msgs = ['Reading text', 'Finding skills & experience', 'Matching best-fit roles', 'Writing your introduction'];
    for (let i = 0; !stopSignal.done; i = Math.min(i + 1, msgs.length - 1)) {
      $('#scanStatus').textContent = `${msgs[i]}…`;
      await sleep(420);
    }
  }

  async function handleResume(file) {
    const ext = extOf(file.name);
    if (!['pdf', 'docx', 'doc', 'txt'].includes(ext)) return toast('Please upload a PDF, DOCX or TXT resume.', 'err');
    if (file.size > MAX_RESUME) return toast(`That file is ${fmtBytes(file.size)}. Please use a resume under 2.5 MB.`, 'err');
    if (!file.size) return toast('That file is empty.', 'err');
    const stop = { done: false };
    showScanner(true);
    scannerTicker(stop);
    const started = Date.now();
    try {
      const buf = await file.arrayBuffer();
      const type = file.type || ({ pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', txt: 'text/plain' })[ext];
      state.resume = { name: file.name, size: file.size, type, base64: bufToBase64(buf) };
      if (!LS.set('resume', state.resume)) toast('Resume is attached, but too large to remember after a reload.');
      let analyzed = false;
      if (state.mode === 'auto') analyzed = await analyzeBuffer(buf, ext);
      const wait = 900 - (Date.now() - started); // let the scan animation read as a real step
      if (wait > 0 && state.mode === 'auto') await sleep(wait);
      stop.done = true; showScanner(false);
      updateSteps(); renderCompose(); renderProfile();
      toast(analyzed ? 'Resume analyzed. Review your details below.' : 'Resume added.', 'ok');
      if (analyzed) setTimeout(() => { const c = $('#rolesCard'); if (c && !c.hidden) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 150);
    } catch (e) {
      stop.done = true; showScanner(false);
      toast(`Couldn't read that file: ${e.message}`, 'err');
    }
  }

  function renderResume() {
    const r = state.resume;
    resumeDrop.classList.toggle('has-file', !!r);
    resumeDrop.setAttribute('tabindex', r ? '-1' : '0');
    $('#resumeEmpty').hidden = !!r;
    $('#resumeChip').hidden = !r;
    if (r) {
      $('#resumeName').textContent = r.name;
      $('#resumeMeta').textContent = `${fmtBytes(r.size)} · attached to every email`;
      $('#resumeChip .file-ico').textContent = extOf(r.name).toUpperCase() || 'FILE';
    }
  }

  /** Returns true when the resume was analyzed and the profile filled. */
  async function analyzeBuffer(buf, ext) {
    const warn = $('#analysisWarn');
    warn.hidden = true;
    if (ext === 'doc') {
      warn.textContent = 'Old .doc files can be attached but not analyzed. Save it as PDF or DOCX to analyze it, or fill in your details below.';
      warn.hidden = false; return false;
    }
    const text = await resumeText(buf, ext);
    if (text.replace(/\s/g, '').length < 80) {
      warn.textContent = 'We couldn\'t read text from this file. It might be a scanned image. It will still be attached; fill in your details below or upload a text-based PDF/DOCX.';
      warn.hidden = false; return false;
    }
    const p = A.analyze(text);
    state.profile = p;
    const role = (p.roles[0] && p.roles[0].title) || state.me.role || '';
    const filled = {
      name: p.name,
      email: p.email,
      phone: p.phone,
      linkedin: p.linkedin,
      github: p.github || p.portfolio,
      location: p.location,
      role,
      experience: p.experienceYears ? p.experienceLabel : (p.hasInternship ? 'Fresher (with internship experience)' : 'Fresher'),
      currentTitle: p.currentTitle,
      currentCompany: p.currentCompany,
      degree: p.education ? p.education.short : '',
      college: p.education ? p.education.institution : '',
      certifications: p.certifications.join(', '),
      achievement: p.achievement,
    };
    Object.entries(filled).forEach(([k, v]) => { if (v) state.me[k] = v; });
    state.me.skills = A.pickSkills(p, role, 6);
    state.introTouched = false; state.skillsTouched = false;
    state.me.intro = buildIntro();
    fillMe(Object.keys(filled).filter((k) => filled[k]));
    persist.me(); persist.flags();
    return true;
  }

  async function ensureAnalysis() {
    if (state.profile || !state.resume || state.mode !== 'auto' || scanning) { renderProfile(); return; }
    const stop = { done: false };
    showScanner(true); scannerTicker(stop);
    try { await analyzeBuffer(base64ToBuf(state.resume.base64), extOf(state.resume.name)); } catch (e) { toast(`Couldn't analyze the resume: ${e.message}`, 'err'); }
    stop.done = true; showScanner(false); renderProfile(); updateSteps();
  }

  /* --- profile form --- */
  const FIELDS = $$('#panel-2 [data-k]');
  function fillMe(highlightKeys) {
    FIELDS.forEach((el) => {
      const k = el.dataset.k;
      el.value = state.me[k] || '';
      el.classList.toggle('filled', !!(highlightKeys && highlightKeys.includes(k) && el.value));
    });
    updateIntroCount();
  }

  function facts() {
    const p = state.profile || {};
    return { ...state.me, softSkills: p.softSkills || [], hasProjects: !!p.hasProjects, hasInternship: !!p.hasInternship };
  }
  const buildIntro = () => A.writeIntro(facts(), { length: state.introLength });
  function regenIntro() {
    state.me.intro = buildIntro();
    $('#meIntro').value = state.me.intro;
    updateIntroCount(); persist.me(); updateSteps();
  }
  const autoRegen = debounce(() => { if (state.mode === 'auto' && !state.introTouched && hasProfileData()) regenIntro(); }, 350);
  const hasProfileData = () => !!(state.profile || state.me.skills.length || state.me.experience || state.me.degree);

  FIELDS.forEach((el) => el.addEventListener('input', () => {
    const k = el.dataset.k;
    state.me[k] = el.value;
    el.classList.remove('invalid', 'filled');
    if (k === 'intro') { state.introTouched = true; persist.flags(); updateIntroCount(); updateIntroHint(); } else autoRegen();
    if (k === 'role') renderRoles();
    persist.me(); updateSteps();
  }));
  $('#roleOptions').innerHTML = A.ROLE_TITLES.map((t) => `<option value="${esc(t)}">`).join('');

  function renderProfile() {
    const auto = state.mode === 'auto';
    document.body.classList.toggle('mode-auto', auto);
    document.body.classList.toggle('mode-manual', !auto);
    $$('#modeSeg .seg-btn').forEach((x) => { const on = x.dataset.mode === state.mode; x.classList.toggle('is-on', on); x.setAttribute('aria-selected', on); });
    $('#modeHint').textContent = auto
      ? (state.profile ? 'Everything below came from your resume. Edit anything that needs fixing.' : 'Upload your resume and we\'ll fill everything in for you.')
      : 'Just add your contact details, the role you want, and a short introduction.';
    $('#detailsTitle').textContent = auto ? 'Review your details' : 'Your details';
    $('#autoBadge').hidden = !(auto && state.profile);
    $('#rolesCard').hidden = !(auto && state.profile && state.profile.roles && state.profile.roles.length);
    if (!auto) $('#analysisWarn').hidden = true;
    $$('#lengthSeg .seg-btn').forEach((b) => b.classList.toggle('is-on', b.dataset.len === state.introLength));
    renderRoles(); renderSkills(); updateIntroHint(); updateIntroCount();
  }

  function renderRoles() {
    const p = state.profile;
    if (!p || !p.roles) return;
    const cur = state.me.role.trim().toLowerCase();
    $('#rolesList').innerHTML = p.roles.map((r) => {
      const on = r.title.toLowerCase() === cur;
      return `<button type="button" class="role${on ? ' is-on' : ''}" data-role="${esc(r.title)}" aria-pressed="${on}">
        <b>${esc(r.title)}</b><span class="fit">${r.fit}% fit</span><span class="bar"><i style="width:${r.fit}%"></i></span></button>`;
    }).join('');
  }
  $('#rolesList').addEventListener('click', (e) => {
    const b = e.target.closest('.role'); if (!b) return;
    state.me.role = b.dataset.role;
    $('#meRole').value = state.me.role;
    $('#meRole').classList.remove('invalid', 'filled');
    if (state.profile && !state.skillsTouched) state.me.skills = A.pickSkills(state.profile, state.me.role, 6);
    if (!state.introTouched) regenIntro();
    else toast('Role updated. Click "Regenerate" to rebuild your edited intro for this role.');
    persist.me(); renderRoles(); renderSkills(); updateSteps();
  });

  function renderSkills() {
    const on = state.me.skills;
    $('#skillsOn').innerHTML = on.length
      ? on.map((s) => `<button type="button" class="chip on" data-skill="${esc(s)}" title="Remove ${esc(s)}">${esc(s)} <span class="x" aria-hidden="true">×</span></button>`).join('')
      : '<span class="muted small">No skills selected yet. Add some below.</span>';
    const p = state.profile;
    const lower = new Set(on.map((s) => s.toLowerCase()));
    const pool = p ? p.skills.map((s) => s.name).concat(p.extraSkills || []) : [];
    const off = pool.filter((s) => !lower.has(s.toLowerCase())).slice(0, 30);
    $('#skillSuggestWrap').hidden = !off.length;
    $('#skillsOff').innerHTML = off.map((s) => `<button type="button" class="chip add" data-skill="${esc(s)}" title="Add ${esc(s)}">${esc(s)}</button>`).join('');
  }
  function changeSkills(next) {
    state.me.skills = next; state.skillsTouched = true;
    persist.me(); persist.flags(); renderSkills(); autoRegen();
  }
  $('#skillsOn').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    changeSkills(state.me.skills.filter((s) => s !== b.dataset.skill));
  });
  $('#skillsOff').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    if (state.me.skills.length >= MAX_SKILLS) return toast(`Keep it to ${MAX_SKILLS} skills so your intro stays easy to read.`);
    changeSkills(state.me.skills.concat(b.dataset.skill));
  });
  function addTypedSkills() {
    const inp = $('#skillInput');
    const items = inp.value.split(',').map((s) => s.trim()).filter((s) => s && s.length <= 40);
    if (!items.length) return;
    const next = state.me.skills.slice();
    items.forEach((s) => { if (next.length < MAX_SKILLS && !next.some((x) => x.toLowerCase() === s.toLowerCase())) next.push(s); });
    if (next.length === MAX_SKILLS && items.length > 0) toast(`Up to ${MAX_SKILLS} skills keep your intro readable.`);
    inp.value = '';
    changeSkills(next);
  }
  $('#skillInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTypedSkills(); } });
  $('#skillAddBtn').addEventListener('click', addTypedSkills);

  $$('#lengthSeg .seg-btn').forEach((b) => b.addEventListener('click', () => {
    state.introLength = b.dataset.len; persist.flags();
    $$('#lengthSeg .seg-btn').forEach((x) => x.classList.toggle('is-on', x === b));
    if (state.introTouched && !confirm('Replace your edited introduction with a new one?')) return;
    state.introTouched = false; persist.flags(); regenIntro(); updateIntroHint();
  }));
  $('#regenBtn').addEventListener('click', () => {
    if (state.introTouched && state.me.intro.trim() && !confirm('Replace your edited introduction with a freshly generated one?')) return;
    state.introTouched = false; persist.flags(); regenIntro(); updateIntroHint();
    toast('Introduction updated from your details.', 'ok');
  });
  $('#guideBtn').addEventListener('click', () => {
    if (state.me.intro.trim() && !confirm('Replace your current introduction with a guided template?')) return;
    const role = state.me.role.trim() || '[Role]';
    state.me.intro = `I am ${state.me.name.trim() || '[Your Name]'}, ${A.article(role)} ${role} with [X years] of experience in [your main area]. My core skills include [Skill 1], [Skill 2] and [Skill 3].\n\nRecently, I [one achievement with a number, e.g. reduced page load time by 40%]. I hold a [Degree] from [College], and I would welcome the opportunity to contribute to your team as ${A.article(role)} ${role}.`;
    $('#meIntro').value = state.me.intro;
    state.introTouched = true; persist.flags(); persist.me(); updateIntroCount(); updateSteps();
    const ta = $('#meIntro'); ta.focus(); const i = state.me.intro.indexOf('['); if (i >= 0) ta.setSelectionRange(i, state.me.intro.indexOf(']', i) + 1);
  });

  function updateIntroCount() {
    const words = state.me.intro.trim().split(/\s+/).filter(Boolean).length;
    $('#introCount').textContent = words ? `· ${words} words` : '';
  }
  function updateIntroHint() {
    let t;
    if (state.mode === 'manual') t = 'Tip: mention your experience, your top 3 skills, one achievement with a number, and the role you want. Keep it under 150 words.';
    else if (!hasProfileData()) t = 'Upload your resume above and this will be written for you.';
    else if (state.introTouched) t = 'You\'ve edited this text, so it won\'t change automatically. Click Regenerate to rebuild it from your details.';
    else t = 'This updates automatically as you edit your details, skills or role.';
    $('#introHint').textContent = t;
  }

  $$('#modeSeg .seg-btn').forEach((b) => b.addEventListener('click', () => {
    if (state.mode === b.dataset.mode) return;
    if (b.dataset.mode === 'manual' && !Acc.can('manual')) { Acc.showLocked('manual'); return; }
    state.mode = b.dataset.mode; LS.set('mode', state.mode);
    renderProfile(); updateSteps(); renderPreview();
    if (state.mode === 'auto') ensureAnalysis();
    else setTimeout(() => $('#meName').focus(), 60);
  }));

  $('#toStep3').addEventListener('click', () => {
    const need = [['#meName', state.me.name, 'Add your full name. It goes in your email signature.'], ['#meRole', state.me.role, 'Add the role you are applying for.'], ['#meIntro', state.me.intro, 'Write a short introduction (or upload your resume to generate one).']];
    for (const [id, v, msg] of need) {
      if (!String(v).trim()) { $(id).classList.add('invalid'); $(id).focus(); return toast(msg, 'err'); }
    }
    if (/\[[^\]]+\]/.test(state.me.intro)) { $('#meIntro').classList.add('invalid'); $('#meIntro').focus(); return toast('Replace the [bracketed] parts of your introduction first.', 'err'); }
    if (!state.resume) toast('No resume attached. You can still send, but recruiters usually expect one.');
    goto(3);
  });

  /* ================= STEP 3: RECIPIENTS ================= */
  wireDrop($('#listDrop'), $('#listInput'), handleList);

  async function handleList(file) {
    const ext = extOf(file.name);
    if (file.size > 15 * 1024 * 1024) return toast('That file is too large (max 15 MB).', 'err');
    try {
      let rows = [];
      if (['xlsx', 'xls', 'ods', 'xlsm'].includes(ext)) {
        await loadScript('vendor/xlsx.full.min.js');
        const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
        wb.SheetNames.forEach((n) => { rows = rows.concat(window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' })); });
      } else if (['csv', 'tsv', 'txt', 'text', ''].includes(ext)) {
        rows = M.parseDelimited((await file.text()).replace(/^﻿/, ''));
      } else {
        return toast('Use an .xlsx, .xls, .csv or .txt file.', 'err');
      }
      addRows(rows, file.name);
    } catch (e) {
      toast(`Couldn't read that file: ${e.message}`, 'err');
    }
  }
  function addRows(rows, label) {
    const res = M.rowsToRecipients(rows, state.recipients);
    state.recipients.push(...res.recipients);
    persist.recipients(); renderList(); updateSteps();
    const extra = [res.duplicates && `${res.duplicates} duplicate${res.duplicates > 1 ? 's' : ''} skipped`, res.invalid && `${res.invalid} invalid skipped`].filter(Boolean).join(' · ');
    if (res.recipients.length) toast(`Added ${res.recipients.length} recipient${res.recipients.length > 1 ? 's' : ''} from ${label}${extra ? ` (${extra})` : ''}.`, 'ok');
    else toast(`No new email addresses found in ${label}${extra ? ` (${extra})` : ''}.`, 'err');
  }
  $('#pasteAdd').addEventListener('click', () => {
    const v = $('#pasteBox').value.trim();
    if (!v) return toast('Paste some email addresses first.', 'err');
    addRows(M.parseDelimited(v), 'pasted text');
    $('#pasteBox').value = '';
  });
  $('#listSearch').addEventListener('input', debounce(renderList, 120));
  $('#clearList').addEventListener('click', () => {
    if (state.run.active) return toast('Stop sending before clearing the list.', 'err');
    if (!state.recipients.length) return;
    if (!confirm(`Remove all ${state.recipients.length} recipients?`)) return;
    state.recipients = []; persist.recipients(); renderList(); updateSteps();
  });
  $('#listBody').addEventListener('click', (e) => {
    const b = e.target.closest('.x'); if (!b) return;
    const r = state.recipients.find((x) => x.id === b.dataset.id);
    if (!r) return;
    if (r.status === 'sending') return toast('That email is being sent right now.', 'err');
    state.recipients = state.recipients.filter((x) => x !== r);
    persist.recipients(); renderList(); updateSteps();
  });

  const STATUS_LABEL = { pending: 'Pending', sending: 'Sending', sent: 'Sent', failed: 'Failed' };
  function counts() {
    const c = { pending: 0, sending: 0, sent: 0, failed: 0 };
    state.recipients.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }
  function renderList() {
    const q = $('#listSearch').value.trim().toLowerCase();
    const all = state.recipients;
    const list = q ? all.filter((r) => `${r.email} ${r.name} ${r.company} ${r.role}`.toLowerCase().includes(q)) : all;
    const shown = list.slice(0, 1000);
    const index = new Map(all.map((r, i) => [r, i + 1]));
    $('#listBody').innerHTML = shown.map((r) => `<tr>
        <td>${index.get(r)}</td>
        <td title="${esc(r.email)}">${esc(r.email)}</td>
        <td>${esc(r.name) || '<span class="muted">-</span>'}</td>
        <td class="${r.companyGuessed ? 'guess' : ''}" title="${r.companyGuessed ? 'Guessed from email domain' : ''}">${esc(r.company) || '<span class="muted">-</span>'}</td>
        <td>${esc(r.role) || '<span class="muted">-</span>'}</td>
        <td><span class="st st-${r.status}" title="${esc(r.error)}">${STATUS_LABEL[r.status] || r.status}</span></td>
        <td><button class="x" type="button" data-id="${r.id}" aria-label="Remove ${esc(r.email)}">×</button></td>
      </tr>`).join('') + (list.length > shown.length ? `<tr><td colspan="7" class="muted">Showing first 1000 of ${list.length}. Use search to find others.</td></tr>` : '');
    const empty = !all.length || !list.length;
    $('#listEmpty').hidden = !empty;
    $('#listEmptyText').textContent = all.length ? 'No recipients match your search.' : 'No recipients yet. Add a file or paste emails above.';
    const c = counts();
    $('#listStats').innerHTML = `<span><b>${all.length}</b> total</span><span><b>${c.pending}</b> pending</span>${c.sent ? `<span><b>${c.sent}</b> sent</span>` : ''}${c.failed ? `<span><b>${c.failed}</b> failed</span>` : ''}`;
  }
  $('#toStep4').addEventListener('click', () => {
    if (!state.recipients.length) return toast('Add at least one recipient.', 'err');
    goto(4);
  });

  /* ================= STEP 4: REVIEW & SEND ================= */
  const PLACEHOLDERS = [
    ['{{first_name}}', "Recipient's first name"], ['{{company}}', 'Company'], ['{{role}}', 'Role'], ['{{intro}}', 'Your introduction'],
    ['{{highlights}}', 'Quick snapshot (experience, skills, education…)'], ['{{experience}}', 'Total experience'], ['{{my_name}}', 'Your name'],
    ['{{my_contact}}', 'Phone | email'], ['{{my_links}}', 'LinkedIn / GitHub'], ['{{my_notice}}', 'Notice period'], ['{{my_location}}', 'Location'], ['{{name}}', "Recipient's full name"],
  ];
  $('#phChips').innerHTML = PLACEHOLDERS.map(([p, t]) => `<button type="button" class="chip" data-ph="${p}" title="Insert: ${esc(t)}">${p}</button>`).join('');
  $('#phChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const el = state.lastField || $('#body');
    const start = el.selectionStart == null ? el.value.length : el.selectionStart;
    const end = el.selectionEnd == null ? start : el.selectionEnd;
    el.setRangeText(b.dataset.ph, start, end, 'end');
    el.focus();
    el.dispatchEvent(new Event('input'));
  });
  ['#subject', '#body'].forEach((id) => {
    $(id).addEventListener('focus', () => { state.lastField = $(id); });
    $(id).addEventListener('input', () => {
      state.compose[id.slice(1)] = $(id).value;
      persist.compose(); renderPreview(); renderChecklist();
    });
  });
  $('#attachResume').addEventListener('change', (e) => { state.compose.attach = e.target.checked; persist.compose(); renderPreview(); renderChecklist(); });
  $('#delay').addEventListener('change', (e) => { state.compose.delay = e.target.value; persist.compose(); });
  $('#gapUpgrade').addEventListener('click', () => Acc.showLocked('gap'));
  $('#resetTemplate').addEventListener('click', () => {
    if (!confirm('Replace the subject and message with the recommended template?')) return;
    state.compose.subject = DEFAULT_SUBJECT; state.compose.body = DEFAULT_BODY; state.compose.tpl = 'default';
    persist.compose(); renderCompose();
  });

  /* --- plan-aware controls: gaps, templates, quota --- */
  const gapPlan = (s) => (s >= 10 ? 'Trial' : s >= 5 ? 'Standard' : 'Premium');
  function renderDelayOptions() {
    const min = Acc.minGap();
    const choices = Acc.gapChoices();
    const sel = $('#delay');
    sel.innerHTML = choices.map((s) => `<option value="${s}"${s < min ? ' disabled' : ''}>${s} seconds${s < min ? ` · ${gapPlan(s)}+` : ''}</option>`).join('');
    // Show the closest allowed gap without overwriting the saved preference (the plan may still be loading).
    const cur = Number(state.compose.delay) || 0;
    sel.value = String(choices.find((s) => s >= Math.max(min, cur)) || min);
    $('#gapUpgrade').hidden = Acc.usage().plan === 'premium';
  }

  let tplCache = null;
  function renderTemplates() {
    const unlocked = Acc.can('templates');
    const list = [{ id: 'default', name: 'Recommended', desc: 'Our all-round template, included in every plan.' }].concat(Acc.config.templates || []);
    $('#tplList').innerHTML = list.map((t) => {
      const locked = t.id !== 'default' && !unlocked;
      return `<button type="button" class="tpl${state.compose.tpl === t.id ? ' is-on' : ''}${locked ? ' locked' : ''}" data-tpl="${esc(t.id)}" title="${esc(t.desc)}">${locked ? Acc.LOCK_SVG : ''}${esc(t.name)}</button>`;
    }).join('');
    $('#tplHint').textContent = unlocked ? 'Pick one, then edit freely' : 'Free plan: Recommended or your own text';
  }
  async function applyTemplate(id) {
    let t;
    if (id === 'default') t = { subject: DEFAULT_SUBJECT, body: DEFAULT_BODY };
    else {
      if (!Acc.can('templates')) { Acc.showLocked('templates'); return; }
      if (!tplCache) {
        try { tplCache = (await Acc.api('api/templates')).templates; } catch (e) {
          if (e.code === 'PLAN_REQUIRED') { if (e.data.user) Acc.setUser(e.data.user); Acc.showLocked('templates'); } else toast(e.message, 'err');
          return;
        }
      }
      t = tplCache.find((x) => x.id === id);
      if (!t) return;
    }
    const edited = state.compose.body.trim() && state.compose.body !== t.body;
    if (edited && state.compose.tpl !== id && !confirm('Replace your current subject and message with this template?')) return;
    Object.assign(state.compose, { subject: t.subject, body: t.body, tpl: id });
    persist.compose(); renderCompose();
    toast('Template applied. Edit anything you like.', 'ok');
  }
  $('#tplList').addEventListener('click', (e) => { const b = e.target.closest('.tpl'); if (b) applyTemplate(b.dataset.tpl); });

  function renderQuota() {
    const el = $('#quotaNote');
    if (!el) return;
    if (!Acc.signedIn()) { el.innerHTML = '<b>Sign in to send.</b> Free accounts get 10 emails every month. <button type="button" class="link-btn" data-auth="signup">Create a free account</button>'; return; }
    const u = Acc.usage();
    const tier = Acc.tierHtml(u.plan);
    if (u.unlimited) el.innerHTML = `${tier} Unlimited emails · from ${u.minGap}s gap`;
    else if (u.plan === 'free') el.innerHTML = `${tier} <b>${u.remaining}</b> of ${u.limit} free emails left this month · ${u.minGap}s gap <button type="button" class="link-btn" data-upgrade>Upgrade</button>`;
    else el.innerHTML = `${tier} <b>${Number(u.remaining).toLocaleString('en-IN')}</b> emails left in your pack · ${u.minGap}s gap <button type="button" class="link-btn" data-upgrade>Buy more</button>`;
  }
  function applyPlan() {
    renderDelayOptions(); renderTemplates(); renderQuota();
    const manualLocked = !Acc.can('manual');
    $$('[data-lock="manual"]').forEach((x) => { x.hidden = !manualLocked; });
    if (Acc.known && manualLocked && state.mode === 'manual') {
      state.mode = 'auto'; LS.set('mode', state.mode);
      renderProfile(); updateSteps(); renderPreview();
      toast('Manual entry is part of the paid plans, so we switched you to resume analysis. You can still edit everything.');
      ensureAnalysis();
    }
  }
  Acc.onChange(applyPlan);
  $('#prevRec').addEventListener('click', () => movePreview(-1));
  $('#nextRec').addEventListener('click', () => movePreview(1));
  function movePreview(d) {
    const n = state.recipients.length; if (!n) return;
    state.previewIndex = (state.previewIndex + d + n) % n; renderPreview();
  }

  const SAMPLE = { email: 'recruiter@example.com', name: 'Priya Nair', company: 'Acme Corp', role: '' };
  const DEFAULTS = () => ({ role: state.me.role || 'suitable', company: 'your organization', first_name: 'there', name: 'there' });
  function buildMessage(r) {
    const vars = M.recipientVars(r, state.me, { mode: state.mode });
    return {
      subject: M.renderTemplate(state.compose.subject, vars, DEFAULTS()).replace(/\s+/g, ' ').trim(),
      text: M.renderTemplate(state.compose.body, vars, DEFAULTS()),
    };
  }

  function renderCompose() {
    $('#subject').value = state.compose.subject;
    $('#body').value = state.compose.body;
    $('#attachResume').checked = !!state.compose.attach;
    $('#attachResume').disabled = !state.resume;
    $('#attachName').textContent = state.resume ? `(${state.resume.name})` : '(no resume uploaded)';
    renderDelayOptions(); renderTemplates(); renderQuota();
    renderPreview(); renderChecklist(); renderRunUI();
  }

  function renderPreview() {
    const n = state.recipients.length;
    if (state.previewIndex >= n) state.previewIndex = 0;
    const r = n ? state.recipients[state.previewIndex] : SAMPLE;
    $('#previewWho').textContent = n ? `${state.previewIndex + 1} / ${n}` : 'Sample';
    const m = buildMessage(r);
    const fromName = state.sender.fromName || state.me.name || 'You';
    $('#pvFrom').textContent = fromName;
    $('#pvAvatar').textContent = (fromName.trim()[0] || 'Y').toUpperCase();
    $('#pvTo').textContent = r.name ? `${r.name} <${r.email}>` : r.email;
    $('#pvSubject').textContent = m.subject || '(empty subject)';
    $('#pvBody').innerHTML = esc(m.text).replace(/\{\{[^}]*\}\}/g, (x) => `<span class="ph-miss">${x}</span>`) || '<span class="muted">(empty message)</span>';
    const attach = state.compose.attach && state.resume;
    $('#pvAttach').hidden = !attach;
    if (attach) { $('#pvAttachName').textContent = state.resume.name; $('#pvAttach .file-ico').textContent = extOf(state.resume.name).toUpperCase(); }

    const unknown = M.unknownPlaceholders(`${state.compose.subject}\n${state.compose.body}`);
    const warns = [];
    if (unknown.length) warns.push(`Unknown placeholder${unknown.length > 1 ? 's' : ''}: ${unknown.map((u) => `{{${u}}}`).join(', ')}. Use the buttons above to insert valid ones.`);
    if (/\{\{\s*intro/i.test(state.compose.body) && !state.me.intro.trim()) warns.push('Your message uses {{intro}} but your introduction is empty (step 2).');
    if (!/\{\{\s*intro/i.test(state.compose.body) && state.me.intro.trim()) warns.push('Your message doesn\'t include {{intro}}, so your introduction won\'t appear.');
    $('#phWarn').hidden = !warns.length;
    $('#phWarn').textContent = warns.join(' ');
  }

  function readiness() {
    const c = counts();
    return [
      { ok: isVerified(), text: isVerified() ? `Sender: ${state.sender.mode === 'server' ? 'server account' : senderAddress()}` : 'Sender not verified (step 1)' },
      { ok: !!state.resume && state.compose.attach, text: state.resume ? (state.compose.attach ? 'Resume attached' : 'Resume not attached') : 'No resume uploaded', soft: true },
      { ok: !!state.me.intro.trim(), text: state.me.intro.trim() ? 'Introduction ready' : 'Introduction missing (step 2)', soft: true },
      { ok: c.pending > 0, text: `${c.pending} recipient${c.pending === 1 ? '' : 's'} pending` },
      { ok: !!(state.compose.subject.trim() && state.compose.body.trim()), text: state.compose.subject.trim() && state.compose.body.trim() ? 'Subject & message ready' : 'Subject or message empty' },
    ];
  }
  function renderChecklist() {
    $('#checklist').innerHTML = readiness().map((i) => `<li class="${i.ok ? 'ok' : 'bad'}">${esc(i.text)}</li>`).join('');
  }

  function payloadFor(r, subjectPrefix) {
    const m = buildMessage(r);
    const p = { ...senderPayload(), to: r.email, subject: `${subjectPrefix || ''}${m.subject}`, text: m.text };
    if (state.compose.attach && state.resume) p.attachment = { filename: state.resume.name, contentType: state.resume.type, base64: state.resume.base64 };
    return p;
  }
  function precheck() {
    const hard = readiness().filter((i) => !i.ok && !i.soft && !/Sender/.test(i.text));
    if (hard.length) { toast(hard[0].text, 'err'); return false; }
    return true;
  }
  async function ensureSender() {
    if (isVerified()) return true;
    try { await verifySender(); return true; } catch (e) {
      toast(`Sender check failed: ${e.message}`, 'err', 7000);
      goto(1);
      return false;
    }
  }

  $('#testBtn').addEventListener('click', async () => {
    if (state.run.active) return;
    if (!state.compose.subject.trim() || !state.compose.body.trim()) return toast('Write a subject and message first.', 'err');
    const btn = $('#testBtn');
    if (!(await Acc.ensureSignedIn('Sign in to send a test email.'))) return;
    setLoading(btn, true);
    try {
      if (!(await ensureSender())) return;
      const sample = state.recipients[state.previewIndex] || SAMPLE;
      const res = await api('api/send', { ...payloadFor(sample), test: true }, 60000);
      toast(`Test email sent to ${res.to}. Check your inbox (and spam folder).`, 'ok', 6000);
    } catch (e) {
      if (e.code === 'AUTH_REQUIRED') Acc.setUser(null);
      toast(e.message, 'err', 7000);
    } finally {
      setLoading(btn, false);
    }
  });

  $('#startBtn').addEventListener('click', async () => {
    if (state.run.active || !precheck()) return;
    if (!(await Acc.ensureSignedIn('Sign in to start sending.'))) return;
    const u = Acc.usage();
    if (!u.unlimited && u.remaining <= 0) { Acc.showLocked('quota'); return; }
    const pending = pendingCount();
    const n = u.unlimited ? pending : Math.min(pending, u.remaining);
    if (n < pending && !confirm(`Your plan has ${u.remaining} email${u.remaining === 1 ? '' : 's'} left, so ${n} of your ${pending} recipients will get your email now. The rest stay pending until you upgrade.\n\nContinue?`)) return;
    const btn = $('#startBtn');
    setLoading(btn, true);
    const ok = await ensureSender();
    setLoading(btn, false);
    if (!ok) return;
    const from = state.sender.mode === 'server' ? 'the server account' : senderAddress();
    if (!confirm(`Send ${n} email${n === 1 ? '' : 's'} from ${from}?\n\nEach recipient gets a separate, personal email${state.compose.attach && state.resume ? ' with your resume attached' : ''}.`)) return;
    runCampaign(n);
  });
  $('#pauseBtn').addEventListener('click', () => {
    state.run.paused = !state.run.paused;
    renderRunUI();
    toast(state.run.paused ? 'Paused. Click Resume to continue.' : 'Resumed.');
  });
  $('#stopBtn').addEventListener('click', () => {
    state.run.stop = true; state.run.paused = false;
    renderRunUI();
    toast('Stopping after the current email…');
  });
  $('#retryBtn').addEventListener('click', () => {
    let n = 0;
    state.recipients.forEach((r) => { if (r.status === 'failed') { r.status = 'pending'; r.error = ''; n++; } });
    persist.recipients(); renderList(); renderCompose(); updateSteps();
    toast(`${n} failed email${n === 1 ? '' : 's'} moved back to pending. Click "Start sending".`);
  });
  $('#resetStatusBtn').addEventListener('click', () => {
    const sent = counts().sent;
    if (!confirm(`Mark all recipients as pending again?${sent ? `\n\nWarning: ${sent} people already received your email and would get it twice.` : ''}`)) return;
    state.recipients.forEach((r) => { r.status = 'pending'; r.error = ''; r.sentAt = null; });
    persist.recipients(); renderList(); renderCompose(); updateSteps();
  });
  $('#reportBtn').addEventListener('click', () => {
    const rows = [['email', 'name', 'company', 'role', 'status', 'error', 'sent_at']].concat(state.recipients.map((r) => [r.email, r.name, r.company, r.role, r.status, r.error, r.sentAt || '']));
    const blob = new Blob([`﻿${M.toCsv(rows)}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `resumail-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  function beforeUnload(e) { e.preventDefault(); e.returnValue = ''; }
  async function waitWhilePaused() { while (state.run.paused && !state.run.stop) await sleep(200); }
  async function interruptibleSleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end && !state.run.stop) {
      await sleep(Math.min(200, end - Date.now()));
      if (state.run.paused) await waitWhilePaused();
    }
  }
  async function sendWithRetry(r) {
    let gapWaits = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await api('api/send', payloadFor(r), 60000);
        if (res.usage) Acc.setUsage(res.usage);
        return { ok: true };
      } catch (e) {
        if (e.data && e.data.usage) Acc.setUsage(e.data.usage);
        if (e.code === 'GAP' && gapWaits++ < 5 && !state.run.stop) { // the server asks us to respect the plan's gap
          await interruptibleSleep((e.retryAfter || 5) * 1000 + 400);
          attempt--; continue;
        }
        const retryable = RETRYABLE.has(e.code) || (e.status >= 500 && !FATAL.has(e.code));
        if (!retryable || attempt === 2 || state.run.stop) return { ok: false, code: e.code, error: e.message };
        await interruptibleSleep(e.retryAfter ? e.retryAfter * 1000 : e.code === 'THROTTLED' ? 20000 : attempt ? 8000 : 3000);
        if (state.run.stop) return { ok: false, code: e.code, error: e.message };
      }
    }
    return { ok: false, code: 'UNKNOWN', error: 'Unknown error' };
  }

  async function runCampaign(limit) {
    const run = state.run;
    Object.assign(run, { active: true, paused: false, stop: false, durations: [] });
    window.addEventListener('beforeunload', beforeUnload);
    renderRunUI(); updateSteps();
    const queue = state.recipients.filter((r) => r.status === 'pending').slice(0, limit || Infinity);
    let sent = 0; let failed = 0; let streak = 0; let fatal = null;

    for (let i = 0; i < queue.length; i++) {
      if (run.stop) break;
      await waitWhilePaused();
      if (run.stop) break;
      const r = queue[i];
      if (!state.recipients.includes(r) || r.status !== 'pending') continue;

      r.status = 'sending'; renderList(); updateProgress();
      const t0 = performance.now();
      const res = await sendWithRetry(r);
      run.durations.push(performance.now() - t0);

      if (res.ok) {
        r.status = 'sent'; r.error = ''; r.sentAt = new Date().toISOString(); sent++; streak = 0;
      } else {
        if (res.code === 'QUOTA' || res.code === 'AUTH_REQUIRED' || res.code === 'BLOCKED') { r.status = 'pending'; r.error = ''; } else { r.status = 'failed'; r.error = res.error; failed++; }
        if (FATAL.has(res.code)) { fatal = res; run.stop = true; }
        else if (res.code === 'RECIPIENT') streak = 0;
        else if (++streak >= 3) { fatal = { error: `3 emails in a row failed (${res.error}). Sending stopped so you can check what's wrong.` }; run.stop = true; }
        if (res.code === 'AUTH') { state.sender.verifiedKey = ''; persist.sender(); }
      }
      persist.recipients(); renderList(); updateProgress(); updateSteps();
      if (i < queue.length - 1 && !run.stop) await interruptibleSleep(delayMs());
    }

    run.active = false; run.paused = false;
    window.removeEventListener('beforeunload', beforeUnload);
    renderRunUI(); renderChecklist(); updateSteps();
    if (fatal) toast(fatal.error, 'err', 9000);
    if (fatal && fatal.code === 'QUOTA') Acc.showLocked('quota');
    if (fatal && fatal.code === 'AUTH_REQUIRED') { Acc.setUser(null); Acc.openAuth('login', 'Your session ended. Sign in again to continue sending.'); }
    const left = pendingCount();
    toast(`Done: ${sent} sent${failed ? `, ${failed} failed` : ''}${left ? `, ${left} still pending` : ''}.`, failed && !sent ? 'err' : 'ok', 7000);
  }
  // Never shorter than the chosen gap (the server enforces the plan's minimum), plus a little jitter.
  const gapSeconds = () => Number($('#delay').value) || Math.max(Number(state.compose.delay) || 30, Acc.minGap());
  const delayMs = () => Math.max(gapSeconds(), Acc.minGap()) * 1000 * (1 + Math.random() * 0.2);

  function updateProgress() {
    const c = counts();
    const total = state.recipients.length || 1;
    const done = c.sent + c.failed;
    $('#progressBar').style.width = `${Math.max(2, Math.round((done / total) * 100))}%`;
    $('#progressText').innerHTML = `<b>${c.sent}</b> sent · <b>${c.failed}</b> failed · <b>${c.pending + c.sending}</b> remaining`;
    const d = state.run.durations;
    if (state.run.active && d.length) {
      const avg = d.reduce((a, b) => a + b, 0) / d.length + gapSeconds() * 1100;
      $('#etaText').textContent = `About ${fmtDuration(avg * (c.pending + c.sending))} left`;
    } else $('#etaText').textContent = '';
  }
  function renderRunUI() {
    const run = state.run; const c = counts();
    const anyDone = c.sent + c.failed > 0;
    $('.launch').classList.toggle('is-sending', run.active && !run.paused);
    $('#progressWrap').hidden = !(run.active || anyDone);
    $('#startBtn').hidden = run.active;
    $('#startBtn').textContent = c.pending ? `Start sending (${c.pending})` : 'Start sending';
    $('#startBtn').disabled = !c.pending;
    $('#testBtn').disabled = run.active;
    $('#pauseBtn').hidden = !run.active;
    $('#pauseBtn').textContent = run.paused ? 'Resume' : 'Pause';
    $('#stopBtn').hidden = !run.active;
    $('#stopBtn').disabled = run.stop;
    $('#retryBtn').hidden = run.active || !c.failed;
    $('#resetStatusBtn').hidden = run.active || !anyDone;
    $('#reportBtn').hidden = !anyDone;
    updateProgress();
  }

  /* ---------------- boot ---------------- */
  function revealOnScroll() {
    const items = $$('.feature');
    if (!('IntersectionObserver' in window)) return;
    items.forEach((el, i) => { el.classList.add('reveal'); el.style.transitionDelay = `${i * 80}ms`; });
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.15 });
    items.forEach((el) => io.observe(el));
  }

  async function boot() {
    $('#year').textContent = new Date().getFullYear();
    fillSenderForm(); fillMe(); renderResume(); renderProfile();
    renderList(); renderCompose(); updateSteps(); revealOnScroll(); applyPlan();
    try {
      const cfg = await Acc.ready;
      state.server = cfg;
      if (cfg.serverSender) { $('#senderModeSeg').hidden = false; $('#serverFrom').textContent = cfg.serverFrom || ''; }
      if (cfg.degraded) toast('Accounts are temporarily unavailable. Please try again in a minute.', 'err', 8000);
      applySenderMode(); updateSteps(); applyPlan();
    } catch (e) {
      toast('The ResuMail server is not reachable right now. Please check your connection and reload.', 'err', 9000);
    }
    if (isVerified()) {
      goto(state.me.intro.trim() ? (state.recipients.length ? 4 : 3) : 2, { scroll: false });
      $('#app').scrollIntoView();
    }
  }
  boot();
})();
