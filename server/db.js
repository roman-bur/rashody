const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('Не задана переменная окружения DATABASE_URL. Смотрите .env.example.');
}

const useSSL = String(process.env.PGSSL || 'false').toLowerCase() === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('Неожиданная ошибка подключения к PostgreSQL:', err);
});

module.exports = pool;
