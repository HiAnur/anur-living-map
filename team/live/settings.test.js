import fs from 'node:fs';
import vm from 'node:vm';

import { expect, it } from 'vitest';

const html = fs.readFileSync(new URL('./settings.html', import.meta.url), 'utf8');

it('says what Settings offers about Google: sign in when it is set up, sign out once you have', () => {
  const ctx = vm.createContext({});
  vm.runInContext(html.slice(html.indexOf('function words('), html.indexOf('const post =')), ctx);
  expect(ctx.words({ role: 'Owner', googleEmail: 'h@example.com', google: true })).toMatchObject({ role: 'Owner', google: 'h@example.com', action: 'out' });
  expect(ctx.words({ role: 'Engineer, runs Claude Code', googleEmail: '', google: true })).toMatchObject({ role: 'Engineer', google: 'Not signed in', action: 'in', note: expect.stringContaining('Optional') });
  // where this Mac has no Google sign-in, nothing is offered
  expect(ctx.words({ role: 'Owner', googleEmail: '', google: false })).toMatchObject({ google: 'Not set up on this Mac', note: '', action: '' });
});

it('offers no password, invite or recovery email in Settings', () => {
  expect(html).not.toMatch(/password|[Ii]nvite|recovery|\/login/);
});

it('links Settings from the account menu on the list of maps and on a map', () => {
  for (const file of ['maps.html', 'index.html']) expect(fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')).toMatch(/href="\/settings">Settings<\/a>/);
});
