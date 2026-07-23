const express = require('express');
const pool = require('../db');
const { requireUser, requireAdmin } = require('../auth');

const router = express.Router();

// Категории, сгруппированные по разделам — для экрана выбора категории и фильтров
router.get('/', async (req, res, next) => {
  try {
    const includeInactive = req.query.all === '1';
    const { rows } = await pool.query(
      `SELECT g.id AS group_id, g.name AS group_name, g.sort_order AS group_order,
              c.id AS category_id, c.name AS category_name, c.is_active, c.sort_order AS category_order
       FROM category_groups g
       JOIN categories c ON c.group_id = g.id
       ${includeInactive ? '' : 'WHERE c.is_active = TRUE'}
       ORDER BY g.sort_order, g.id, c.sort_order, c.id`
    );

    const groupsMap = new Map();
    for (const r of rows) {
      if (!groupsMap.has(r.group_id)) {
        groupsMap.set(r.group_id, { id: r.group_id, name: r.group_name, categories: [] });
      }
      groupsMap.get(r.group_id).categories.push({
        id: r.category_id,
        name: r.category_name,
        is_active: r.is_active
      });
    }
    res.json(Array.from(groupsMap.values()));
  } catch (err) {
    next(err);
  }
});

// Список разделов (групп) — для формы добавления категории в админке
router.get('/groups', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, sort_order FROM category_groups ORDER BY sort_order, id'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/groups', requireUser, requireAdmin, async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Укажите название раздела' });
    const { rows: maxRows } = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM category_groups');
    const { rows } = await pool.query(
      `INSERT INTO category_groups (name, sort_order) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, sort_order`,
      [name, maxRows[0].next]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Добавить категорию
router.post('/', requireUser, requireAdmin, async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    const groupId = parseInt(req.body.group_id, 10);
    if (!name || !groupId) return res.status(400).json({ error: 'Укажите название и раздел' });

    const { rows: maxRows } = await pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM categories WHERE group_id = $1',
      [groupId]
    );
    const { rows } = await pool.query(
      `INSERT INTO categories (name, group_id, sort_order) VALUES ($1, $2, $3)
       ON CONFLICT (name, group_id) DO UPDATE SET is_active = TRUE
       RETURNING id, name, group_id, is_active, sort_order`,
      [name, groupId, maxRows[0].next]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Переименовать категорию / включить-выключить
router.patch('/:id', requireUser, requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const fields = [];
    const values = [];
    let i = 1;

    if (typeof req.body.name === 'string' && req.body.name.trim()) {
      fields.push(`name = $${i++}`);
      values.push(req.body.name.trim());
    }
    if (typeof req.body.is_active === 'boolean') {
      fields.push(`is_active = $${i++}`);
      values.push(req.body.is_active);
    }
    if (!fields.length) return res.status(400).json({ error: 'Нечего обновлять' });

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE categories SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, name, group_id, is_active`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Категория не найдена' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Удалить категорию: если по ней уже есть расходы — деактивируем (чтобы не потерять
// историю), иначе удаляем полностью.
router.delete('/:id', requireUser, requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows: used } = await pool.query('SELECT 1 FROM expenses WHERE category_id = $1 LIMIT 1', [id]);
    if (used.length) {
      const { rows } = await pool.query(
        'UPDATE categories SET is_active = FALSE WHERE id = $1 RETURNING id, name, is_active',
        [id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Категория не найдена' });
      return res.json({ ...rows[0], note: 'По категории уже есть расходы — она скрыта, а не удалена.' });
    }
    const { rowCount } = await pool.query('DELETE FROM categories WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Категория не найдена' });
    res.json({ id, deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
