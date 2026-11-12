// 내 정보 조회, 이름 변경
import { route, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { reqStr } from '@/lib/validate';

export const GET = route({}, async ({ user }) => {
  return { me: { id: user.id, email: user.email, name: user.name, role: user.role } };
});

export const PATCH = route({}, async ({ db, req, user }) => {
  const body = await readJson(req);
  const name = reqStr(body.name, 50, '이름');
  // 본인 행만 수정한다. 역할·활성 상태·이메일은 여기서 바꾸지 않는다(DB 트리거도 차단).
  const [me] = await db((tx) => tx`
    update profiles set name = ${name} where id = ${user.id}
    returning id, email, name, role`);
  if (!me) throw new HttpError(404, '계정을 찾을 수 없습니다.');
  return { me };
});
