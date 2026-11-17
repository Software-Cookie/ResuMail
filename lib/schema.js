'use strict';
/**
 * Database schema. Every statement is idempotent, so running it twice is safe.
 * Bump VERSION when you add statements; the app migrates itself on first use.
 */
const VERSION = 1;

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'trial', 'standard', 'premium')),
    credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
    free_period TEXT NOT NULL DEFAULT '',
    free_used INTEGER NOT NULL DEFAULT 0,
    test_day TEXT NOT NULL DEFAULT '',
    test_used INTEGER NOT NULL DEFAULT 0,
    sent_total INTEGER NOT NULL DEFAULT 0,
    last_send_at TIMESTAMPTZ,
    plan_since TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id, created_at DESC)',
  `CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    hint TEXT NOT NULL,
    plan TEXT NOT NULL CHECK (plan IN ('trial', 'standard', 'premium')),
    percent_off INTEGER NOT NULL CHECK (percent_off BETWEEN 1 AND 100),
    max_uses INTEGER NOT NULL CHECK (max_uses > 0),
    uses INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL CHECK (plan IN ('trial', 'standard', 'premium')),
    list_amount INTEGER NOT NULL CHECK (list_amount >= 0),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    coupon_id INTEGER REFERENCES coupons(id) ON DELETE SET NULL,
    method TEXT NOT NULL CHECK (method IN ('upi', 'razorpay', 'coupon')),
    status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'submitted', 'paid', 'rejected')),
    utr TEXT UNIQUE,
    gateway_order_id TEXT UNIQUE,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ
  )`,
  'CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, created_at DESC)',
  `CREATE TABLE IF NOT EXISTS redemptions (
    coupon_id INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (coupon_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS sender_usage (
    sender_hash TEXT NOT NULL,
    period TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (sender_hash, period)
  )`,
  `CREATE TABLE IF NOT EXISTS throttle (
    key TEXT PRIMARY KEY,
    hits INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    blocked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  'CREATE INDEX IF NOT EXISTS throttle_updated_idx ON throttle (updated_at)',
  `CREATE TABLE IF NOT EXISTS reset_codes (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
  )`,
];

const MARKER = `resumail-schema:${VERSION}`;

module.exports = { VERSION, STATEMENTS, MARKER };
