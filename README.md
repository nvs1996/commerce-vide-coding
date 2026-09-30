# Commerce Vibe Coding

A small e-commerce app built with Node.js: a customer **storefront** and an **admin panel** (AdminLTE theme) in one Express project. Products can grant **licenses** on purchase, and **posts** can be locked behind a license.

- Backend + frontend: Express 5, EJS server-side templates
- Database: SQLite through Node's built-in `node:sqlite` (no native build, no external DB server)
- Theme: AdminLTE 4 + Bootstrap 5 + Bootstrap Icons, installed from npm and served locally (works offline)

---

## Quick start

### 1. Requirements

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | **22.13 or newer** (developed on 24) | Needed for the built-in `node:sqlite` module. Check with `node -v`. |
| npm | comes with Node | |
| Git | any | only to clone |

No database server, Docker, or environment file is needed.

### 2. Install and run

```bash
git clone https://github.com/nvs1996/commerce-vide-coding.git
cd commerce-vide-coding
npm install
npm start
```

The server prints:

```
Shop:  http://localhost:3000/
Admin: http://localhost:3000/admin
```

On the **first run** the app creates `data.db` (SQLite file) in the project root and fills it with demo data. Nothing else to set up.

### 3. Demo accounts

| Area | URL | Username | Password |
|------|-----|----------|----------|
| Storefront (customer) | http://localhost:3000/ | `demo` | `demo123` |
| Admin panel | http://localhost:3000/admin | `admin` | `admin123` |

Customers can also register at `/register`. Admin users are managed in Admin → Users.

### Configuration

| Setting | How | Default |
|---------|-----|---------|
| Port | env var `PORT` | `3000` |
| Session secret | edit `server.js` (`session({ secret })`) | `dev-secret-change-me` — **change before any real deployment** |

Examples:

```bash
# macOS / Linux
PORT=4000 npm start
# Windows PowerShell
$env:PORT = 4000; npm start
```

### Reset the database

Stop the server, delete `data.db`, `data.db-wal`, `data.db-shm`, then start again. Demo data is re-created.

Uploaded product images live in `public/uploads/`. They are not in Git, so a fresh clone has no images (products then show a placeholder).

---

## Features

### Admin (`/admin`)
- Login for admin users (table `users`).
- Add / edit / delete for: **Users, Customers, Products, Licenses, Posts, Quotes, Orders, Coupons**, plus **Granted Licenses** (licenses given to customers).
- Every listing is paginated (default **10 per page**; 10 / 25 / 50 / 100 selectable).
- **Image upload** with live preview for **product images**, **customer avatars** and **admin avatars** (shown in the admin header) (JPG, PNG, GIF, WebP, max 5 MB). Old files are removed when an image is replaced or the record is deleted.
- **License rules:** a Product or Post can only be linked to a license that is **active** and **not expired**. A record keeps its current license when other fields are edited.
- License `expired_date` is date-only. A license is valid through the whole expiry day. Empty means it never expires.
- Posts have a URL slug (auto-made from the title if empty) and an optional required license.

### Storefront (`/`)
- **Members only:** every storefront page and action needs a customer login. Guests are redirected to `/login` (only `/login` and `/register` are open) and return to the page they wanted after signing in.
- Home page lists all products (name, price, SKU). Search by **name or SKU** in the header.
- Product detail page (PDP) and **Add to cart** (needs login). Each cart line is a row in `quotes`.
- **Checkout in 2 steps:** (1) shipping address, (2) payment (COD) with item list, coupon box (**Apply Coupon**), and a summary that shows original price, coupon discount, and the total after discount. **Place Order** creates the orders.
- Orders are saved with status **Complete**. When the product has a license, the customer is granted that license.
- **My account** (`/account`): side tabs for Profile, Order History, My Licenses, My Posts.
- **Customer avatar** (set in Admin → Customers) is shown in the header and on My account. Without an avatar, a circle with the customer's first letter is shown.
- **Posts** (`/posts`): posts the customer cannot read are shown locked and cannot be clicked. Opening a locked post URL directly shows a centered "You do not have access" block (HTTP 403). Posts with no license are public.

### Demo data (seeded on first run)
- Licenses: *Basic Plan*, *Pro Plan* (valid until 2030-12-31)
- Products: Starter Course (gives Basic), Pro Course (gives Pro), E-book, Template Pack
- Posts: one public, one for Basic, one for Pro
- Coupons: `WELCOME10` (10 %), `SAVE20` (20 %)

