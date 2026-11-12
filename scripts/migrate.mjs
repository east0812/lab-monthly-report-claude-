// DATABASE_URL 로 연결해 supabase/migrations 의 SQL 을 적용한다.
// 사용: npm run db:migrate
import postgres from 'postgres';
import { loadEnv, requireEnv, applyMigrations } from './lib.mjs';

loadEnv();
requireEnv('DATABASE_URL');
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
try {
  console.log('마이그레이션 적용 중...');
  await applyMigrations(sql);
  console.log('완료');
} catch (e) {
  console.error('마이그레이션 실패:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
