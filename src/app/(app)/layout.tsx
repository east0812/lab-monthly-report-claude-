import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { Shell } from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  const [info] = await withUser(me.id, (tx) => tx`
    select (select count(*) from notifications where user_id = ${me.id} and not is_read) as unread,
           coalesce((select value from app_settings where key = 'lab_name'), '') as lab_name`);
  return (
    <Shell me={me} labName={info.lab_name} unread={info.unread}>
      {children}
    </Shell>
  );
}
