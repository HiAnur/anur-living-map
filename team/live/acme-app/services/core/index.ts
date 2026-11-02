// Core API: accounts and plans for the web app.
import express from 'express';
import { db } from './db';
const app = express();
app.get('/me', async (req, res) => {
  const u = await db.query('SELECT id, email FROM users WHERE id = $1', [req.user.id]);
  const p = await db.query('SELECT period, renews_on FROM plans WHERE user_id = $1', [req.user.id]);
  res.json({ ...u.rows[0], plan: p.rows[0] ?? { period: 'free' } });
});
app.listen(3000);
