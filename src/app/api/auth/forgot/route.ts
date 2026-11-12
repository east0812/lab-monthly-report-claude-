// 직원 이메일 비밀번호 재설정 요청.
// Custom SMTP·Redirect URL 설정 후 PASSWORD_RESET_EMAIL_ENABLED=true 일 때만 동작한다.
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseStateless } from '@/lib/supabase';
import { sameOrigin, errorResponse, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { tooMany, emailResetEnabled } from '@/lib/ratelimit';
import { emailStr } from '@/lib/validate';

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) throw new HttpError(403, '허용되지 않은 요청입니다.');
    if (!emailResetEnabled()) throw new HttpError(400, '이메일 재설정 기능이 설정되지 않았습니다. 관리자에게 비밀번호 재설정을 요청해 주세요.');
    const body = await readJson(req);
    const email = emailStr(body.email);
    if (tooMany(`forgot:${email}`, 3, 10 * 60_000)) throw new HttpError(429, '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    const base = process.env.APP_BASE_URL!.replace(/\/+$/, '');
    const { error } = await supabaseStateless().auth.resetPasswordForEmail(email, { redirectTo: `${base}/auth/confirm` });
    if (error && (error.status === 429 || /rate/i.test(error.code ?? ''))) throw new HttpError(429, '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    // 계정 존재 여부는 알려 주지 않는다.
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
