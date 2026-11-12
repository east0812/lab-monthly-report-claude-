import { withAnon } from '@/lib/db';
import { emailResetEnabled } from '@/lib/ratelimit';
import { AuthCard, ForgotForm } from '@/components/AuthForms';

export const dynamic = 'force-dynamic';

export default async function ForgotPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const [n] = await withAnon((tx) => tx`select lab_name, admin_contact from login_notice()`).catch(() => [{ lab_name: '', admin_contact: '' }]);
  return (
    <AuthCard title="비밀번호를 잊으셨나요?" labName={n?.lab_name ?? ''}>
      <ForgotForm enabled={emailResetEnabled()} contact={n?.admin_contact ?? ''} expired={sp.error === 'expired'} />
    </AuthCard>
  );
}
