const express = require('express');
const session = require('express-session');
const path = require('path');
const { db } = require('./src/db');

const app = express();
const nm = (p) => path.join(__dirname, 'node_modules', p);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Theme assets served from npm packages (offline-friendly)
app.use('/vendor/adminlte', express.static(nm('admin-lte/dist')));
app.use('/vendor/bootstrap', express.static(nm('bootstrap/dist')));
app.use('/vendor/bootstrap-icons', express.static(nm('bootstrap-icons/font')));
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.urlencoded({ extended: false }));
app.use(session({ secret: 'dev-secret-change-me', resave: false, saveUninitialized: false }));

app.use((req, res, next) => {
  // Read the customer fresh so name/avatar edited in admin show up without re-login.
  let customer = null;
  if (req.session.customer) {
    customer = db.prepare('SELECT id, name, username, avatar FROM customers WHERE id = ?').get(req.session.customer.id) || null;
    if (!customer) delete req.session.customer;   // account was deleted
  }
  res.locals.customer = customer;
  let admin = null;
  if (req.session.admin) {
    admin = db.prepare('SELECT id, username, avatar FROM users WHERE id = ?').get(req.session.admin.id) || null;
    if (!admin) delete req.session.admin;   // admin user was deleted
  }
  res.locals.admin = admin;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.fmt = (n) => '$' + Number(n || 0).toFixed(2);
  res.locals.q = '';
  res.locals.cartCount = req.session.customer
    ? db.prepare('SELECT COUNT(*) AS n FROM quotes WHERE customer_id = ? AND status = 0').get(req.session.customer.id).n
    : 0;
  next();
});

app.use('/admin', require('./src/admin'));
app.use('/', require('./src/shop'));

app.use((req, res) => res.status(404).render('shop/message', {
  title: 'Not found', icon: 'bi-question-circle', heading: '404', text: 'Page not found.',
}));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Shop:  http://localhost:${port}/   (demo / demo123)`);
  console.log(`Admin: http://localhost:${port}/admin   (admin / admin123)`);
});
