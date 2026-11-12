// 첫 관리자 계정 만들기 (운영 설치 시 1회).  npm run admin:create
// 비밀번호는 화면에 표시하지 않고, 어디에도 기록하지 않는다.
import readline from 'node:readline';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './lib.mjs';

loadEnv();
requireEnv('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL');

function ask(q, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(q); else if (s === '\r\n' || s === '\n') rl.output.write('\n'); };
    }
    rl.question(q, (a) => { rl.close(); resolve(a.trim()); });
  });
}

const email = (await ask('관리자 이메일: ')).toLowerCase();
const name = await ask('이름: ');
const pw = await ask('비밀번호 (6자 이상, 입력 내용은 표시되지 않음): ', true);
const pw2 = await ask('비밀번호 확인: ', true);
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) { console.error('이메일 또는 이름이 올바르지 않습니다.'); process.exit(1); }
if (pw.length < 6 || pw !== pw2) { console.error('비밀번호는 6자 이상이어야 하고 확인 값과 같아야 합니다.'); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
try {
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { name } });
  if (error) throw new Error(error.message);
  try {
    await sql`insert into public.profiles (id, email, name, role, is_active) values (${data.user.id}, ${email}, ${name}, 'admin', true)`;
  } catch (e) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw e;
  }
  console.log(`관리자 계정을 만들었습니다: ${email}`);
} catch (e) {
  console.error('생성 실패:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
