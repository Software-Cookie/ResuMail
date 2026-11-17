'use strict';
/** Plan catalogue. The single source of truth for prices, limits and features. */

const PLANS = {
  free: {
    id: 'free', name: 'Free', price: 0, credits: 0, monthly: 10, minGap: 30,
    templates: false, manual: false, lifetime: false, unlimited: false,
  },
  trial: {
    id: 'trial', name: 'Trial', price: 29, credits: 100, minGap: 10,
    templates: true, manual: true, lifetime: false, unlimited: false,
  },
  standard: {
    id: 'standard', name: 'Standard', price: 99, credits: 1000, minGap: 5,
    templates: true, manual: true, lifetime: false, unlimited: false, recommended: true,
  },
  premium: {
    id: 'premium', name: 'Premium', price: 299, credits: 0, minGap: 2,
    templates: true, manual: true, lifetime: true, unlimited: true,
  },
};
const ORDER = ['free', 'trial', 'standard', 'premium'];
const PAID = ['trial', 'standard', 'premium'];
const GAP_CHOICES = [2, 3, 5, 10, 15, 20, 30, 45, 60, 90];
const TEST_PER_DAY = 10;

/** Which plan's rules apply right now. Packs fall back to Free once their credits run out. */
function effectivePlan(u) {
  if (!u) return 'free';
  if (u.plan === 'premium') return 'premium';
  if ((u.plan === 'trial' || u.plan === 'standard') && u.credits > 0) return u.plan;
  return 'free';
}

// Quotas reset on Indian calendar months/days (UTC+5:30).
const IST_MS = 5.5 * 3600 * 1000;
const monthKey = (d = new Date()) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 7);
const dayKey = (d = new Date()) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
function nextMonthStart(d = new Date()) {
  const ist = new Date(d.getTime() + IST_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1) - IST_MS).toISOString();
}

/** Usage summary sent to the browser. */
function usage(u) {
  const id = effectivePlan(u);
  const p = PLANS[id];
  const out = {
    plan: id, name: p.name, minGap: p.minGap, templates: p.templates, manual: p.manual,
    unlimited: p.unlimited, lifetime: p.lifetime, sentTotal: u ? u.sent_total : 0,
  };
  if (id === 'free') {
    const used = u && u.free_period === monthKey() ? u.free_used : 0;
    Object.assign(out, { limit: p.monthly, used, remaining: Math.max(0, p.monthly - used), resetsAt: nextMonthStart() });
  } else if (!p.unlimited) {
    Object.assign(out, { remaining: u.credits, limit: null });
  } else {
    out.remaining = null;
  }
  if (u && id === 'free' && u.plan !== 'free') out.expiredPack = u.plan; // pack used up
  return out;
}

const publicPlans = () => ORDER.map((id) => {
  const p = PLANS[id];
  return {
    id, name: p.name, price: p.price, credits: p.credits, monthly: p.monthly || 0, minGap: p.minGap,
    templates: p.templates, manual: p.manual, lifetime: p.lifetime, unlimited: p.unlimited, recommended: !!p.recommended,
  };
});

/**
 * SQL expression for the plan a user ends up on after buying `$n`: never downgrade a plan that
 * still has credits, Premium always wins.
 */
const upgradeSql = (n) => `CASE
  WHEN users.plan = 'premium' OR $${n}::text = 'premium' THEN 'premium'
  WHEN array_position(ARRAY['free','trial','standard','premium'], $${n}::text) >=
       array_position(ARRAY['free','trial','standard','premium'],
         CASE WHEN users.plan IN ('trial', 'standard') AND users.credits > 0 THEN users.plan ELSE 'free' END)
    THEN $${n}::text
  ELSE users.plan END`;

module.exports = { PLANS, ORDER, PAID, GAP_CHOICES, TEST_PER_DAY, effectivePlan, monthKey, dayKey, nextMonthStart, usage, publicPlans, upgradeSql };
