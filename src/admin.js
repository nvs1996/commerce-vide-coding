const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { db, hashPassword, verifyPassword } = require('./db');
const { isLicenseValid } = require('./license');

const router = express.Router();

// ---------- image uploads ----------
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + IMAGE_EXT[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (Object.hasOwn(IMAGE_EXT, file.mimetype)
    ? cb(null, true)
    : cb(new Error('Only JPG, PNG, GIF or WebP images are allowed.'))),
});

// Only touch files we uploaded ourselves (external URLs are left alone).
function removeUploaded(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return;
  fs.unlink(path.join(UPLOAD_DIR, path.basename(url)), () => {});
}

// Wraps multer so that size/type errors become a form error instead of a crash.
function handleUpload(req, res, next) {
  upload.any()(req, res, (err) => {
    if (!err) return next();
    req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5 MB or smaller.' : err.message;
    next();
  });
}

const LICENSE_TYPES = [[1, 'Personal'], [2, 'Business'], [3, 'Enterprise']];
const ORDER_STATUS = [[0, 'Pending'], [1, 'Complete'], [2, 'Cancelled']];
const YES_NO = [[1, 'Active'], [0, 'Inactive']];
const POST_STATUS = [['published', 'Published'], ['draft', 'Draft']];

const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Field types: text | number | textarea | password | datetime | enum (options) | ref (FK to another resource)
const RESOURCES = {
  users: {
    label: 'Users', icon: 'bi-person-gear', table: 'users',
    fields: [
      { name: 'avatar', label: 'Avatar', type: 'image' },
      { name: 'username', label: 'Username', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true, list: false },
    ],
  },
  customers: {
    label: 'Customers', icon: 'bi-people', table: 'customers',
    fields: [
      { name: 'avatar', label: 'Avatar', type: 'image' },
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'username', label: 'Username', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true, list: false },
    ],
  },
  products: {
    label: 'Products', icon: 'bi-box-seam', table: 'products',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'sku', label: 'SKU', type: 'text', required: true },
      { name: 'price', label: 'Price', type: 'number', required: true },
      { name: 'image', label: 'Image', type: 'image' },
      { name: 'license_id', label: 'License (granted on purchase)', type: 'ref', ref: 'licenses', validLicenseOnly: true },
    ],
  },
  licenses: {
    label: 'Licenses', icon: 'bi-key', table: 'licenses',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'type', label: 'Type', type: 'enum', options: LICENSE_TYPES },
      { name: 'status', label: 'Status', type: 'enum', options: YES_NO },
      { name: 'expired_date', label: 'Expired date', type: 'date' },
    ],
  },
  customer_licenses: {
    label: 'Granted Licenses', icon: 'bi-patch-check', table: 'customer_licenses',
    fields: [
      { name: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', required: true },
      { name: 'license_id', label: 'License', type: 'ref', ref: 'licenses', required: true },
      { name: 'order_id', label: 'Order', type: 'ref', ref: 'orders' },
      { name: 'granted_at', label: 'Granted at', type: 'datetime', readonlyOnCreate: true },
    ],
  },
  posts: {
    label: 'Posts', icon: 'bi-file-earmark-text', table: 'posts',
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'body', label: 'Body', type: 'textarea', list: false },
      { name: 'license_id', label: 'Required license (empty = public)', type: 'ref', ref: 'licenses', validLicenseOnly: true },
      { name: 'status', label: 'Status', type: 'enum', options: POST_STATUS },
      { name: 'url', label: 'URL slug (auto from title if empty)', type: 'text' },
    ],
    before(data) { if (!data.url) data.url = slugify(data.title); },
  },
  quotes: {
    label: 'Quotes', icon: 'bi-cart', table: 'quotes',
    fields: [
      { name: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers' },
      { name: 'product_id', label: 'Product', type: 'ref', ref: 'products', required: true },
      { name: 'sku', label: 'SKU', type: 'text' },
      { name: 'total_price', label: 'Total price', type: 'number', required: true },
      { name: 'coupon_id', label: 'Coupon', type: 'ref', ref: 'coupons' },
      { name: 'status', label: 'Status', type: 'enum', options: [[0, 'Active cart'], [1, 'Converted']] },
    ],
  },
  orders: {
    label: 'Orders', icon: 'bi-receipt', table: 'orders',
    fields: [
      { name: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', required: true },
      { name: 'product_id', label: 'Product', type: 'ref', ref: 'products', required: true },
      { name: 'quote_id', label: 'Quote', type: 'ref', ref: 'quotes' },
      { name: 'total_price', label: 'Total price', type: 'number' },
      { name: 'status', label: 'Status', type: 'enum', options: ORDER_STATUS },
    ],
  },
  coupons: {
    label: 'Coupons', icon: 'bi-ticket-perforated', table: 'coupons',
    fields: [
      { name: 'title', label: 'Code / Title', type: 'text', required: true },
      { name: 'percent', label: 'Discount (%)', type: 'number', required: true },
      { name: 'status', label: 'Status', type: 'enum', options: YES_NO },
    ],
  },
};

// How to show a row of a table when it is referenced by another table.
const REF_LABEL = {
  licenses: (r) => `${r.name} (#${r.id})`,
  products: (r) => `${r.name} [${r.sku}]`,
  customers: (r) => `${r.name} (${r.username})`,
  coupons: (r) => `${r.title} (${r.percent}%)`,
  quotes: (r) => `Quote #${r.id} – ${r.sku || ''}`,
  orders: (r) => `Order #${r.id}`,
};

function refOptions(table) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all()
    .map((r) => ({ value: r.id, label: REF_LABEL[table](r) }));
}

