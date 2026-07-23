const express = require('express');
const pool = require('../db');
const { buildFilters, BASE_SELECT } = require('../expenseQueries');
const { toCsv } = require('../csv');

const router = express.Router();

// Вид 1 — список операций
async function fetchOperations(query) {
  const { whereSql, values } = buildFilters(query, 1);
  const { rows } = await pool.query(
    `${BASE_SELECT} ${whereSql} ORDER BY e.expense_date DESC, e.id DESC`,
    values
  );
  return rows;
}

// Вид 2 — сводка по категориям (с группировкой по разделам)
// Фильтры по категории/разделу применяются к самим категориям (WHERE),
// а фильтры по дате/пользователю — к условию JOIN с расходами (чтобы категории
// без расходов за период не пропадали из группировки, а просто получали total = 0).
async function fetchByCategory(query) {
  const categoryWhere = [];
  const joinConditions = ['e.category_id = c.id'];
  const values = [];
  let i = 1;

  if (query.category_id) {
    categoryWhere.push(`c.id = $${i++}`);
    values.push(parseInt(query.category_id, 10));
  }
  if (query.group_id) {
    categoryWhere.push(`c.group_id = $${i++}`);
    values.push(parseInt(query.group_id, 10));
  }
  if (query.date_from) {
    joinConditions.push(`e.expense_date >= $${i++}`);
    values.push(query.date_from);
  }
  if (query.date_to) {
    joinConditions.push(`e.expense_date <= $${i++}`);
    values.push(query.date_to);
  }
  if (query.user_id) {
    joinConditions.push(`e.user_id = $${i++}`);
    values.push(parseInt(query.user_id, 10));
  }

  const categoryWhereSql = categoryWhere.length ? `WHERE ${categoryWhere.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT g.id AS group_id, g.name AS group_name, g.sort_order AS group_order,
            c.id AS category_id, c.name AS category_name, c.sort_order AS category_order,
            COALESCE(SUM(e.amount), 0) AS total, COUNT(e.id) AS count
     FROM categories c
     JOIN category_groups g ON g.id = c.group_id
     LEFT JOIN expenses e ON ${joinConditions.join(' AND ')}
     ${categoryWhereSql}
     GROUP BY g.id, g.name, g.sort_order, c.id, c.name, c.sort_order
     HAVING COALESCE(SUM(e.amount), 0) > 0 OR COUNT(e.id) > 0
     ORDER BY g.sort_order, g.id, c.sort_order, c.id`,
    values
  );
  return rows.map((r) => ({ ...r, total: Number(r.total), count: Number(r.count) }));
}

// Вид 3 — сводка по пользователям
async function fetchByUser(query) {
  const { whereSql, values } = buildFilters(query, 1);
  const { rows } = await pool.query(
    `SELECT u.id AS user_id, u.name AS user_name,
            COALESCE(SUM(e.amount), 0) AS total, COUNT(e.id) AS count
     FROM users u
     JOIN expenses e ON e.user_id = u.id
     ${whereSql}
     GROUP BY u.id, u.name
     ORDER BY total DESC`,
    values
  );
  return rows.map((r) => ({ ...r, total: Number(r.total), count: Number(r.count) }));
}

router.get('/operations', async (req, res, next) => {
  try {
    res.json(await fetchOperations(req.query));
  } catch (err) {
    next(err);
  }
});

router.get('/by-category', async (req, res, next) => {
  try {
    res.json(await fetchByCategory(req.query));
  } catch (err) {
    next(err);
  }
});

router.get('/by-user', async (req, res, next) => {
  try {
    res.json(await fetchByUser(req.query));
  } catch (err) {
    next(err);
  }
});

// Экспорт в CSV (UTF-8 с BOM — открывается корректно в Excel на Windows)
router.get('/export', async (req, res, next) => {
  try {
    const type = req.query.type || 'operations';
    let csv;
    let filename;

    if (type === 'by-category') {
      const rows = await fetchByCategory(req.query);
      csv = toCsv(rows, [
        { key: 'group_name', label: 'Раздел' },
        { key: 'category_name', label: 'Категория' },
        { key: 'total', label: 'Сумма' },
        { key: 'count', label: 'Кол-во операций' }
      ]);
      filename = 'otchet-po-kategoriyam.csv';
    } else if (type === 'by-user') {
      const rows = await fetchByUser(req.query);
      csv = toCsv(rows, [
        { key: 'user_name', label: 'Пользователь' },
        { key: 'total', label: 'Сумма' },
        { key: 'count', label: 'Кол-во операций' }
      ]);
      filename = 'otchet-po-polzovatelyam.csv';
    } else {
      const rows = await fetchOperations(req.query);
      csv = toCsv(rows, [
        { key: 'expense_date', label: 'Дата' },
        { key: 'group_name', label: 'Раздел' },
        { key: 'category_name', label: 'Категория' },
        { key: 'amount', label: 'Сумма' },
        { key: 'comment', label: 'Комментарий' },
        { key: 'user_name', label: 'Добавил' }
      ]);
      filename = 'operatsii.csv';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
