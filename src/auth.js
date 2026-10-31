const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'recur-sms-super-secret-key-2026';
const ADMIN_EMAIL = 'ashishsunil4160@gmail.com';

function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required' };
  }
  if (password.length <= 8) {
    return { valid: false, message: 'Password must be more than 8 characters long' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one special character' };
  }
  return { valid: true };
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User account no longer exists.' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'ADMIN' || req.user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: 'Forbidden. Admin privileges required.' });
  }
  next();
}

function requireStaffOrAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'STAFF' && req.user.role !== 'ADMIN')) {
    return res.status(403).json({ error: 'Forbidden. Staff or Admin access required.' });
  }
  next();
}

module.exports = {
  ADMIN_EMAIL,
  validatePassword,
  generateToken,
  authMiddleware,
  requireAdmin,
  requireStaffOrAdmin
};
