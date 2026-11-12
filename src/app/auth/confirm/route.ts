// 비밀번호 재설정 메일의 링크가 도착하는 곳.
// 링크의 일회용 토큰을 검증하고, 일반 로그인 세션과 분리된 "재설정 전용 세션"(10분)을 만든다.
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseStateless, RECOVERY_COOKIE, cookieSecure } from '@/lib/supabase';
import { withUser } from '@/lib/db';

export async function GET(req: NextRequest) {
  const base = (process.env.APP_BASE_URL || req.nextUrl.origin).replace(/\/+$/, '');
  const fail = () => NextResponse.redirect(`${base}/forgot-password?error=expired`);
  const tokenHash = req.nextUrl.searchParams.get('token_hash');
  const type = req.nextUrl.searchParams.get('type');
  if (!tokenHash || type !== 'recovery') return fail();
  try {
    const { data, error } = await supabaseStateless().auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
    if (error || !data.session || !data.user) return fail();
    const uid = data.user.id;
    const rows = await withUser(uid, (tx) => tx`select 1 from profiles where id = ${uid}`);
    if (!rows.length) return fail(); // 비활성 계정
    const res = NextResponse.redirect(`${base}/reset-password`);
    res.cookies.set(RECOVERY_COOKIE, JSON.stringify({ a: data.session.access_token, r: data.session.refresh_token }), {
      httpOnly: true, sameSite: 'lax', path: '/', secure: cookieSecure(), maxAge: 600,
    });
    return res;
  } catch {
    return fail();
  }
}
