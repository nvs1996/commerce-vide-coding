// A license is usable when it is active and not past its (date-only) expiry.
// It stays valid through the whole expiry day, using server local time.
function isLicenseValid(l) {
  if (!l || !l.status) return false;
  if (!l.expired_date) return true;
  const expiry = String(l.expired_date).slice(0, 10);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return today <= expiry;
}

module.exports = { isLicenseValid };
