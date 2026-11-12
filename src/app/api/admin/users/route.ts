// 직원 관리: 목록 조회, 직원 등록 (관리자 전용)
// 비밀번호는 Supabase Auth 로만 전달하며 응답·로그·DB 어디에도 남기지 않는다.
import { route, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { supabaseAdmin, authErrorMessage } from '@/lib/supabase';
import { emailStr, reqStr, oneOf, validateAdminPassword } from '@/lib/validate';

const ROLES = ['employee', 'admin'] as const;

function authStatus(e: { code?: string; message?: string } | null | undefined): number {
  const code = e?.code ?? '';
  if (code === 'email_exists' || code === 'user_already_exists' || /already been registered/i.test(e?.message ?? '')) return 409;
  if (code === 'weak_password' || code === 'validation_failed' || code === 'email_address_invalid' || /password should/i.test(e?.message ?? '')) return 400;
  return 502;
}

export const GET = route({ admin: true }, async ({ db }) => {
  const users = await db((tx) => tx`
    select id, email, name, role, is_active, created_at, updated_at
    from profiles order by is_active desc, name, email`);
  return { users };
});

export const POST = route({ admin: true }, async ({ db, req }) => {
  const body = await readJson(req);
  const email = emailStr(body.email);
  const name = reqStr(body.name, 50, '이름');
  const role = oneOf(body.role ?? 'employee', ROLES, '역할');
  const password = validateAdminPassword(body.password, body.confirm);

  const dup = await db((tx) => tx`select 1 from profiles where lower(email) = ${email}`);
  if (dup.length) throw new HttpError(409, '이미 등록된 이메일입니다.');

  // 1) Supabase Auth 계정 생성 (서비스 키는 이 호출에만 사용)
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (error || !data?.user) throw new HttpError(authStatus(error), authErrorMessage(error));
  const uid = data.user.id;

  // 2) 프로필 등록 (관리자 RLS). 실패하면 방금 만든 Auth 계정을 되돌린다.
  try {
    const [u] = await db((tx) => tx`
      insert into profiles (id, email, name, role) values (${uid}, ${email}, ${name}, ${role})
      returning id, email, name, role, is_active, created_at, updated_at`);
    return { user: u };
  } catch (e) {
    try {
      const { error: de } = await admin.auth.admin.deleteUser(uid);
      if (de) console.error('[admin/users] 계정 생성 되돌리기 실패:', de.code ?? '');
    } catch {
      console.error('[admin/users] 계정 생성 되돌리기 실패');
    }
    throw e;
  }
});
