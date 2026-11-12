// 로컬 검증 전용: Supabase Auth(GoTrue) REST API 중 이 앱이 쓰는 부분만 흉내 내는 서버.
// 운영에서는 실제 Supabase 프로젝트를 사용한다. 이 서버를 사내 운영에 쓰지 말 것.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const b64u = (b) => Buffer.from(b).toString('base64url');
export function signJwt(payload, secret) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token, secret) {
  const [h, b, s] = String(token || '').split('.');
  if (!h || !b || !s) return null;
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest();
  const got = Buffer.from(s, 'base64url');
  if (got.length !== sig.length || !crypto.timingSafeEqual(got, sig)) return null;
  const p = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
  if (p.exp && p.exp < Date.now() / 1000) return null;
  return p;
}
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const ACCESS_TTL = 3600;
const MIN_PASSWORD = 6; // Supabase 기본 최소 길이와 동일

export function startAuthServer({ sql, port, jwtSecret, outboxDir }) {
  const err = (res, status, error_code, msg) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: status, error_code, msg }));
  };
  const ok = (res, body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const toUser = (u) => ({
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: u.email_confirmed_at, phone: '',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: u.raw_user_meta_data || {}, identities: [],
    banned_until: u.banned_until || undefined,
    last_sign_in_at: u.last_sign_in_at, created_at: u.created_at, updated_at: u.updated_at,
  });
  const isBanned = (u) => u.banned_until && new Date(u.banned_until) > new Date();

  async function issueSession(u, sessionId = crypto.randomUUID()) {
    const now = Math.floor(Date.now() / 1000);
    const access_token = signJwt({
      iss: `http://127.0.0.1:${port}/auth/v1`, sub: u.id, aud: 'authenticated', role: 'authenticated',
      email: u.email, session_id: sessionId, iat: now, exp: now + ACCESS_TTL,
      app_metadata: { provider: 'email' }, user_metadata: u.raw_user_meta_data || {},
    }, jwtSecret);
    const refresh_token = crypto.randomBytes(24).toString('base64url');
    await sql`insert into auth.refresh_tokens (token, user_id, session_id) values (${refresh_token}, ${u.id}, ${sessionId})`;
    return { access_token, token_type: 'bearer', expires_in: ACCESS_TTL, expires_at: now + ACCESS_TTL, refresh_token, user: toUser(u) };
  }
  function parseBan(d) {
    if (!d || d === 'none') return null;
    const m = /^(\d+)h$/.exec(d);
    return new Date(Date.now() + (m ? Number(m[1]) : 24) * 3600 * 1000);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const p = url.pathname.replace(/^\/auth\/v1/, '');
      if (!url.pathname.startsWith('/auth/v1')) return err(res, 404, 'not_found', 'Not found');
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = {};
      if (raw) { try { body = JSON.parse(raw); } catch { return err(res, 400, 'bad_json', 'Invalid JSON'); } }

      const apikey = verifyJwt(req.headers['apikey'], jwtSecret);
      if (!apikey || !['anon', 'service_role'].includes(apikey.role)) return err(res, 401, 'no_authorization', 'Invalid API key');
      const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      const claims = verifyJwt(bearer, jwtSecret);
      const M = req.method;

      // ---- 관리자 API (service_role 전용) ----
      if (p.startsWith('/admin/')) {
        if (!claims || claims.role !== 'service_role') return err(res, 403, 'not_admin', 'User not allowed');
        const idm = /^\/admin\/users\/([0-9a-f-]{36})$/.exec(p);
        if (p === '/admin/users' && M === 'POST') {
          const email = String(body.email || '').trim().toLowerCase();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(res, 422, 'validation_failed', 'Unable to validate email address: invalid format');
          if (String(body.password || '').length < MIN_PASSWORD) return err(res, 422, 'weak_password', `Password should be at least ${MIN_PASSWORD} characters.`);
          const dup = await sql`select 1 from auth.users where email = ${email}`;
          if (dup.length) return err(res, 422, 'email_exists', 'A user with this email address has already been registered');
          const [u] = await sql`insert into auth.users (email, encrypted_password, raw_user_meta_data)
            values (${email}, ${hashPassword(body.password)}, ${sql.json(body.user_metadata || {})}) returning *`;
          return ok(res, toUser(u));
        }
        if (idm && M === 'GET') {
          const [u] = await sql`select * from auth.users where id = ${idm[1]}`;
          return u ? ok(res, toUser(u)) : err(res, 404, 'user_not_found', 'User not found');
        }
        if (idm && M === 'PUT') {
          const [u0] = await sql`select * from auth.users where id = ${idm[1]}`;
          if (!u0) return err(res, 404, 'user_not_found', 'User not found');
          if (body.password !== undefined) {
            if (String(body.password).length < MIN_PASSWORD) return err(res, 422, 'weak_password', `Password should be at least ${MIN_PASSWORD} characters.`);
            await sql`update auth.users set encrypted_password = ${hashPassword(body.password)}, updated_at = now() where id = ${u0.id}`;
          }
          if (body.email) await sql`update auth.users set email = ${String(body.email).toLowerCase()}, updated_at = now() where id = ${u0.id}`;
          if (body.user_metadata) await sql`update auth.users set raw_user_meta_data = ${sql.json(body.user_metadata)} where id = ${u0.id}`;
          if (body.ban_duration !== undefined) {
            const until = parseBan(body.ban_duration);
            await sql`update auth.users set banned_until = ${until} where id = ${u0.id}`;
            if (until) await sql`update auth.refresh_tokens set revoked_at = now() where user_id = ${u0.id} and revoked_at is null`;
          }
          const [u] = await sql`select * from auth.users where id = ${u0.id}`;
          return ok(res, toUser(u));
        }
        if (idm && M === 'DELETE') {
          await sql`delete from auth.users where id = ${idm[1]}`;
          return ok(res, {});
        }
        return err(res, 404, 'not_found', 'Not found');
      }

      // ---- 로그인 / 토큰 갱신 ----
      if (p === '/token' && M === 'POST') {
        const grant = url.searchParams.get('grant_type');
        if (grant === 'password') {
          const [u] = await sql`select * from auth.users where email = ${String(body.email || '').trim().toLowerCase()}`;
          if (!u || !checkPassword(String(body.password || ''), u.encrypted_password)) return err(res, 400, 'invalid_credentials', 'Invalid login credentials');
          if (isBanned(u)) return err(res, 400, 'user_banned', 'User is banned');
          await sql`update auth.users set last_sign_in_at = now() where id = ${u.id}`;
          return ok(res, await issueSession(u));
        }
        if (grant === 'refresh_token') {
          const [t] = await sql`select * from auth.refresh_tokens where token = ${String(body.refresh_token || '')}`;
          // 회전된 토큰은 10초 이내 재사용만 허용 (동시 요청 대비)
          if (!t || (t.revoked_at && Date.now() - new Date(t.revoked_at).getTime() > 10_000)) return err(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
          const [u] = await sql`select * from auth.users where id = ${t.user_id}`;
          if (!u || isBanned(u)) return err(res, 400, 'user_banned', 'User is banned');
          await sql`update auth.refresh_tokens set revoked_at = now() where token = ${t.token} and revoked_at is null`;
          return ok(res, await issueSession(u, t.session_id));
        }
        return err(res, 400, 'unsupported_grant_type', 'unsupported grant type');
      }

      // ---- 비밀번호 재설정 메일 (메일 대신 outbox 폴더에 기록) ----
      if (p === '/recover' && M === 'POST') {
        const [u] = await sql`select * from auth.users where email = ${String(body.email || '').trim().toLowerCase()}`;
        if (u) {
          const tokenHash = crypto.randomBytes(28).toString('hex');
          await sql`insert into auth.one_time_tokens (token_hash, user_id, token_type, expires_at)
            values (${tokenHash}, ${u.id}, 'recovery', now() + interval '1 hour')`;
          const redirect = url.searchParams.get('redirect_to') || '';
          fs.mkdirSync(outboxDir, { recursive: true });
          fs.writeFileSync(path.join(outboxDir, `${Date.now()}-recovery.json`), JSON.stringify({
            to: u.email, type: 'recovery', redirect_to: redirect,
            link: `${redirect}${redirect.includes('?') ? '&' : '?'}token_hash=${tokenHash}&type=recovery`,
          }, null, 2));
        }
        return ok(res, {}); // 계정 존재 여부를 노출하지 않는다
      }
      if (p === '/verify' && M === 'POST') {
        const [t] = await sql`update auth.one_time_tokens set used_at = now()
          where token_hash = ${String(body.token_hash || '')} and token_type = ${String(body.type || '')}
            and used_at is null and expires_at > now() returning *`;
        if (!t) return err(res, 403, 'otp_expired', 'Email link is invalid or has expired');
        const [u] = await sql`select * from auth.users where id = ${t.user_id}`;
        if (!u || isBanned(u)) return err(res, 403, 'user_banned', 'User is banned');
        return ok(res, await issueSession(u));
      }

      // ---- 로그인 사용자 ----
      if (!claims || claims.role !== 'authenticated') return err(res, 401, 'bad_jwt', 'invalid JWT');
      const [me] = await sql`select * from auth.users where id = ${claims.sub}`;
      if (!me) return err(res, 403, 'user_not_found', 'User from sub claim in JWT does not exist');
      if (isBanned(me)) return err(res, 403, 'user_banned', 'User is banned');
      // 로그아웃된 세션의 access token 은 거부한다
      const live = await sql`select 1 from auth.refresh_tokens where session_id = ${claims.session_id} and (revoked_at is null or revoked_at > now() - interval '10 seconds') limit 1`;
      if (!live.length) return err(res, 403, 'session_not_found', 'Session from session_id claim in JWT does not exist');

      if (p === '/user' && M === 'GET') return ok(res, toUser(me));
      if (p === '/user' && M === 'PUT') {
        if (body.password !== undefined) {
          if (String(body.password).length < MIN_PASSWORD) return err(res, 422, 'weak_password', `Password should be at least ${MIN_PASSWORD} characters.`);
          if (checkPassword(String(body.password), me.encrypted_password)) return err(res, 422, 'same_password', 'New password should be different from the old password.');
          await sql`update auth.users set encrypted_password = ${hashPassword(body.password)}, updated_at = now() where id = ${me.id}`;
        }
        if (body.data) await sql`update auth.users set raw_user_meta_data = raw_user_meta_data || ${sql.json(body.data)} where id = ${me.id}`;
        const [u] = await sql`select * from auth.users where id = ${me.id}`;
        return ok(res, toUser(u));
      }
      if (p === '/logout' && M === 'POST') {
        const scope = url.searchParams.get('scope') || 'global';
        if (scope === 'global') await sql`update auth.refresh_tokens set revoked_at = now() - interval '1 minute' where user_id = ${me.id}`;
        else if (scope === 'others') await sql`update auth.refresh_tokens set revoked_at = now() - interval '1 minute' where user_id = ${me.id} and session_id <> ${claims.session_id}`;
        else await sql`update auth.refresh_tokens set revoked_at = now() - interval '1 minute' where session_id = ${claims.session_id}`;
        res.writeHead(204); return res.end();
      }
      return err(res, 404, 'not_found', 'Not found');
    } catch (e) {
      console.error('[auth] 오류:', e.message);
      return err(res, 500, 'unexpected_failure', 'Internal error');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
