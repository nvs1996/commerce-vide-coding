const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, '..', 'data.db'));

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type INTEGER NOT NULL DEFAULT 1,
  status INTEGER NOT NULL DEFAULT 1,
  expired_date TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  price REAL NOT NULL DEFAULT 0,
  image TEXT,
  license_id INTEGER
);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL UNIQUE,
  status INTEGER NOT NULL DEFAULT 1,
  percent REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  license_id INTEGER,
  status TEXT NOT NULL DEFAULT 'published',
  url TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- quotes = cart lines. customer_id/status/shipping_* are extras needed by the checkout flow.
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  sku TEXT,
  total_price REAL NOT NULL DEFAULT 0,
  coupon_id INTEGER,
  customer_id INTEGER,
  status INTEGER NOT NULL DEFAULT 0,   -- 0 = active cart, 1 = converted to order
  shipping_name TEXT,
  shipping_phone TEXT,
  shipping_address TEXT,
  shipping_city TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quote_id INTEGER,
  status INTEGER NOT NULL DEFAULT 0,   -- 0 = Pending, 1 = Complete, 2 = Cancelled
  total_price REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Licenses granted to customers after a successful order.
CREATE TABLE IF NOT EXISTS customer_licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  license_id INTEGER NOT NULL,
  order_id INTEGER,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (customer_id, license_id)
);
`);

// Migration: avatar (image path) columns were added after the first release.
for (const table of ['customers', 'users']) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'avatar')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN avatar TEXT`);
  }
}

// expired_date is date-only; trim any time part saved by earlier versions.
db.exec("UPDATE licenses SET expired_date = substr(expired_date, 1, 10) WHERE length(expired_date) > 10");

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}

function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 32);
  const real = Buffer.from(hash, 'hex');
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}

function seed() {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;

  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('admin', hashPassword('admin123'));
  db.prepare('INSERT INTO customers (name, username, password) VALUES (?, ?, ?)')
    .run('Demo Customer', 'demo', hashPassword('demo123'));

  const lic = db.prepare('INSERT INTO licenses (name, type, status, expired_date) VALUES (?, ?, 1, ?)');
  const basic = lic.run('Basic Plan', 1, '2030-12-31').lastInsertRowid;
  const pro = lic.run('Pro Plan', 2, '2030-12-31').lastInsertRowid;

  const prod = db.prepare('INSERT INTO products (name, sku, price, image, license_id) VALUES (?, ?, ?, ?, ?)');
  prod.run('Starter Course', 'COURSE-START', 29.0, '', basic);
  prod.run('Pro Course', 'COURSE-PRO', 99.0, '', pro);
  prod.run('E-book: Vibe Coding 101', 'EBOOK-VC101', 9.5, '', null);
  prod.run('Template Pack', 'TPL-PACK', 49.0, '', null);

  const post = db.prepare('INSERT INTO posts (title, body, license_id, status, url) VALUES (?, ?, ?, ?, ?)');
  post.run('Welcome (public)', 'This post has no license, so everyone can read it.', null, 'published', 'welcome');
  post.run('Basic Plan Guide', 'Exclusive content for Basic Plan license holders.\n\nStep 1 ...\nStep 2 ...', basic, 'published', 'basic-guide');
  post.run('Pro Plan Masterclass', 'Exclusive content for Pro Plan license holders.\n\nAdvanced tips ...', pro, 'published', 'pro-masterclass');

  const cp = db.prepare('INSERT INTO coupons (title, status, percent) VALUES (?, 1, ?)');
  cp.run('WELCOME10', 10);
  cp.run('SAVE20', 20);
}
seed();

module.exports = { db, hashPassword, verifyPassword };
