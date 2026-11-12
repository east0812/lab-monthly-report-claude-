// 로컬 검증 스택: 내장 PostgreSQL(실제 PostgreSQL 바이너리) + Supabase Auth 호환 서버.
// Docker 없이 이 PC 에서 앱 전체 흐름을 검증하기 위한 용도이며 운영용이 아니다.
//   npm run local:stack
// 데이터와 키는 .local-stack/ 에 저장된다 (git 제외). 초기화하려면 폴더를 지우면 된다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { ROOT, applyMigrations } from '../../scripts/lib.mjs';
import { startAuthServer, signJwt } from './auth-server.mjs';

const DIR = path.join(ROOT, '.local-stack');
const PG_DIR = path.join(DIR, 'pg');
const KEYS = path.join(DIR, 'keys.json');
const PG_PORT = Number(process.env.LOCAL_PG_PORT || 54322);
const AUTH_PORT = Number(process.env.LOCAL_AUTH_PORT || 54321);
fs.mkdirSync(DIR, { recursive: true });

// 1) 로컬 전용 키 (처음 한 번 무작위 생성)
let keys;
if (fs.existsSync(KEYS)) keys = JSON.parse(fs.readFileSync(KEYS, 'utf8'));
else {
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;
  keys = {
    jwtSecret,
    dbPassword: crypto.randomBytes(12).toString('hex'),
    anonKey: signJwt({ iss: 'local-stack', role: 'anon', exp }, jwtSecret),
    serviceKey: signJwt({ iss: 'local-stack', role: 'service_role', exp }, jwtSecret),
  };
  fs.writeFileSync(KEYS, JSON.stringify(keys, null, 2));
}

// 2) PostgreSQL 바이너리 위치 (embedded-postgres 패키지가 내려받은 공식 빌드)
function nativeDir() {
  if (process.env.LOCAL_PG_NATIVE_DIR) return process.env.LOCAL_PG_NATIVE_DIR;
  const plat = { win32: 'windows-x64', linux: `linux-${process.arch}`, darwin: `darwin-${process.arch}` }[process.platform];
  const pkgDir = path.join(ROOT, 'node_modules', '@embedded-postgres', plat);
  if (!fs.existsSync(pkgDir)) { console.error('[local-stack] npm install 을 먼저 실행해 주세요 (embedded-postgres 없음).'); process.exit(1); }
  let dir = path.join(pkgDir, 'native');
  // Windows 경로 길이(260자) 제한에 걸리면 짧은 임시 폴더로 복사해서 쓴다.
  if (process.platform === 'win32' && path.join(dir, 'share', 'timezonesets', 'Australia.txt').length > 200) {
    const ver = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
    const short = path.join(os.tmpdir(), `labreport-pg-${ver}`);
    if (!fs.existsSync(path.join(short, 'bin', 'postgres.exe'))) {
      console.log(`[local-stack] 프로젝트 경로가 길어 PostgreSQL 바이너리를 ${short} 로 복사합니다.`);
      fs.cpSync(dir, short, { recursive: true });
    }
    dir = short;
  }
  return dir;
}
const BIN = path.join(nativeDir(), 'bin');
const exe = (n) => path.join(BIN, process.platform === 'win32' ? `${n}.exe` : n);

if (!fs.existsSync(path.join(PG_DIR, 'PG_VERSION'))) {
  const pw = path.join(DIR, 'pw.tmp');
  fs.writeFileSync(pw, keys.dbPassword);
  const r = spawnSync(exe('initdb'), ['-D', PG_DIR, '-U', 'postgres', `--pwfile=${pw}`, '-A', 'scram-sha-256', '--encoding=UTF8', '--locale=C'], { encoding: 'utf8' });
  fs.rmSync(pw, { force: true });
  if (r.status !== 0) { console.error('[local-stack] initdb 실패:\n' + (r.stderr || r.stdout)); process.exit(1); }
}
// 이전 실행이 비정상 종료되어 남은 서버가 있으면 정리
if (fs.existsSync(path.join(PG_DIR, 'postmaster.pid'))) spawnSync(exe('pg_ctl'), ['stop', '-D', PG_DIR, '-m', 'fast', '-w'], { encoding: 'utf8' });

const pgProc = spawn(exe('postgres'), ['-D', PG_DIR, '-p', String(PG_PORT), '-c', 'listen_addresses=127.0.0.1'], { stdio: ['ignore', 'ignore', 'pipe'] });
pgProc.stderr.on('data', (d) => { const s = String(d); if (/FATAL|PANIC/.test(s)) console.error('[pg]', s.trim()); });
pgProc.on('exit', (code) => { if (!stopping) { console.error(`[local-stack] PostgreSQL 이 종료되었습니다 (code ${code}).`); process.exit(1); } });

const url = (db) => `postgres://postgres:${keys.dbPassword}@127.0.0.1:${PG_PORT}/${db}`;
let stopping = false;
{
  const boot = postgres(url('postgres'), { max: 1, onnotice: () => {}, connect_timeout: 3 });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    try { await boot`select 1`; ready = true; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!ready) { console.error('[local-stack] PostgreSQL 에 연결할 수 없습니다.'); process.exit(1); }
  const has = await boot`select 1 from pg_database where datname = 'labreport'`;
  if (!has.length) await boot.unsafe('create database labreport');
  await boot.end();
}
const dbUrl = url('labreport');
const sql = postgres(dbUrl, { max: 5, onnotice: () => {} });

await sql.unsafe(fs.readFileSync(path.join(ROOT, 'dev/local-stack/bootstrap.sql'), 'utf8'));
console.log('[local-stack] 마이그레이션 확인');
await applyMigrations(sql, (m) => console.log(m));

// 3) Auth 호환 서버
await startAuthServer({ sql, port: AUTH_PORT, jwtSecret: keys.jwtSecret, outboxDir: path.join(DIR, 'outbox') });

// 4) .env.local 이 없을 때만 로컬 검증용 값으로 만들어 준다 (기존 파일은 건드리지 않음)
const envText = `# 로컬 검증 스택용 설정 (npm run local:stack 이 생성). 운영 값이 아닙니다.
SUPABASE_URL=http://127.0.0.1:${AUTH_PORT}
SUPABASE_ANON_KEY=${keys.anonKey}
SUPABASE_SERVICE_ROLE_KEY=${keys.serviceKey}
DATABASE_URL=${dbUrl}
APP_BASE_URL=http://localhost:3000
ATTACHMENT_DIR=./data/attachments
PASSWORD_RESET_EMAIL_ENABLED=true
ALLOW_DEMO_SEED=true
`;
fs.writeFileSync(path.join(DIR, 'env.local-stack'), envText);
const envLocal = path.join(ROOT, '.env.local');
if (!fs.existsSync(envLocal)) {
  fs.writeFileSync(envLocal, envText);
  console.log('[local-stack] .env.local 을 로컬 검증용 값으로 생성했습니다.');
}
console.log(`[local-stack] 준비 완료  PostgreSQL :${PG_PORT}  Auth :${AUTH_PORT}  (종료: Ctrl+C)`);

async function stop() {
  if (stopping) return; stopping = true;
  try { await sql.end({ timeout: 2 }); } catch {}
  spawnSync(exe('pg_ctl'), ['stop', '-D', PG_DIR, '-m', 'fast', '-w'], { encoding: 'utf8' });
  process.exit(0);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('SIGBREAK', stop);
