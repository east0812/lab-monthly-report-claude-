// 관리자 월별 전체 취합 출력
import { route } from '@/lib/auth';
import { int } from '@/lib/validate';
import { compileExport } from '@/lib/export/data';
import { exportResponse } from '@/lib/export/respond';

export const GET = route({ admin: true }, async ({ req, db }) => {
  const sp = req.nextUrl.searchParams;
  const year = int(sp.get('year'), 2000, 2100, '연도');
  const month = int(sp.get('month'), 1, 12, '월');
  const data = await db((tx) => compileExport(tx, year, month));
  return exportResponse(data, sp);
});
