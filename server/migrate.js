// Применяет SQL-скрипты из папки sql/ по порядку имён файлов.
// Уже применённые файлы пропускаются (таблица schema_migrations).
// Запуск: npm run migrate

require('./env').loadEnv();
const fs = require('fs');
const path = require('path');
const pool = require('./db');

const SQL_DIR = path.join(__dirname, '..', 'sql');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function main() {
  const files = fs
    .readdirSync(SQL_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);

    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`⏭  ${file} — уже применён, пропускаю`);
        continue;
      }
      const sql = fs.readFileSync(path.join(SQL_DIR, file), 'utf8');
      console.log(`▶️  Применяю ${file} ...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`✅  ${file} применён`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Ошибка при применении ${file}: ${err.message}`);
      }
    }

    console.log('Готово. Структура базы данных актуальна.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Миграция прервана:', err.message);
  process.exit(1);
});
