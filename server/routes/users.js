const express = require('express');
const pool = require('../db');
const { requireUser, requireAdmin } = require('../auth');

const router = express.Router();

// Публичный список активных пользователей — для экрана выбора имени при входе
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name FROM users WHERE is_active = TRUE ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Проверка сохранённого пользователя (после выбора / при повторном входе)
router.get('/me', async (req, res, next) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) return res.status(400).json({ error: 'userId обязателен' });
    const { rows } = await pool.query(
      'SELECT id, name, is_admin, is_active FROM users WHERE id = $1',
      [userId]
    );
    if (!rows.length || !rows[0].is_active) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// --- Администрирование пользователей ---

// Список всех пользователей (включая неактивных) — для админ-панели
router.get('/admin/all', requireUser, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, is_admin, is_active, created_at FROM users ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Добавить пользователя
router.post('/admin', requireUser, requireAdmin, async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    const isAdmin = !!req.body.is_admin;
    if (!name) return res.status(400).json({ error: 'Укажите имя пользователя' });

    const { rows } = await pool.query(
      `INSERT INTO users (name, is_admin) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET is_active = TRUE
       RETURNING id, name, is_admin, is_active`,
      [name, isAdmin]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Изменить пользователя (имя / права администратора / активность)
router.patch('/admin/:id', requireUser, requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const fields = [];
    const values = [];
    let i = 1;

    if (typeof req.body.name === 'string' && req.body.name.trim()) {
      fields.push(`name = $${i++}`);
      values.push(req.body.name.trim());
    }
    if (typeof req.body.is_admin === 'boolean') {
      fields.push(`is_admin = $${i++}`);
      values.push(req.body.is_admin);
    }
    if (typeof req.body.is_active === 'boolean') {
      fields.push(`is_active = $${i++}`);
      values.push(req.body.is_active);
    }
    if (!fields.length) return res.status(400).json({ error: 'Нечего обновлять' });

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, name, is_admin, is_active`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
