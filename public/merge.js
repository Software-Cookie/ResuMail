/*
 * ResuMail recipients parser + mail-merge templating. Browser + Node (for tests).
 */
(function (root) {
  'use strict';

  const EMAIL_G = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  const EMAIL_STRICT = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
  const FREE_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'rediffmail.com', 'zoho.com', 'zohomail.com', 'zohomail.in', 'gmx.com', 'mail.com', 'yandex.com', 'hey.com', 'fastmail.com']);
  const SUFFIXES = ['co.in', 'co.uk', 'com.au', 'co.jp', 'org.in', 'net.in', 'ac.in', 'edu.in', 'gov.in', 'com', 'in', 'io', 'ai', 'co', 'net', 'org', 'tech', 'dev', 'app', 'us', 'uk', 'biz', 'info', 'global', 'xyz', 'me', 'de', 'fr', 'sg', 'ae', 'ca', 'eu', 'cloud', 'solutions', 'software', 'digital'];

  const isEmail = (e) => typeof e === 'string' && e.length <= 254 && EMAIL_STRICT.test(e);
  const titleCase = (s) => s.toLowerCase().replace(/(^|[\s'.-])([a-z])/g, (m, p, c) => p + c.toUpperCase());

  function cleanName(s) {
    let n = String(s || '').replace(/["'<>]/g, '').replace(/\s+/g, ' ').trim();
    if (!n || n.length > 60 || /@|\d{3,}/.test(n)) return '';
    const lastFirst = n.match(/^([A-Za-z'.-]+),\s*([A-Za-z'. -]+)$/); // "Doe, Jane" -> "Jane Doe"
    if (lastFirst) n = `${lastFirst[2]} ${lastFirst[1]}`;
    if (n === n.toUpperCase() || n === n.toLowerCase()) n = titleCase(n);
    return n;
  }

  function guessCompany(email) {
    const domain = String(email).split('@')[1];
    if (!domain) return '';
    const d = domain.toLowerCase();
    if (FREE_DOMAINS.has(d)) return '';
    let base = d;
    for (const suf of SUFFIXES) { if (base.endsWith(`.${suf}`)) { base = base.slice(0, -(suf.length + 1)); break; } }
    const label = base.split('.').pop();
    if (!label || label.length < 2) return '';
    if (label.length <= 4) return label.toUpperCase();
    return label.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  /* --- delimited text (CSV / TSV / ; ) with quote support --- */
  function parseDelimited(text) {
    const src = String(text || '').replace(/\r\n?/g, '\n');
    const firstLine = src.split('\n').find((l) => l.trim()) || '';
    const delim = firstLine.includes('\t') ? '\t' : (firstLine.split(';').length > firstLine.split(',').length ? ';' : ',');
    const rows = [];
    let row = []; let cell = ''; let q = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (q) {
        if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
      } else if (ch === '"' && cell.trim() === '') { q = true; cell = ''; } else if (ch === delim) { row.push(cell.trim()); cell = ''; } else if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; } else cell += ch;
    }
    row.push(cell.trim()); rows.push(row);
    return rows.filter((r) => r.some((c) => c));
  }

  /* --- column detection --- */
  const COLS = {
    email: /^(e-?mail|email ?(id|address)|mail ?id|mail|e-mail address|contact email|hr email|recruiter email)$/i,
    first: /^(first ?name|given ?name|fname)$/i,
    last: /^(last ?name|surname|family ?name|lname)$/i,
    name: /^(name|full ?name|contact ?name|contact ?person|person|hr ?name|recruiter( name)?|hiring manager|poc|spoc|contact)$/i,
    company: /^(company|company ?name|organi[sz]ation|organi[sz]ation ?name|org|firm|employer|business|client|startup)$/i,
    role: /^(role|position|job ?title|title|designation|opening|job|job ?role|vacancy|post)$/i,
  };
  function detectHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const cells = rows[i].map((c) => String(c || '').trim());
      if (cells.some((c) => c.includes('@'))) continue;
      const map = {};
      cells.forEach((c, idx) => {
        for (const [k, re] of Object.entries(COLS)) if (map[k] === undefined && re.test(c)) { map[k] = idx; break; }
      });
      if (map.email !== undefined || (Object.keys(map).length >= 2)) return { index: i, map };
    }
    return null;
  }

  /**
   * Convert rows (array of arrays) into recipients.
   * Returns { recipients, invalid, duplicates }.
   */
  function rowsToRecipients(rows, existing) {
    const seen = new Set((existing || []).map((r) => r.email.toLowerCase()));
    const header = detectHeader(rows);
    const map = header ? header.map : {};
    const start = header ? header.index + 1 : 0;
    const out = []; let invalid = 0; let duplicates = 0;

    for (let i = start; i < rows.length; i++) {
      const cells = rows[i].map((c) => (c == null ? '' : String(c).trim()));
      if (!cells.some(Boolean)) continue;
      const emailSource = map.email !== undefined && cells[map.email] ? cells[map.email] : cells.join(' ');
      const emails = (emailSource.match(EMAIL_G) || []).map((e) => e.replace(/^[.'-]+|[.'-]+$/g, ''));
      if (!emails.length) { if (cells.join('').length > 2) invalid++; continue; }

      let name = '';
      if (map.name !== undefined) name = cells[map.name];
      else if (map.first !== undefined) name = `${cells[map.first] || ''} ${map.last !== undefined ? cells[map.last] || '' : ''}`;
      if (!name) {
        // "Jane Doe <jane@x.com>" or "Jane Doe - jane@x.com"
        const cellWithEmail = cells.find((c) => c.includes(emails[0])) || '';
        const before = cellWithEmail.split(emails[0])[0].replace(/[<(\[,;:\-–|]+\s*$/, '').trim();
        if (before && before.length <= 60) name = before;
      }
      if (!name && !header) {
        const textual = cells.filter((c) => c && !c.includes('@') && /^[A-Za-z][A-Za-z .'-]{1,58}$/.test(c));
        if (textual.length) name = textual[0];
      }
      let company = map.company !== undefined ? cells[map.company] : '';
      if (!company && !header) {
        const textual = cells.filter((c) => c && !c.includes('@') && c !== name && c.length <= 60);
        if (textual.length) company = textual[0];
      }
      const role = map.role !== undefined ? cells[map.role] : '';

      for (const raw of emails) {
        const email = raw.trim();
        if (!isEmail(email)) { invalid++; continue; }
        const key = email.toLowerCase();
        if (seen.has(key)) { duplicates++; continue; }
        seen.add(key);
        const guessed = !company ? guessCompany(email) : '';
        out.push({
          id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          email,
          name: cleanName(name),
          company: (company || guessed || '').slice(0, 80),
          companyGuessed: !company && !!guessed,
          role: (role || '').slice(0, 80),
          status: 'pending',
          error: '',
          sentAt: null,
        });
      }
    }
    return { recipients: out, invalid, duplicates };
  }

  /* --- mail merge --- */
  const KNOWN = ['name', 'first_name', 'company', 'role', 'intro', 'highlights', 'experience', 'my_name', 'my_email', 'my_phone', 'my_contact', 'my_links', 'my_location', 'my_notice', 'date'];
  const PH_RE = /\{\{\s*([a-zA-Z_]+)\s*(?:\|([^}]*))?\}\}/g;

  function renderTemplate(tpl, vars, defaults) {
    const dflt = defaults || {};
    const lines = String(tpl || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    for (const line of lines) {
      let used = false;
      const res = line.replace(PH_RE, (m, key, fb) => {
        const k = key.toLowerCase();
        if (!KNOWN.includes(k)) return m;
        used = true;
        const v = String(vars[k] == null ? '' : vars[k]).trim();
        if (v) return v;
        if (fb !== undefined) return fb.trim();
        return dflt[k] || '';
      });
      if (used && res.replace(/[\s,.:;|•\-–]/g, '') === '') continue; // drop lines that became empty
      out.push(res);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function unknownPlaceholders(tpl) {
    const bad = new Set();
    String(tpl || '').replace(PH_RE, (m, key) => { if (!KNOWN.includes(key.toLowerCase())) bad.add(key); return m; });
    return [...bad];
  }

  /* "Quick snapshot" block recruiters can scan in five seconds. */
  function buildHighlights(me) {
    const L = [];
    const exp = String(me.experience || '').trim();
    const cur = me.currentCompany ? `${me.currentTitle ? `${me.currentTitle} at ` : ''}${me.currentCompany}` : '';
    if (exp) L.push(`Experience: ${exp}${cur && !/fresher/i.test(exp) ? ` (currently ${cur})` : ''}`);
    if (me.skills && me.skills.length) L.push(`Core skills: ${me.skills.join(', ')}`);
    const edu = [me.degree, me.college].filter(Boolean).join(', ');
    if (edu) L.push(`Education: ${edu}`);
    if (me.achievement) L.push(`Key achievement: ${String(me.achievement).trim().replace(/\.$/, '')}`);
    if (me.certifications) L.push(`Certifications: ${me.certifications}`);
    const avail = [me.location && `Location: ${me.location}`, me.notice && `Notice period: ${me.notice}`].filter(Boolean).join('  ·  ');
    if (avail) L.push(avail);
    if (L.length < 2) return '';
    return `Quick snapshot:\n${L.map((l) => `• ${l}`).join('\n')}`;
  }

  function firstNameOf(name) {
    const parts = String(name || '').split(/\s+/).filter(Boolean);
    return parts.find((p) => p.replace(/\./g, '').length > 2 && !/\.$/.test(p)) || parts[0] || ''; // "K. Anitha" -> "Anitha"
  }

  function recipientVars(r, me, opts) {
    const name = (r && r.name) || '';
    const links = [me.linkedin, me.github, me.portfolio].filter(Boolean).join('\n');
    const manual = opts && opts.mode === 'manual';
    return {
      name,
      first_name: firstNameOf(name),
      company: (r && r.company) || '',
      role: (r && r.role) || me.role || '',
      intro: me.intro || '',
      highlights: manual ? '' : buildHighlights(me),
      experience: manual ? '' : (me.experience || ''),
      my_name: me.name || '',
      my_email: me.email || '',
      my_phone: me.phone || '',
      my_contact: [me.phone, me.email].filter(Boolean).join('  |  '),
      my_links: links,
      my_location: manual ? '' : (me.location || ''),
      my_notice: manual ? '' : (me.notice || ''),
      date: new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
    };
  }

  function toCsv(rows) {
    return rows.map((r) => r.map((c) => {
      const v = c == null ? '' : String(c);
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(',')).join('\n');
  }

  const api = { parseDelimited, rowsToRecipients, guessCompany, renderTemplate, unknownPlaceholders, recipientVars, buildHighlights, firstNameOf, isEmail, toCsv, KNOWN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Merge = api;
})(typeof self !== 'undefined' ? self : this);
