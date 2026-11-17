/* ResuMail admin panel. Needs an admin session (ADMIN_EMAILS) and the ADMIN_KEY. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NAMES = { free: 'Free', trial: 'Trial', standard: 'Standard', premium: 'Premium' };
  const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
  let key = '';
  try { key = sessionStorage.getItem('rm.adminKey') || ''; } catch (_) { /* ignore */ }

  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`; el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }

  async function api(path, body) {
    const res = await fetch(`api/admin/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: Object.assign({ 'X-Admin-Key': key }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw Object.assign(new Error(data.error || `Error ${res.status}`), { code: data.code, status: res.status });
    return data;
  }

  function lock(message) {
    key = '';
    try { sessionStorage.removeItem('rm.adminKey'); } catch (_) { /* ignore */ }
    $('#adminApp').hidden = true; $('#gate').hidden = false; $('#lockBtn').hidden = true;
    if (message) $('#keyMsg').textContent = message;
  }
  function handleAuthError(e) {
    if (e.status === 401 && e.code === 'AUTH_REQUIRED') { lock(''); $('#gateMsg').innerHTML = 'You are not signed in. <a href="./">Sign in on the main site</a> with your admin email, then come back.'; return true; }
    if (e.status === 404) { lock('This account is not an admin, or ADMIN_KEY is not configured on the server.'); return true; }
    if (e.code === 'ADMIN_KEY' || e.code === 'LOCKED') { lock(e.message); return true; }
    return false;
  }

  async function unlock() {
    try {
      const d = await api('overview');
      $('#gate').hidden = true; $('#adminApp').hidden = false; $('#lockBtn').hidden = false; $('#keyMsg').textContent = '';
      try { sessionStorage.setItem('rm.adminKey', key); } catch (_) { /* ignore */ }
      renderStats(d);
      loadOrders();
    } catch (e) { if (!handleAuthError(e)) $('#keyMsg').textContent = e.message; }
  }
  $('#keyForm').addEventListener('submit', (e) => { e.preventDefault(); key = $('#adminKey').value; $('#adminKey').value = ''; unlock(); });
  $('#lockBtn').addEventListener('click', () => lock(''));

  function renderStats(d) {
    const s = [
      ['Users', d.users.users], ['Premium', d.users.premium], ['Standard', d.users.standard], ['Trial', d.users.trial],
      ['To verify', d.orders.pending], ['Revenue', `₹${Number(d.orders.revenue).toLocaleString('en-IN')}`], ['Emails sent', Number(d.users.sent).toLocaleString('en-IN')],
    ];
    $('#stats').innerHTML = s.map(([k, v]) => `<div class="stat"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('');
  }
  const refreshStats = () => api('overview').then(renderStats).catch(() => {});

  $$('#tabs .seg-btn').forEach((b) => b.addEventListener('click', () => {
    $$('#tabs .seg-btn').forEach((x) => x.classList.toggle('is-on', x === b));
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.tab; });
    if (b.dataset.tab === 'payments') loadOrders();
    if (b.dataset.tab === 'coupons') loadCoupons();
  }));

  /* ---- payments ---- */
  let orders = [];
  async function loadOrders() {
    try {
      orders = (await api(`orders?status=${encodeURIComponent($('#orderStatus').value)}`)).orders;
      $('#orderRows').innerHTML = orders.length ? orders.map((o) => `<tr>
        <td><code>${esc(o.id)}</code></td>
        <td title="${esc(o.name)}">${esc(o.email)}</td>
        <td>${esc(NAMES[o.plan])}</td>
        <td><b>₹${esc(o.amount)}</b>${o.amount !== o.list_amount ? ` <small class="muted">(of ₹${esc(o.list_amount)})</small>` : ''}</td>
        <td>${o.utr ? `<code>${esc(o.utr)}</code>` : esc(o.method)}</td>
        <td>${esc(when(o.created_at))}</td>
        <td>${esc(o.status)}${o.note ? `<br><small class="muted">${esc(o.note)}</small>` : ''}</td>
        <td>${['submitted', 'created'].includes(o.status) ? `<button class="btn btn-primary btn-sm" data-approve="${esc(o.id)}">Approve</button> <button class="btn btn-ghost btn-sm danger" data-reject="${esc(o.id)}">Reject</button>` : ''}</td>
      </tr>`).join('') : '<tr><td colspan="8" class="muted">Nothing here.</td></tr>';
    } catch (e) { if (!handleAuthError(e)) toast(e.message, 'err'); }
  }
  $('#orderStatus').addEventListener('change', loadOrders);
  $('#orderRows').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-approve]'); const r = e.target.closest('[data-reject]');
    const id = (a || r) && (a || r).dataset[a ? 'approve' : 'reject'];
    if (!id) return;
    const o = orders.find((x) => x.id === id);
    try {
      if (a) {
        if (!confirm(`Approve ${o.id}?\n\n₹${o.amount} for ${NAMES[o.plan]} from ${o.email}\nUTR: ${o.utr || '(none)'}\n\nOnly approve after you see this payment in your bank app.`)) return;
        await api('orders/approve', { id });
        toast(`${o.email} is now on ${NAMES[o.plan]}.`, 'ok');
      } else {
        const note = prompt('Reason shown to the user:', 'Payment not found. Please check the UTR and amount.');
        if (note === null) return;
        await api('orders/reject', { id, note });
        toast('Order rejected.');
      }
      loadOrders(); refreshStats();
    } catch (err) { if (!handleAuthError(err)) toast(err.message, 'err'); }
  });

  /* ---- coupons ---- */
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  $('#genCode').addEventListener('click', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    $('#cCode').value = Array.from(bytes, (b) => ALPHABET[b & 31]).join('');
  });
  async function loadCoupons() {
    try {
      const { coupons } = await api('coupons');
      $('#couponRows').innerHTML = coupons.length ? coupons.map((c) => `<tr>
        <td><code>${esc(c.hint)}</code></td><td>${esc(NAMES[c.plan])}</td><td>${esc(c.percent_off)}%</td>
        <td>${esc(c.uses)} / ${esc(c.max_uses)}</td><td>${c.expires_at ? esc(new Date(c.expires_at).toLocaleDateString('en-IN')) : 'Never'}</td>
        <td>${c.active ? '<span class="st st-sent">Active</span>' : '<span class="st st-pending">Off</span>'}</td>
        <td><button class="btn btn-ghost btn-sm" data-toggle="${esc(c.id)}" data-active="${c.active ? '0' : '1'}">${c.active ? 'Turn off' : 'Turn on'}</button></td>
      </tr>`).join('') : '<tr><td colspan="7" class="muted">No coupons yet.</td></tr>';
    } catch (e) { if (!handleAuthError(e)) toast(e.message, 'err'); }
  }
  $('#couponForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#couponMsg');
    const code = $('#cCode').value.trim();
    try {
      await api('coupons', {
        code, plan: $('#cPlan').value, percentOff: Number($('#cPct').value), maxUses: Number($('#cMax').value),
        expiresAt: $('#cExp').value ? `${$('#cExp').value}T23:59:59+05:30` : null,
      });
      msg.className = 'inline-msg ok';
      msg.textContent = `Created. The code is ${code.toUpperCase()}. Copy it now: only a hash is stored.`;
      $('#cCode').value = '';
      loadCoupons();
    } catch (err) { if (!handleAuthError(err)) { msg.className = 'inline-msg err'; msg.textContent = err.message; } }
  });
  $('#couponRows').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-toggle]'); if (!b) return;
    try { await api('coupons/toggle', { id: Number(b.dataset.toggle), active: b.dataset.active === '1' }); loadCoupons(); } catch (err) { if (!handleAuthError(err)) toast(err.message, 'err'); }
  });

  /* ---- users ---- */
  $('#userSearch').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { users } = await api(`users?q=${encodeURIComponent($('#userQ').value.trim())}`);
      $('#userRows').innerHTML = users.length ? users.map((u) => `<tr>
        <td>${esc(u.email)}</td><td>${esc(u.name)}</td><td>${esc(NAMES[u.plan])}</td><td>${esc(u.credits)}</td><td>${esc(u.sent_total)}</td>
        <td>${esc(new Date(u.created_at).toLocaleDateString('en-IN'))}</td>
        <td class="set-plan"><select data-plan-for="${esc(u.id)}">${Object.keys(NAMES).map((p) => `<option value="${p}"${p === u.plan ? ' selected' : ''}>${NAMES[p]}</option>`).join('')}</select>
          <input type="number" min="0" value="${esc(u.credits)}" data-credits-for="${esc(u.id)}" aria-label="Credits">
          <button class="btn btn-secondary btn-sm" data-save="${esc(u.id)}">Save</button></td>
      </tr>`).join('') : '<tr><td colspan="7" class="muted">No users found.</td></tr>';
    } catch (err) { if (!handleAuthError(err)) toast(err.message, 'err'); }
  });
  $('#userRows').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-save]'); if (!b) return;
    const id = b.dataset.save;
    const plan = document.querySelector(`[data-plan-for="${id}"]`).value;
    const credits = Number(document.querySelector(`[data-credits-for="${id}"]`).value);
    if (!confirm(`Set this user to ${NAMES[plan]} with ${credits} credits?`)) return;
    try { await api('users/plan', { userId: Number(id), plan, credits }); toast('User updated.', 'ok'); refreshStats(); } catch (err) { if (!handleAuthError(err)) toast(err.message, 'err'); }
  });

  if (key) unlock();
})();
