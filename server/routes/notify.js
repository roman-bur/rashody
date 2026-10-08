// Пересылка уведомлений в Telegram для программы «Ресторан Цветов — Команда».
// Её сервер в России не достаёт до Telegram, а Railway — достаёт, поэтому сообщения идут через эту программу.
// Доступ — только с ключом NOTIFY_KEY (заголовок X-Notify-Key). Токен бота — TG_TOKEN. Оба задаются в Railway → Variables.
const crypto = require('crypto');
const express = require('express');

const router = express.Router();

function keyOk(req) {
  const want = process.env.NOTIFY_KEY || '';
  const got = req.header('X-Notify-Key') || '';
  if (want.length < 16 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

async function tg(method, body) {
  const token = process.env.TG_TOKEN;
  if (!token) throw new Error('На Railway не задан TG_TOKEN');
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  return r.json();
}

// Номер чата владельца: последний, кто написал боту (владелец нажимает «Старт»)
router.post('/find-chat', async (req, res) => {
  if (!keyOk(req)) return res.status(403).json({ error: 'forbidden' });
  try {
    const data = await tg('getUpdates', {});
    if (!data.ok) return res.status(502).json({ error: data.description || 'telegram error' });
    const ids = (data.result || []).map((u) => ((u.message || u.my_chat_member || {}).chat || {}).id).filter(Boolean);
    res.json({ chat_id: ids.length ? String(ids[ids.length - 1]) : null });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Отправка сообщения: { chat_id, text }
router.post('/', async (req, res) => {
  if (!keyOk(req)) return res.status(403).json({ error: 'forbidden' });
  const { chat_id: chatId, text } = req.body || {};
  if (!chatId || !text) return res.status(400).json({ error: 'chat_id и text обязательны' });
  try {
    const data = await tg('sendMessage', { chat_id: chatId, text: String(text).slice(0, 4000), disable_web_page_preview: true });
    if (!data.ok) return res.status(502).json({ error: data.description || 'telegram error' });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
