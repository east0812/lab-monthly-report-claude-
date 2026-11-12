// 내 정보
import { requireUser } from '@/lib/auth';
import { MeForms } from './MeForms';

export const dynamic = 'force-dynamic';

export default async function MePage() {
  const me = await requireUser();
  return <MeForms me={{ email: me.email, name: me.name, role: me.role }} />;
}
