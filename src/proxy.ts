// 모든 페이지 요청에서 Supabase 세션을 확인·갱신하고, 비로그인 사용자를 로그인 화면으로 보낸다.
// (권한 검사는 여기서 끝나지 않는다. 각 페이지·API·DB(RLS)에서 다시 검사한다.)
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC = ['/login', '/forgot-password', '/reset-password', '/auth/confirm', '/api/auth/login', '/api/auth/forgot', '/api/auth/reset'];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p + '/'));
  let response = NextResponse.next({ request });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    if (isPublic) return response;
    return new NextResponse('서버 환경변수(SUPABASE_URL, SUPABASE_ANON_KEY)가 설정되지 않았습니다. 설치 안내를 확인해 주세요.', { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const remember = request.cookies.get('mr_remember')?.value !== '0';
  const secure = process.env.COOKIE_SECURE === 'true';
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) {
          const o: Record<string, unknown> = { ...options, httpOnly: true, sameSite: 'lax', path: '/', secure };
          if (!remember && value) { delete o.maxAge; delete o.expires; }
          response.cookies.set(name, value, o);
        }
      },
    },
  });

  let loggedIn = false;
  try {
    const { data } = await supabase.auth.getUser();
    loggedIn = !!data.user;
  } catch {
    loggedIn = false;
  }

  if (!loggedIn && !isPublic) {
    if (path.startsWith('/api/')) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    const to = request.nextUrl.clone();
    to.pathname = '/login';
    to.search = path && path !== '/' ? `?next=${encodeURIComponent(path + request.nextUrl.search)}` : '';
    return NextResponse.redirect(to);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
