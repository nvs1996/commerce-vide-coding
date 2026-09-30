const express = require('express');
const { db, hashPassword, verifyPassword } = require('./db');
const { isLicenseValid } = require('./license');

const router = express.Router();

const ORDER_COMPLETE = 1;
const ORDER_STATUS_LABEL = { 0: 'Pending', 1: 'Complete', 2: 'Cancelled' };
const LICENSE_TYPE_LABEL = { 1: 'Personal', 2: 'Business', 3: 'Enterprise' };

const round2 = (n) => Math.round(n * 100) / 100;
const message = (res, status, o) => res.status(status).render('shop/message', o);

function requireLogin(req, res, next) {
  if (req.session.customer) return next();
  req.session.flash = { type: 'warning', msg: 'Please log in to continue.' };
  req.session.next = req.method === 'GET' ? req.originalUrl
    : (req.body && req.body.product_id ? `/product/${Number(req.body.product_id)}` : '/cart');
  res.redirect('/login');
}

// ---------- products ----------
const PRODUCT_SELECT = `SELECT p.*, l.name AS license_name FROM products p LEFT JOIN licenses l ON l.id = p.license_id`;

router.get('/', (req, res) => {
  const products = db.prepare(`${PRODUCT_SELECT} ORDER BY p.id`).all();
  res.render('shop/home', { title: 'All products', products, heading: 'All products' });
});

router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const products = q
    ? db.prepare(`${PRODUCT_SELECT} WHERE p.name LIKE ? OR p.sku LIKE ? ORDER BY p.id`).all(like, like)
    : [];
  res.locals.q = q;
  res.render('shop/home', { title: `Search: ${q}`, products, heading: q ? `Search results for “${q}”` : 'Type a product name or SKU' });
});

router.get('/product/:id', (req, res) => {
  const product = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(Number(req.params.id));
  if (!product) return message(res, 404, { title: 'Not found', icon: 'bi-box', heading: 'Product not found', text: '' });
  const inCart = req.session.customer
    ? !!db.prepare('SELECT 1 FROM quotes WHERE customer_id = ? AND product_id = ? AND status = 0').get(req.session.customer.id, product.id)
    : false;
  res.render('shop/product', { title: product.name, product, inCart });
});

// ---------- auth ----------
router.get('/login', (req, res) => res.render('shop/login', { title: 'Login' }));

router.post('/login', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE username = ?').get(String(req.body.username || ''));
  if (!c || !verifyPassword(String(req.body.password || ''), c.password)) {
    req.session.flash = { type: 'danger', msg: 'Invalid username or password.' };
    return res.redirect('/login');
  }
  const next = req.session.next || '/account';
  delete req.session.next;
  req.session.customer = { id: c.id, name: c.name, username: c.username };
  res.redirect(next);
});

router.get('/register', (req, res) => res.render('shop/register', { title: 'Register' }));

router.post('/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!name || !username || password.length < 4) {
    req.session.flash = { type: 'danger', msg: 'Name, username and a password of at least 4 characters are required.' };
    return res.redirect('/register');
  }
  try {
    const id = db.prepare('INSERT INTO customers (name, username, password) VALUES (?, ?, ?)')
      .run(name, username, hashPassword(password)).lastInsertRowid;
    req.session.customer = { id: Number(id), name, username };
    res.redirect('/account');
  } catch {
    req.session.flash = { type: 'danger', msg: 'That username is already taken.' };
    res.redirect('/register');
  }
});

router.post('/logout', (req, res) => {
  delete req.session.customer;
  delete req.session.address;
  delete req.session.couponId;
  res.redirect('/');
});

// ---------- my account ----------
router.get('/account', requireLogin, (req, res) => {
  const cid = req.session.customer.id;
  const me = db.prepare('SELECT id, name, username FROM customers WHERE id = ?').get(cid);
  const orders = db.prepare(`
    SELECT o.*, p.name AS product_name, p.sku FROM orders o
    LEFT JOIN products p ON p.id = o.product_id
    WHERE o.customer_id = ? ORDER BY o.id DESC`).all(cid);
  const licenses = db.prepare(`
    SELECT cl.granted_at, l.* FROM customer_licenses cl
    JOIN licenses l ON l.id = cl.license_id
    WHERE cl.customer_id = ? ORDER BY cl.id DESC`).all(cid);
  const posts = db.prepare(`
    SELECT p.title, p.url FROM posts p
    WHERE p.status = 'published' AND p.license_id IN (SELECT license_id FROM customer_licenses WHERE customer_id = ?)`).all(cid);
  res.render('shop/account', {
    title: 'My account', me, orders, licenses, posts,
    statusLabel: ORDER_STATUS_LABEL, typeLabel: LICENSE_TYPE_LABEL, isLicenseValid,
  });
});

