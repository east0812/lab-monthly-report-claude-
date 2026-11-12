// 검증 스크립트용 HTTP 클라이언트 (쿠키 보관). 가상 계정(dev/demo-accounts.json)으로 로그인한다.
//   import { session } from './client.mjs';
//   const emp = await session('emp1');
//   const r = await emp.get('/api/notifications');   // { status, json, text, headers }
//   await emp.post('/api/...', { ... });  emp.patch / emp.del / emp.upload(url, FormData)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadEnv } from '../../scripts/lib.mjs';

loadEnv();
export const BASE = (process.env.VERIFY_BASE_URL || process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
export const accounts = Object.fromEntries(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'dev/demo-accounts.json'), 'utf8')).accounts.map((a) => [a.key, a]),
);

export class Session {
  constructor() { this.jar = new Map(); }
  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  absorb(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim(), value = pair.slice(i + 1);
      if (!value || /max-age=0|expires=Thu, 01 Jan 1970/i.test(c)) this.jar.delete(name); else this.jar.set(name, value);
    }
  }
  async request(method, url, body, opts = {}) {
    const headers = { cookie: this.cookieHeader(), origin: BASE, ...(opts.headers ?? {}) };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual' });
    this.absorb(res);
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text, buf, headers: res.headers };
  }
  get(u, o) { return this.request('GET', u, undefined, o); }
  post(u, b, o) { return this.request('POST', u, b ?? {}, o); }
  patch(u, b, o) { return this.request('PATCH', u, b ?? {}, o); }
  put(u, b, o) { return this.request('PUT', u, b ?? {}, o); }
  del(u, b, o) { return this.request('DELETE', u, b, o); }
  upload(u, form) { return this.request('POST', u, form); }
  async login(email, password, remember = true) {
    return this.post('/api/auth/login', { email, password, remember });
  }
}

/** 가상 계정 키(admin, emp1, emp2, emp3, inactive)로 로그인한 세션 */
export async function session(key) {
  const a = accounts[key];
  if (!a) throw new Error(`알 수 없는 계정 키: ${key}`);
  const s = new Session();
  const r = await s.login(a.email, a.password);
  if (r.status !== 200) throw new Error(`로그인 실패(${key}): ${r.status} ${r.text.slice(0, 200)}`);
  return s;
}
