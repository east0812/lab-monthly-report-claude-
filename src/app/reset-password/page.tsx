import Link from 'next/link';
import { cookies } from 'next/headers';
import { withAnon } from '@/lib/db';
import { RECOVERY_COOKIE } from '@/lib/supabase';
import { AuthCard, ResetForm } from '@/components/AuthForms';

export const dynamic = 'force-dynamic';

export default async function ResetPage() {
  const has = !!(await cookies()).get(RECOVERY_COOKIE)?.value;
  const [n] = await withAnon((tx) => tx`select lab_name from login_notice()`).catch(() => [{ lab_name: '' }]);
  return (
    <AuthCard title="새 비밀번호 설정" labName={n?.lab_name ?? ''}>
      {has ? <ResetForm /> : (
        <div className="space-y-3 text-sm text-slate-700">
          <p>재설정 링크가 만료되었거나 이미 사용되었습니다.</p>
          <Link href="/forgot-password" className="text-blue-700 hover:underline">재설정 다시 요청하기</Link>
        </div>
      )}
    </AuthCard>
  );
}
