import { test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { useTeamServer } from "./team-map.harness.ts";

// Every sharing test runs its own local cloud and Google stand-in. No real accounts or cloud records are used.
const CLOUD = path.resolve(import.meta.dirname, "../team/cloud");
const PUBLISH_KEY = "a".repeat(64);
const FAKES = `
import http from 'node:http';
import { createCloudServer } from ${JSON.stringify(pathToFileURL(path.join(CLOUD, "server.js")).href)};
import { fakeGoogle } from ${JSON.stringify(pathToFileURL(path.join(CLOUD, "google-id.harness.js")).href)};
const google = fakeGoogle();
const records = new Map();
const store = {
  async get(id) { return structuredClone(records.get(id) || null); },
  async put(id, value, version) {
    if ((records.get(id)?.version || null) !== version) throw Object.assign(new Error('Conflict'), { status: 409 });
    const record = { value: structuredClone(value), version: String(Number(version) + 1) }; records.set(id, record); return structuredClone(record);
  },
  async delete(id) { records.delete(id); },
};
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
// the stand-in login service signs in whoever the test says is at the keyboard
let who = { email: 'duy@example.com', name: 'Duy' };
const login = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/as') { let b = ''; for await (const c of req) b += c; who = JSON.parse(b); return res.end('{}'); }
  if (url.pathname === '/start') return res.writeHead(302, { location: url.searchParams.get('return') + '?' + new URLSearchParams({ code: 'one-time', state: url.searchParams.get('state') }) }).end();
  if (url.pathname === '/exchange') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...who, listed: true, picture: '', id_token: google.token(who.email, { name: who.name }) }));
  res.writeHead(404).end();
});
const loginPort = await listen(login);
const reserve = http.createServer(); const cloudPort = await listen(reserve); await new Promise((r) => reserve.close(r));
const cloud = createCloudServer({ store, publishKey: ${JSON.stringify(PUBLISH_KEY)}, publicUrl: 'http://127.0.0.1:' + cloudPort, checkIdToken: google.check, loginUrl: 'http://127.0.0.1:' + loginPort });
// Google's front end removes reserved headers before the request reaches the cloud app.
cloud.prependListener('request', (req) => {
  for (const name of Object.keys(req.headers)) {
    if (name.startsWith('x-google-')) delete req.headers[name];
  }
});
await new Promise((r) => cloud.listen(cloudPort, '127.0.0.1', r));
console.log(JSON.stringify({ login: 'http://127.0.0.1:' + loginPort, cloud: 'http://127.0.0.1:' + cloudPort }));
`;

let login = "";
export function useCloudSharingServer() {
  let fakes: ChildProcess | undefined;
  let cloud = "";
  let home = "";
  test.beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "lm-share-"));
    fakes = spawn(process.execPath, ["--input-type=module", "-e", FAKES], {
      env: { ...process.env, HOME: home },
      stdio: ["ignore", "pipe", "inherit"],
    });
    const first = await new Promise<string>((resolve) =>
      fakes?.stdout?.once("data", (d: Buffer) => resolve(String(d))),
    );
    ({ login, cloud } = JSON.parse(first) as { login: string; cloud: string });
    fs.writeFileSync(
      path.join(home, "cloud.json"),
      JSON.stringify({ url: cloud, publishKey: PUBLISH_KEY }),
    );
  });
  test.afterAll(() => {
    fakes?.kill();
    fs.rmSync(home, { recursive: true, force: true });
  });
  useTeamServer({
    env: () => ({
      LIVING_MAP_LOGIN_URL: login,
      LIVING_MAP_CLOUD_CONFIG: path.join(home, "cloud.json"),
      LIVING_MAP_CLOUD_TEST: "1",
    }),
  });
}
export const signInAs = (email: string, name: string) =>
  fetch(`${login}/as`, {
    method: "POST",
    body: JSON.stringify({ email, name }),
  });