Try it: log in as `demo`, buy *Pro Course* with coupon `SAVE20`, then open `/posts/pro-masterclass`.

---

## Data model

| Table | Main columns |
|-------|--------------|
| `users` | id, username, password (admin login), **avatar** |
| `customers` | id, name, username, password, **avatar** |
| `products` | id, name, sku (unique), price, image, license_id |
| `licenses` | id, name, type (1 Personal, 2 Business, 3 Enterprise), status, expired_date |
| `posts` | id, title, body, license_id, status (`published`/`draft`), url (unique), created_at |
| `coupons` | id, title (unique), status, percent |
| `quotes` | id, product_id, sku, total_price, coupon_id, **customer_id**, **status** (0 cart / 1 converted), shipping_* |
| `orders` | id, customer_id, product_id, quote_id, status (0 Pending, 1 Complete, 2 Cancelled), **total_price**, **created_at** |
| `customer_licenses` | id, customer_id, license_id, order_id, granted_at (unique customer+license) |

Bold columns and `customer_licenses` are additions to the original diagram, needed by the cart/checkout and license flow. Passwords are stored as salted scrypt hashes.

---

## Project structure

```
server.js              App entry: middleware, static assets, routes, port
src/
  db.js                SQLite schema, seed data, password hashing
  license.js           isLicenseValid() – active + not expired (shared rule)
  admin.js             Admin routes + generic CRUD config (RESOURCES), uploads, pagination
  shop.js              Storefront routes: products, cart, checkout, account, posts
views/
  partials/            admin_top/bottom, shop_top/bottom (layouts)
  admin/               login, dashboard, list, form (generic, driven by RESOURCES)
  shop/                home, product, cart, checkout_*, account, posts, post, ...
public/
  css/shop.css         Small storefront styles
  img/                 logo.svg, placeholder.svg
  uploads/             Uploaded product images (git-ignored, keeps .gitkeep)
data.db                SQLite database (created on first run, git-ignored)
```

**Adding a new admin resource:** add a table in `src/db.js`, then add an entry to `RESOURCES` in `src/admin.js` (fields and types: `text`, `number`, `textarea`, `password`, `date`, `datetime`, `enum`, `ref`, `image`). The menu, list, form, validation and pagination come automatically.

**Theme assets:** `server.js` serves `node_modules/admin-lte/dist`, `bootstrap/dist` and `bootstrap-icons/font` under `/vendor/...`. The app needs `npm install` to have run for pages to look right.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Cannot find module 'node:sqlite'` or `ERR_UNKNOWN_BUILTIN_MODULE` | Node is too old. Install Node 22.13+ (`node -v`). |
| Pages have no styling / icons missing | Run `npm install` again; check that `node_modules/admin-lte` exists. |
| `EADDRINUSE: address already in use :::3000` | Another process uses the port. Stop it, or start with another `PORT`. |
| Windows: find and stop the process on port 3000 | `Get-NetTCPConnection -LocalPort 3000 -State Listen \| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }` |
| Lost demo data / want a clean start | Delete `data.db*` and restart (see "Reset the database"). |
| Product images / avatars broken after cloning | Uploads are not in Git. Re-upload in Admin → Products / Customers. |
| Login works then logs out after restart | Sessions are kept in memory. Restarting the server clears them. |

---

## Notes for deployment (not production-ready yet)

- Change the session secret and read it from an environment variable.
- Sessions use the default in-memory store; use a persistent store for production.
- No CSRF protection, rate limiting, or HTTPS handling yet.
- Default admin password is public in this README. Change it in Admin → Users.

---

## Instructions for an AI assistant (Claude) setting this up

If you are asked to install this project on a new machine, do exactly this:

1. Check `node -v`. It must be **22.13 or newer**. If not, tell the user to install a newer Node.js and stop.
2. In the project root run `npm install`.
3. Run `npm start` (or `node server.js`). Expect the two lines `Shop: http://localhost:3000/` and `Admin: http://localhost:3000/admin`.
4. Verify with `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` → `200`, and `.../admin/login` → `200`.
5. Report the demo accounts from the table above. Do **not** commit `data.db`, `node_modules`, or `public/uploads/*`.

No `.env` file, database server, or build step is needed. Database and demo data are created automatically.
