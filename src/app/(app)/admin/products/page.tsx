// 제품 관리 (관리자 전용)
import { requireAdmin } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { listProducts } from '@/lib/data';
import { ProductsManager } from '@/components/admin/ProductsManager';

export const dynamic = 'force-dynamic';

export default async function AdminProductsPage() {
  const me = await requireAdmin();
  const products = await withUser(me.id, (tx) => listProducts(tx, true));
  return <ProductsManager products={products.map((p) => ({ ...p }))} />;
}
