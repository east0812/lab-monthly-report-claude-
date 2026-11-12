// 직원 개인 보고서 출력 (작성자 본인 또는 관리자만. RLS 로 판정)
import { route } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { uuid } from '@/lib/validate';
import { personalExport } from '@/lib/export/data';
import { exportResponse } from '@/lib/export/respond';

export const GET = route({}, async ({ params, req, db }) => {
  const id = uuid(params.id);
  const data = await db((tx) => personalExport(tx, id));
  if (!data) throw new HttpError(404, '보고서를 찾을 수 없습니다.');
  return exportResponse(data, req.nextUrl.searchParams);
});
