// 재설정 전용 세션으로 새 비밀번호 저장. 저장 후 모든 세션을 종료하고 다시 로그인하게 한다.
import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseStateless, authErrorMessage, RECOVERY_COOKIE } from '@/lib/supabase';
import { sameOrigin, errorResponse, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { validateSelfPassword } from '@/lib/validate';

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) throw new HttpError(403, '허용되지 않은 요청입니다.');
    const store = await cookies();
    let tok: { a?: string; r?: string } = {};
    try { tok = JSON.parse(store.get(RECOVERY_COOKIE)?.value ?? '{}'); } catch {}
    if (!tok.a || !tok.r) throw new HttpError(401, '재설정 링크가 만료되었습니다. 다시 요청해 주세요.');
    const body = await readJson(req);
    const password = validateSelfPassword(body.password, body.confirm);

    const client = supabaseStateless();
    const { error: se } = await client.auth.setSession({ access_token: tok.a, refresh_token: tok.r });
    if (se) {
      store.delete(RECOVERY_COOKIE);
      throw new HttpError(401, '재설정 링크가 만료되었습니다. 다시 요청해 주세요.');
    }
    const { error } = await client.auth.updateUser({ password });
    if (error) throw new HttpError(400, authErrorMessage(error));
    await client.auth.signOut({ scope: 'global' }).catch(() => {});
    store.delete(RECOVERY_COOKIE);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
