import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { loadReport } from '@/lib/reports';
import { listProducts, listCategories } from '@/lib/data';
import { ReportView } from '@/components/reports/ReportView';

export const dynamic = 'force-dynamic';

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await requireUser();
  const res = await withUser(me.id, async (tx) => {
    const data = await loadReport(tx, id);
    if (!data) return null;
    return { data, products: await listProducts(tx), categories: await listCategories(tx) };
  });
  if (!res) notFound(); // 없거나 볼 권한이 없는 보고서
  return <ReportView data={res.data} me={{ id: me.id, role: me.role }} products={res.products} categories={res.categories} />;
}
