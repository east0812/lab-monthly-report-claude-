// 직원 수정: 이름·역할·활성 상태 (관리자 전용)
import { route, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { supabaseAdmin } from '@/lib/supabase';
import { reqStr, oneOf, uuid } from '@/lib/validate';

const ROLES = ['employee', 'admin'] as const;

export const PATCH = route({ admin: true }, async ({ db, req, params, user }) => {
  const id = uuid(params.id, '직원');
  const body = await readJson(req);
  const patch: { name?: string; role?: (typeof ROLES)[number]; is_active?: boolean } = {};
  if (body.name !== undefined) patch.name = reqStr(body.name, 50, '이름');
  if (body.role !== undefined) patch.role = oneOf(body.role, ROLES, '역할');
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') throw new HttpError(400, '활성 상태: 값이 올바르지 않습니다.');
    patch.is_active = body.is_active;
  }
  if (!Object.keys(patch).length) throw new HttpError(400, '변경할 내용이 없습니다.');

  const result = await db(async (tx) => {
    const [cur] = await tx`select id, name, role, is_active from profiles where id = ${id} for update`;
    if (!cur) throw new HttpError(404, '직원을 찾을 수 없습니다.');
    const name = patch.name ?? (cur.name as string);
    const role = patch.role ?? (cur.role as string);
    const active = patch.is_active ?? (cur.is_active as boolean);
    // DB 트리거도 막지만, 먼저 알기 쉬운 안내를 준다.
    if (id === user.id && (role !== cur.role || active !== cur.is_active)) {
      throw new HttpError(400, '본인의 역할과 활성 상태는 변경할 수 없습니다. 다른 관리자에게 요청해 주세요.');
    }
    const [u] = await tx`
      update profiles set name = ${name}, role = ${role}, is_active = ${active} where id = ${id}
      returning id, email, name, role, is_active, created_at, updated_at`;
    return { user: u, activeChanged: active !== cur.is_active, active };
  });

  // 로그인 차단의 기준은 DB 의 is_active 이다. Auth 계정 잠금은 보조 수단(실패해도 저장은 유지).
  let authSynced = true;
  if (result.activeChanged) {
    try {
      const { error } = await supabaseAdmin().auth.admin.updateUserById(id, { ban_duration: result.active ? 'none' : '876000h' });
      if (error) { authSynced = false; console.error('[admin/users] Auth 계정 잠금 상태 변경 실패:', error.code ?? ''); }
    } catch {
      authSynced = false;
      console.error('[admin/users] Auth 계정 잠금 상태 변경 실패');
    }
  }
  return { user: result.user, auth_synced: authSynced };
});