// Only active, non-expired licenses can be picked. The record's current license is kept
// in the list (flagged) so editing other fields doesn't silently drop it.
function validLicenseOptions(currentId) {
  return db.prepare('SELECT * FROM licenses ORDER BY id DESC').all()
    .filter((l) => isLicenseValid(l) || (currentId != null && l.id === Number(currentId)))
    .map((l) => ({
      value: l.id,
      label: REF_LABEL.licenses(l) + (isLicenseValid(l) ? '' : ' – inactive/expired (current)'),
    }));
}

// currentRow given => building a form (restrict selectable licenses); omitted => listing (all labels).
function optionsFor(res, currentRow) {
  const out = {};
  for (const f of res.fields) {
    if (f.type === 'ref') {
      out[f.name] = f.validLicenseOnly && currentRow !== undefined
        ? validLicenseOptions(currentRow[f.name])
        : refOptions(f.ref);
    }
    if (f.type === 'enum') out[f.name] = f.options.map(([value, label]) => ({ value, label }));
  }
  return out;
}

// ---------- auth ----------
router.get('/login', (req, res) => res.render('admin/login', { title: 'Admin login' }));

router.post('/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.body.username || ''));
  if (u && verifyPassword(String(req.body.password || ''), u.password)) {
    req.session.admin = { id: u.id, username: u.username };
    return res.redirect('/admin');
  }
  req.session.flash = { type: 'danger', msg: 'Invalid username or password.' };
  res.redirect('/admin/login');
});

router.post('/logout', (req, res) => { delete req.session.admin; res.redirect('/admin/login'); });

router.use((req, res, next) => {
  if (!req.session.admin) return res.redirect('/admin/login');
  res.locals.resources = RESOURCES;
  next();
});

// ---------- dashboard ----------
router.get('/', (req, res) => {
  const counts = Object.entries(RESOURCES).map(([key, r]) => ({
    key, label: r.label, icon: r.icon,
    n: db.prepare(`SELECT COUNT(*) AS n FROM ${r.table}`).get().n,
  }));
  res.render('admin/dashboard', { title: 'Dashboard', active: 'dashboard', counts });
});

// ---------- generic CRUD ----------
router.param('res', (req, res, next, key) => {
  if (!Object.hasOwn(RESOURCES, key)) return next('router');
  req.key = key;
  req.resource = RESOURCES[key];
  next();
});

const PER_PAGE_OPTIONS = [10, 25, 50, 100];

// Keep only the pagination params, so redirects can't carry arbitrary query strings.
function pagingQuery(source) {
  const p = new URLSearchParams();
  const page = parseInt(source.page, 10);
  const perPage = parseInt(source.per_page, 10);
  if (page > 1) p.set('page', page);
  if (PER_PAGE_OPTIONS.includes(perPage) && perPage !== 10) p.set('per_page', perPage);
  const s = p.toString();
  return s ? `?${s}` : '';
}

