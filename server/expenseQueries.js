// Общая логика фильтрации/выборки расходов — используется и в /api/expenses, и в /api/reports.

function buildFilters(query, startIndex) {
  const where = [];
  const values = [];
  let i = startIndex;

  if (query.date_from) {
    where.push(`e.expense_date >= $${i++}`);
    values.push(query.date_from);
  }
  if (query.date_to) {
    where.push(`e.expense_date <= $${i++}`);
    values.push(query.date_to);
  }
  if (query.category_id) {
    where.push(`e.category_id = $${i++}`);
    values.push(parseInt(query.category_id, 10));
  }
  if (query.group_id) {
    where.push(`c.group_id = $${i++}`);
    values.push(parseInt(query.group_id, 10));
  }
  if (query.user_id) {
    where.push(`e.user_id = $${i++}`);
    values.push(parseInt(query.user_id, 10));
  }

  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', values, nextIndex: i };
}

const BASE_SELECT = `
  SELECT e.id, e.amount, e.expense_date, e.comment, e.created_at,
         c.id AS category_id, c.name AS category_name,
         g.id AS group_id, g.name AS group_name,
         u.id AS user_id, u.name AS user_name
  FROM expenses e
  JOIN categories c ON c.id = e.category_id
  JOIN category_groups g ON g.id = c.group_id
  JOIN users u ON u.id = e.user_id
`;

module.exports = { buildFilters, BASE_SELECT };
