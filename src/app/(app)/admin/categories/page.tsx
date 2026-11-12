// 업무분류 관리 (관리자 전용)
import { requireAdmin } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { listCategories } from '@/lib/data';
import { CategoriesManager } from '@/components/admin/CategoriesManager';

export const dynamic = 'force-dynamic';

export default async function AdminCategoriesPage() {
  const me = await requireAdmin();
  const categories = await withUser(me.id, (tx) => listCategories(tx, true));
  return <CategoriesManager categories={categories.map((c) => ({ ...c }))} />;
}