router.get('/:res', (req, res) => {
  const r = req.resource;
  const requested = parseInt(req.query.per_page, 10);
  const perPage = PER_PAGE_OPTIONS.includes(requested) ? requested : 10;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM ${r.table}`).get().n;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), pages);
  const rows = db.prepare(`SELECT * FROM ${r.table} ORDER BY id DESC LIMIT ? OFFSET ?`).all(perPage, (page - 1) * perPage);
  const paging = {
    page, pages, perPage, total, options: PER_PAGE_OPTIONS,
    from: total ? (page - 1) * perPage + 1 : 0, to: Math.min(page * perPage, total),
    query: pagingQuery({ page, per_page: perPage }),
  };
  const opts = optionsFor(r);
  const labelOf = (f, v) => {
    if (v === null || v === undefined || v === '') return '';
    const hit = (opts[f.name] || []).find((o) => String(o.value) === String(v));
    return hit ? hit.label : v;
  };
  res.render('admin/list', {
    title: r.label, active: req.key, key: req.key, r, rows, paging,
    columns: r.fields.filter((f) => f.list !== false), labelOf,
  });
});

router.get('/:res/new', (req, res) => {
  res.render('admin/form', {
    title: `New – ${req.resource.label}`, active: req.key, key: req.key, r: req.resource,
    row: {}, isNew: true, opts: optionsFor(req.resource, {}),
  });
});

router.get('/:res/:id/edit', (req, res, next) => {
  const row = db.prepare(`SELECT * FROM ${req.resource.table} WHERE id = ?`).get(Number(req.params.id));
  if (!row) return next('router');
  res.render('admin/form', {
    title: `Edit – ${req.resource.label}`, active: req.key, key: req.key, r: req.resource,
    row, isNew: false, opts: optionsFor(req.resource, row),
  });
});

function readBody(resource, req, isNew) {
  const body = req.body || {};
  const data = {};
  const errors = [];
  if (req.uploadError) errors.push(req.uploadError);
  for (const f of resource.fields) {
    if (f.readonlyOnCreate && isNew) continue;
    if (f.type === 'image') {
      const file = (req.files || []).find((x) => x.fieldname === `${f.name}_file`);
      if (file) data[f.name] = `/uploads/${file.filename}`;
      else if (body[`remove_${f.name}`]) data[f.name] = null;
      else data[f.name] = String(body[f.name] || '').trim() || null;   // keep current value
      continue;
    }
    let v = body[f.name];
    v = v === undefined ? '' : String(v).trim();
    if (f.type === 'password') {
      if (v === '') { if (isNew && f.required) errors.push(`${f.label} is required.`); continue; }
      data[f.name] = hashPassword(v);
      continue;
    }
    if (f.required && v === '') { errors.push(`${f.label} is required.`); continue; }
    if (f.type === 'number') {
      if (v === '') { data[f.name] = null; continue; }
      if (Number.isNaN(Number(v))) { errors.push(`${f.label} must be a number.`); continue; }
      data[f.name] = Number(v);
    } else if (f.type === 'ref') {
      data[f.name] = v === '' ? null : Number(v);
    } else if (f.type === 'enum') {
      const isNum = typeof f.options[0][0] === 'number';
      data[f.name] = isNum ? Number(v) : v;
    } else {
      data[f.name] = v === '' ? null : v;
    }
  }
  if (resource.before) resource.before(data);
  return { data, errors };
}

function save(req, res, isNew) {
  const r = req.resource;
  const { data, errors } = readBody(r, req, isNew);
  const newFiles = (req.files || []).map((x) => `/uploads/${x.filename}`);
  const old = isNew ? null : db.prepare(`SELECT * FROM ${r.table} WHERE id = ?`).get(Number(req.params.id));

  // Licenses picked on posts/products must be active and unexpired. Keeping the record's
  // existing license unchanged is allowed, so other fields can still be edited.
  for (const f of r.fields.filter((x) => x.validLicenseOnly)) {
    const id = data[f.name];
    if (id == null || (old && old[f.name] === id)) continue;
    const lic = db.prepare('SELECT * FROM licenses WHERE id = ?').get(id);
    if (!isLicenseValid(lic)) errors.push(`${f.label}: the selected license is missing, inactive or expired.`);
  }

  const back = () => {
    newFiles.forEach(removeUploaded);   // don't keep files from a failed save
    const row = { ...req.body, id: req.params.id };
    // Offer the stored license (not the rejected submission) as the only "current" exception.
    const stored = old || {};
    r.fields.filter((x) => x.validLicenseOnly).forEach((x) => { row[x.name] = stored[x.name] ?? ''; });
    res.render('admin/form', {
      title: `${isNew ? 'New' : 'Edit'} – ${r.label}`, active: req.key, key: req.key, r,
      row, isNew, opts: optionsFor(r, stored),
      flash: { type: 'danger', msg: errors.join(' ') },
    });
  };
  if (errors.length) return back();

  const imageFields = r.fields.filter((f) => f.type === 'image');

  try {
    const cols = Object.keys(data);
    if (isNew) {
      db.prepare(`INSERT INTO ${r.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
        .run(...cols.map((c) => data[c]));
    } else {
      db.prepare(`UPDATE ${r.table} SET ${cols.map((c) => `${c} = ?`).join(',')} WHERE id = ?`)
        .run(...cols.map((c) => data[c]), Number(req.params.id));
    }
  } catch (e) {
    errors.push(/UNIQUE/i.test(e.message) ? 'A record with the same unique value already exists.' : e.message);
    return back();
  }
  if (old) imageFields.forEach((f) => { if (old[f.name] && old[f.name] !== data[f.name]) removeUploaded(old[f.name]); });
  req.session.flash = { type: 'success', msg: `${r.label} saved.` };
  res.redirect(`/admin/${req.key}`);
}

router.post('/:res', handleUpload, (req, res) => save(req, res, true));
router.post('/:res/:id', handleUpload, (req, res) => save(req, res, false));

router.post('/:res/:id/delete', (req, res) => {
  const row = db.prepare(`SELECT * FROM ${req.resource.table} WHERE id = ?`).get(Number(req.params.id));
  if (row) req.resource.fields.filter((f) => f.type === 'image').forEach((f) => removeUploaded(row[f.name]));
  db.prepare(`DELETE FROM ${req.resource.table} WHERE id = ?`).run(Number(req.params.id));
  req.session.flash = { type: 'success', msg: 'Deleted.' };
  res.redirect(`/admin/${req.key}${pagingQuery(req.body || {})}`);   // stay on the same page (clamped by the list)
});

module.exports = router;
