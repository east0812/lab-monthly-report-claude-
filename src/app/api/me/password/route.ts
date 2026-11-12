// 본인 비밀번호 변경: 현재 비밀번호 확인 → 새 비밀번호(12자 이상) 저장.
// 비밀번호는 Supabase Auth 로만 전달하며 응답·로그에 남기지 않는다.
import { route, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { supabaseServer, supabaseStateless, authErrorMessage } from '@/lib/supabase';
import { tooMany, clearHits } from '@/lib/ratelimit';
import { validateSelfPassword } from '@/lib/validate';

export const POST = route({}, async ({ req, user }) => {
  const body = await readJson(req);
  const current = typeof body.current === 'string' ? body.current : '';
  if (!current) throw new HttpError(400, '현재 비밀번호를 입력해 주세요.');
  const password = validateSelfPassword(body.password, body.confirm);
  if (password === current) throw new HttpError(400, '이전과 다른 비밀번호를 입력해 주세요.');

  const limitKey = `me-password:${user.id}`;
  if (tooMany(limitKey, 5, 5 * 60_000)) throw new HttpError(429, '비밀번호 변경 시도가 너무 많습니다. 5분 뒤에 다시 시도해 주세요.');

  // 1) 현재 비밀번호 확인 (쿠키와 무관한 일회성 클라이언트)
  const probe = supabaseStateless();
  const { data, error: ve } = await probe.auth.signInWithPassword({ email: user.email, password: current });
  if (ve || !data?.user || data.user.id !== user.id) {
    const wrong = !ve || ve.code === 'invalid_credentials' || /invalid login credentials/i.test(ve.message ?? '');
    throw new HttpError(400, wrong ? '현재 비밀번호가 올바르지 않습니다.' : authErrorMessage(ve));
  }
  await probe.auth.signOut({ scope: 'local' }).catch(() => {});

  // 2) 로그인 세션으로 새 비밀번호 저장
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new HttpError(400, authErrorMessage(error));

  // 다른 기기에 남아 있는 세션은 종료한다(현재 세션은 유지). 실패해도 변경은 완료된 상태다.
  await supabase.auth.signOut({ scope: 'others' }).catch(() => {});
  clearHits(limitKey);
  return { ok: true };
});