// ---------- cart (quotes) ----------
router.post('/cart/add', requireLogin, (req, res) => {
  const cid = req.session.customer.id;
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.body.product_id));
  if (!product) return message(res, 404, { title: 'Not found', icon: 'bi-box', heading: 'Product not found', text: '' });

  const exists = db.prepare('SELECT 1 FROM quotes WHERE customer_id = ? AND product_id = ? AND status = 0').get(cid, product.id);
  if (!exists) {
    db.prepare('INSERT INTO quotes (product_id, sku, total_price, customer_id, status) VALUES (?, ?, ?, ?, 0)')
      .run(product.id, product.sku, product.price, cid);
    req.session.flash = { type: 'success', msg: `“${product.name}” added to cart.` };
  } else {
    req.session.flash = { type: 'info', msg: 'This product is already in your cart.' };
  }
  res.redirect(req.body.back === 'cart' ? '/cart' : `/product/${product.id}`);
});

// Re-price every active quote of a customer from product price + session coupon.
function recalcCart(req) {
  const cid = req.session.customer.id;
  let coupon = null;
  if (req.session.couponId) {
    coupon = db.prepare('SELECT * FROM coupons WHERE id = ? AND status = 1').get(req.session.couponId) || null;
    if (!coupon) delete req.session.couponId;
  }
  const items = db.prepare(`
    SELECT q.id, q.product_id, q.sku, p.name, p.price, p.image FROM quotes q
    JOIN products p ON p.id = q.product_id
    WHERE q.customer_id = ? AND q.status = 0 ORDER BY q.id`).all(cid);
  const upd = db.prepare('UPDATE quotes SET total_price = ?, coupon_id = ? WHERE id = ?');
  let subtotal = 0; let total = 0;
  for (const it of items) {
    it.final = coupon ? round2(it.price * (1 - coupon.percent / 100)) : it.price;
    upd.run(it.final, coupon ? coupon.id : null, it.id);
    subtotal += it.price; total += it.final;
  }
  subtotal = round2(subtotal); total = round2(total);
  return { items, coupon, subtotal, discount: round2(subtotal - total), total };
}

router.get('/cart', requireLogin, (req, res) => {
  res.render('shop/cart', { title: 'Shopping cart', cart: recalcCart(req) });
});

router.post('/cart/remove/:id', requireLogin, (req, res) => {
  db.prepare('DELETE FROM quotes WHERE id = ? AND customer_id = ? AND status = 0').run(Number(req.params.id), req.session.customer.id);
  res.redirect('/cart');
});

// ---------- checkout: step 1 address, step 2 payment ----------
router.get('/checkout', requireLogin, (req, res) => res.redirect('/checkout/address'));

router.get('/checkout/address', requireLogin, (req, res) => {
  const cart = recalcCart(req);
  if (!cart.items.length) return res.redirect('/cart');
  res.render('shop/checkout_address', {
    title: 'Checkout – Address', cart, a: req.session.address || { name: req.session.customer.name },
  });
});

router.post('/checkout/address', requireLogin, (req, res) => {
  const a = {};
  for (const k of ['name', 'phone', 'address', 'city']) a[k] = String(req.body[k] || '').trim();
  if (!a.name || !a.phone || !a.address || !a.city) {
    req.session.flash = { type: 'danger', msg: 'Please fill in all address fields.' };
    req.session.address = a;
    return res.redirect('/checkout/address');
  }
  req.session.address = a;
  res.redirect('/checkout/payment');
});

router.get('/checkout/payment', requireLogin, (req, res) => {
  const cart = recalcCart(req);
  if (!cart.items.length) return res.redirect('/cart');
  if (!req.session.address) return res.redirect('/checkout/address');
  res.render('shop/checkout_payment', { title: 'Checkout – Payment', cart, a: req.session.address });
});

