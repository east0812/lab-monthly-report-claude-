// Supabase Auth 클라이언트 (서버 전용). 브라우저는 Supabase 와 직접 통신하지 않는다.
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export const REMEMBER_COOKIE = 'mr_remember';
export const RECOVERY_COOKIE = 'mr_recovery';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 설정되지 않았습니다.`);
  return v;
}

export const cookieSecure = () => process.env.COOKIE_SECURE === 'true';

type CookieOpts = Record<string, unknown> & { maxAge?: number; expires?: Date };

/** 로그인 유지를 끄면 브라우저 종료 시 사라지는 세션 쿠키로 저장한다. */
export function sessionCookieOptions(options: CookieOpts | undefined, remember: boolean, value: string): CookieOpts {
  const o: CookieOpts = { ...(options ?? {}), httpOnly: true, sameSite: 'lax', path: '/', secure: cookieSecure() };
  if (!remember && value) {
    delete o.maxAge;
    delete o.expires;
  }
  return o;
}

/** 요청 쿠키에 연결된 Supabase 클라이언트 (Route Handler / Server Component) */
export async function supabaseServer(opts?: { remember?: boolean }): Promise<SupabaseClient> {
  const store = await cookies();
  const remember = opts?.remember ?? store.get(REMEMBER_COOKIE)?.value !== '0';
  return createServerClient(need('SUPABASE_URL'), need('SUPABASE_ANON_KEY'), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, sessionCookieOptions(options as CookieOpts, remember, value));
        } catch {
          // Server Component 에서는 쿠키를 쓸 수 없다. 토큰 갱신은 proxy 가 담당한다.
        }
      },
    },
  }) as unknown as SupabaseClient;
}

/** 쿠키와 무관한 일회성 클라이언트 (현재 비밀번호 확인, 재설정 세션 등) */
export function supabaseStateless(): SupabaseClient {
  return createClient(need('SUPABASE_URL'), need('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** 서비스 키 클라이언트: 직원 계정 생성·비밀번호 재설정 등 관리자 Auth API 전용 */
export function supabaseAdmin(): SupabaseClient {
  return createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Supabase Auth 오류를 한국어 안내로 바꾼다. 비밀번호 등 입력값은 포함하지 않는다. */
export function authErrorMessage(e: { code?: string; message?: string; status?: number } | null | undefined): string {
  const code = e?.code ?? '';
  const msg = e?.message ?? '';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (code === 'user_banned') return '사용이 중지된 계정입니다. 관리자에게 문의해 주세요.';
  if (code === 'weak_password' || /password should/i.test(msg)) return 'Supabase 계정 보안 정책에 맞지 않는 비밀번호입니다. 더 길고 복잡한 비밀번호를 사용해 주세요.';
  if (code === 'same_password') return '이전과 다른 비밀번호를 입력해 주세요.';
  if (code === 'email_exists' || code === 'user_already_exists' || /already been registered/i.test(msg)) return '이미 등록된 이메일입니다.';
  if (code === 'email_address_invalid' || code === 'validation_failed') return '이메일 형식이 올바르지 않습니다.';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  if (code === 'otp_expired') return '링크가 만료되었거나 이미 사용되었습니다. 다시 요청해 주세요.';
  if (code === 'reauthentication_needed') return '보안을 위해 다시 로그인한 뒤 시도해 주세요.';
  return '인증 서버 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}
