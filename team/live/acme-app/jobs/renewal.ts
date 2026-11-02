// Nightly: bill every annual plan whose period ends today, then mail the receipt.
import { db } from '../services/core/db';
import { send } from '../services/email/send';

export async function runRenewals(today = new Date()) {
  const due = await db.query(
    `SELECT u.id, u.email, p.amount_cents FROM users u
       JOIN plans p ON p.user_id = u.id
      WHERE p.period = 'annual' AND p.renews_on = $1`, [today]);
  for (const row of due.rows) {
    await db.query(`INSERT INTO invoices (user_id, amount_cents, kind) VALUES ($1, $2, 'renewal')`, [row.id, row.amount_cents]);
    await send(row.email, 'Your annual plan renewed', `We charged ${row.amount_cents / 100} for another year.`);
  }
  return due.rowCount;
}
