// Receipts, renewal notices, trial reminders.
export async function send(to: string, subject: string, text: string) {
  await fetch(process.env.EMAIL_API!, { method: 'POST', body: JSON.stringify({ to, subject, text }) });
}
