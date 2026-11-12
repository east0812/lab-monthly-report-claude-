// 관리자가 직원 비밀번호를 재설정한다. 응답은 { ok: true } 뿐이며 비밀번호는 어디에도 기록하지 않는다.
import { route, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { supabaseAdmin, authErrorMessage } from '@/lib/supabase';
import { uuid, validateAdminPassword } from '@/lib/validate';

export const POST = route({ admin: true }, async ({ db, req, params }) => {
  const id = uuid(params.id, '직원');
  const body = await readJson(req);
  const password = validateAdminPassword(body.password, body.confirm);

  const rows = await db((tx) => tx`select 1 from profiles where id = ${id}`);
  if (!rows.length) throw new HttpError(404, '직원을 찾을 수 없습니다.');

  const { error } = await supabaseAdmin().auth.admin.updateUserById(id, { password });
  if (error) {
    const policy = error.code === 'weak_password' || /password should/i.test(error.message ?? '');
    throw new HttpError(policy ? 400 : 502, authErrorMessage(error));
  }
  return { ok: true };
});
