import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { withAnon } from '@/lib/db';
import { AuthCard, LoginForm } from '@/components/AuthForms';

export const dynamic = 'force-dynamic';

/** 로그인 후 이동할 내부 경로만 허용 (외부 주소로의 리다이렉트 방지) */
function safeNext(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') && !s.startsWith('/api/') ? s : '/dashboard';
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getSessionUser()) redirect(next);
  const [n] = await withAnon((tx) => tx`select lab_name from login_notice()`).catch(() => [{ lab_name: '' }]);
  return (
    <AuthCard title="로그인" labName={n?.lab_name ?? ''}>
      <LoginForm next={next} notice={sp.reset ? '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.' : undefined} />
    </AuthCard>
  );
}
