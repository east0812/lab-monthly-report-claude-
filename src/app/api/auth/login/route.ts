import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer, authErrorMessage, REMEMBER_COOKIE, RECOVERY_COOKIE, cookieSecure } from '@/lib/supabase';
import { sameOrigin, errorResponse, readJson } from '@/lib/auth';
import { withUser, HttpError } from '@/lib/db';
import { tooMany, clearHits } from '@/lib/ratelimit';

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) throw new HttpError(403, '허용되지 않은 요청입니다.');
    const body = await readJson(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const remember = body.remember !== false;
    if (!email || !password) throw new HttpError(400, '이메일과 비밀번호를 입력해 주세요.');
    const limitKey = `login:${email}`;
    if (tooMany(limitKey, 10, 5 * 60_000)) throw new HttpError(429, '로그인 시도가 너무 많습니다. 5분 뒤에 다시 시도해 주세요.');

    const supabase = await supabaseServer({ remember });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) throw new HttpError(401, authErrorMessage(error));

    // 비활성·미등록 계정은 세션을 만들지 않는다.
    const uid = data.user.id;
    const rows = await withUser(uid, (tx) => tx`select 1 from profiles where id = ${uid}`);
    if (!rows.length) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new HttpError(403, '사용이 중지되었거나 등록되지 않은 계정입니다. 관리자에게 문의해 주세요.');
    }
    clearHits(limitKey);
    const store = await cookies();
    store.set(REMEMBER_COOKIE, remember ? '1' : '0', {
      httpOnly: true, sameSite: 'lax', path: '/', secure: cookieSecure(), ...(remember ? { maxAge: 400 * 24 * 3600 } : {}),
    });
    store.delete(RECOVERY_COOKIE);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
