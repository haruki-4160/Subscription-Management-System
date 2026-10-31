const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { ADMIN_EMAIL, validatePassword, generateToken, authMiddleware } = require('../auth');

const router = express.Router();

// Registration
router.post('/register', (req, res) => {
  const { email, password } = req.body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Valid email is required.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  // Validate password rules
  const pwdValidation = validatePassword(password);
  if (!pwdValidation.valid) {
    return res.status(400).json({ error: pwdValidation.message });
  }

  // Check unique email
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  // Determine role
  let role = 'CUSTOMER';
  if (cleanEmail === ADMIN_EMAIL.toLowerCase()) {
    role = 'ADMIN';
  } else {
    const isStaff = db.prepare('SELECT email FROM staff_whitelist WHERE email = ?').get(cleanEmail);
    if (isStaff) {
      role = 'STAFF';
    }
  }

  const userId = 'usr_' + crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(password, 10);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, role)
    VALUES (?, ?, ?, ?)
  `).run(userId, cleanEmail, passwordHash, role);

  const user = { id: userId, email: cleanEmail, role };
  const token = generateToken(user);

  res.status(201).json({
    message: 'Account created successfully',
    user,
    token
  });
});

// Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const isMatch = bcrypt.compareSync(password, user.password_hash);
  if (!isMatch) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  // Sync role if admin modified staff list
  let correctRole = user.role;
  if (cleanEmail === ADMIN_EMAIL.toLowerCase()) {
    correctRole = 'ADMIN';
  } else {
    const isStaff = db.prepare('SELECT email FROM staff_whitelist WHERE email = ?').get(cleanEmail);
    correctRole = isStaff ? 'STAFF' : 'CUSTOMER';
  }

  if (correctRole !== user.role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(correctRole, user.id);
    user.role = correctRole;
  }

  const token = generateToken(user);
  res.json({
    message: 'Login successful',
    user: { id: user.id, email: user.email, role: user.role },
    token
  });
});

// Forgot Password
router.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(cleanEmail);

  if (!user) {
    // For security, do not disclose if email exists, but return success
    return res.json({ message: 'If this email is registered, a password reset link has been dispatched.' });
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString(); // 1 hour validity

  db.prepare(`
    INSERT INTO password_resets (id, email, token, expires_at)
    VALUES (?, ?, ?, ?)
  `).run('rst_' + crypto.randomUUID(), cleanEmail, resetToken, expiresAt);

  // In demo environment, we return the reset link directly in response and log it
  const resetLink = `/reset-password.html?token=${resetToken}&email=${encodeURIComponent(cleanEmail)}`;
  res.json({
    message: 'Password reset link generated and dispatched.',
    demo_reset_link: resetLink
  });
});

// Reset Password
router.post('/reset-password', (req, res) => {
  const { token, email, new_password } = req.body;
  if (!token || !email || !new_password) {
    return res.status(400).json({ error: 'Token, email, and new password are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const resetRecord = db.prepare(`
    SELECT * FROM password_resets 
    WHERE email = ? AND token = ? AND used = 0 AND expires_at > CURRENT_TIMESTAMP
  `).get(cleanEmail, token);

  if (!resetRecord) {
    return res.status(400).json({ error: 'Invalid or expired password reset link.' });
  }

  const validation = validatePassword(new_password);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  const newHash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(newHash, cleanEmail);
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(resetRecord.id);

  res.json({ message: 'Password has been reset successfully. You can now log in.' });
});

// Current user profile
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
