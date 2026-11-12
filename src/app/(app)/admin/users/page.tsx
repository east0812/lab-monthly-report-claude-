// 직원 관리 (관리자 전용)
import { requireAdmin } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { UsersManager, type UserRow } from '@/components/admin/UsersManager';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const me = await requireAdmin();
  const rows = await withUser(me.id, (tx) => tx`
    select id, email, name, role, is_active, created_at
    from profiles order by is_active desc, name, email`);
  return <UsersManager users={rows.map((r) => ({ ...r })) as UserRow[]} meId={me.id} />;
}
