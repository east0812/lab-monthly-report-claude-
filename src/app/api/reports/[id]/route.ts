// 월차보고 요약 저장 (작성자 본인 + 작성중/반려 상태만. DB RLS 가 동일하게 검사)
import { route, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { uuid, int, text } from '@/lib/validate';

export const PATCH = route({}, async ({ params, req, db }) => {
  const id = uuid(params.id);
  const b = await readJson(req);
  const version = int(b.version, 1, 1e9, '버전');
  const summary = text(b.summary, 10000, '요약');
  return db(async (tx) => {
    const [row] = await tx`update monthly_reports set summary = ${summary} where id = ${id} and version = ${version} returning version`;
    if (row) return { version: row.version };
    const [cur] = await tx`select status, version from monthly_reports where id = ${id}`;
    if (!cur) throw new HttpError(404, '보고서를 찾을 수 없습니다.');
    if (cur.version !== version) throw new HttpError(409, '다른 화면에서 먼저 수정되었습니다. 새로 고친 뒤 다시 시도해 주세요.');
    throw new HttpError(403, '작성중 또는 반려 상태의 본인 보고서만 수정할 수 있습니다.');
  });
});
