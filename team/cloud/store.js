import { gzipSync, gunzipSync } from 'node:zlib';

export class FirestoreStore {
  constructor(project) {
    if (!/^[a-z][a-z0-9-]+$/.test(project || '')) throw new Error('A GCP project is required.');
    this.root = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/sharedMaps`;
  }
  async token() {
    if (this.cached && /** @type {number} */ (this.expires) > Date.now()) return this.cached;
    const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('Cloud credentials unavailable.');
    const t = await r.json(); this.cached = t.access_token; this.expires = Date.now() + Math.max(60, t.expires_in - 60) * 1000;
    return this.cached;
  }
  async request(method, suffix, body) {
    const r = await fetch(this.root + suffix, { method, headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    if (r.status === 404) return null;
    if (r.status === 409 || r.status === 412) throw Object.assign(new Error('The map changed. Please try again.'), { status: 409 });
    if (!r.ok) throw Object.assign(new Error('Cloud storage could not save the map. Please try again.'), { status: 503 });
    return r.status === 204 ? null : r.json();
  }
  async get(id) {
    const d = await this.request('GET', `/${id}`);
    return d ? { value: JSON.parse(/** @type {any} */ (gunzipSync(Buffer.from(d.fields.data.bytesValue, 'base64'), { maxOutputLength: 24 * 1024 * 1024 }))), version: d.updateTime } : null;
  }
  async put(id, value, version) {
    const raw = JSON.stringify(value);
    if (Buffer.byteLength(raw) > 23 * 1024 * 1024) throw Object.assign(new Error('This map has reached the cloud history limit. No changes were saved.'), { status: 413 });
    const encoded = gzipSync(raw);
    if (encoded.length > 700000) throw Object.assign(new Error('This map has reached the cloud size limit. Download a copy before making it smaller.'), { status: 413 });
    const condition = version ? `currentDocument.updateTime=${encodeURIComponent(version)}` : 'currentDocument.exists=false';
    const d = await this.request('PATCH', `/${id}?${condition}`, { fields: { data: { bytesValue: encoded.toString('base64') } } });
    return { value, version: d.updateTime };
  }
  async delete(id, version) { await this.request('DELETE', `/${id}?currentDocument.updateTime=${encodeURIComponent(version)}`); }
}
