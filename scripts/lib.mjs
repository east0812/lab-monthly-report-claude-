// 스크립트 공용: .env 로딩, 마이그레이션 적용
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** .env.local (또는 지정 파일)을 읽어 process.env 에 없는 값만 채운다. */
export function loadEnv(file = '.env.local') {
  const p = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (!fs.existsSync(p)) return false;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
  return true;
}

export function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.error(`환경변수가 비어 있습니다: ${missing.join(', ')}\n.env.local 을 확인해 주세요.`);
    process.exit(1);
  }
}

/** supabase/migrations/*.sql 을 파일명 순서로 한 번씩만 적용한다. */
export async function applyMigrations(sql, log = console.log) {
  await sql`create table if not exists public._app_migrations (
    name text primary key, applied_at timestamptz not null default now())`;
  await sql`alter table public._app_migrations enable row level security`;
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await sql`select name from public._app_migrations`).map((r) => r.name));
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into public._app_migrations (name) values (${f})`;
    });
    log(`  적용: ${f}`);
    applied++;
  }
  if (!applied) log('  새로 적용할 마이그레이션이 없습니다.');
  return applied;
}