router.post('/checkout/coupon', requireLogin, (req, res) => {
  const code = String(req.body.code || '').trim();
  const coupon = code && db.prepare('SELECT * FROM coupons WHERE title = ? COLLATE NOCASE AND status = 1').get(code);
  if (!coupon) {
    req.session.flash = { type: 'danger', msg: 'Invalid or inactive coupon.' };
  } else {
    req.session.couponId = coupon.id;
    req.session.flash = { type: 'success', msg: `Coupon ${coupon.title} applied (-${coupon.percent}%).` };
  }
  res.redirect('/checkout/payment');
});

router.post('/checkout/coupon/remove', requireLogin, (req, res) => {
  delete req.session.couponId;
  res.redirect('/checkout/payment');
});

router.post('/checkout/place', requireLogin, (req, res) => {
  const cid = req.session.customer.id;
  const a = req.session.address;
  const cart = recalcCart(req);
  if (!cart.items.length) return res.redirect('/cart');
  if (!a) return res.redirect('/checkout/address');

  const orderIds = [];
  db.exec('BEGIN');
  try {
    for (const it of cart.items) {
      // Payment method is COD: treated as paid/confirmed right away => order is Complete.
      const orderId = Number(db.prepare(
        'INSERT INTO orders (customer_id, product_id, quote_id, status, total_price) VALUES (?, ?, ?, ?, ?)',
      ).run(cid, it.product_id, it.id, ORDER_COMPLETE, it.final).lastInsertRowid);
      orderIds.push(orderId);

      db.prepare(`UPDATE quotes SET status = 1, shipping_name = ?, shipping_phone = ?, shipping_address = ?, shipping_city = ?
                  WHERE id = ?`).run(a.name, a.phone, a.address, a.city, it.id);

      const product = db.prepare('SELECT license_id FROM products WHERE id = ?').get(it.product_id);
      if (product && product.license_id) {
        db.prepare('INSERT OR IGNORE INTO customer_licenses (customer_id, license_id, order_id) VALUES (?, ?, ?)')
          .run(cid, product.license_id, orderId);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error(e);
    req.session.flash = { type: 'danger', msg: 'Could not place the order. Please try again.' };
    return res.redirect('/checkout/payment');
  }

  req.session.lastOrder = { ids: orderIds, subtotal: cart.subtotal, discount: cart.discount, total: cart.total, coupon: cart.coupon && cart.coupon.title };
  delete req.session.couponId;
  delete req.session.address;
  res.redirect('/checkout/success');
});

router.get('/checkout/success', requireLogin, (req, res) => {
  const last = req.session.lastOrder;
  if (!last) return res.redirect('/account');
  res.render('shop/success', { title: 'Order placed', last });
});

// ---------- posts (license-gated) ----------
router.get('/posts', (req, res) => {
  const cid = req.session.customer ? req.session.customer.id : null;
  const posts = db.prepare(`SELECT p.*, l.name AS license_name FROM posts p LEFT JOIN licenses l ON l.id = p.license_id
                            WHERE p.status = 'published' ORDER BY p.id DESC`).all();
  for (const p of posts) p.canView = canViewPost(p, cid);
  res.render('shop/posts', { title: 'Posts', posts });
});

function canViewPost(post, customerId) {
  if (!post.license_id) return true;
  if (!customerId) return false;
  const lic = db.prepare(`SELECT l.* FROM customer_licenses cl JOIN licenses l ON l.id = cl.license_id
                          WHERE cl.customer_id = ? AND cl.license_id = ?`).get(customerId, post.license_id);
  return isLicenseValid(lic);
}

router.get('/posts/:url', (req, res) => {
  const post = db.prepare("SELECT * FROM posts WHERE url = ? AND status = 'published'").get(req.params.url);
  if (!post) return message(res, 404, { title: 'Not found', icon: 'bi-file-earmark-x', heading: 'Post not found', text: '' });
  const cid = req.session.customer ? req.session.customer.id : null;
  if (!canViewPost(post, cid)) {
    return message(res, 403, {
      title: 'No access', icon: 'bi-lock-fill', heading: 'You do not have access to this post',
      text: cid ? 'Purchase the product that includes the required license to unlock this post.' : 'Please log in with an account that owns the required license.',
      link: cid ? { href: '/', label: 'Browse products' } : { href: '/login', label: 'Log in' },
    });
  }
  res.render('shop/post', { title: post.title, post });
});

module.exports = router;
