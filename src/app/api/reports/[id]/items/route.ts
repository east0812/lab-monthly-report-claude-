// 보고 항목(SM 도면·제작사양서·교육/학습·타사제품 구매·기구가공/기타) 추가·수정·삭제
import { route, readJson } from '@/lib/auth';
import { HttpError, type Tx } from '@/lib/db';
import { uuid, int, oneOf } from '@/lib/validate';
import { sanitizeItem } from '@/lib/reports';
import type { SectionKey } from '@/lib/constants';

const SECTION_KEYS = ['sm_drawing', 'spec', 'education', 'purchase', 'machining'] as const;

async function assertEditable(tx: Tx, reportId: string) {
  const [r] = await tx`select report_editable(${reportId}) as ok, exists(select 1 from monthly_reports where id = ${reportId}) as found`;
  if (!r.found) throw new HttpError(404, '보고서를 찾을 수 없습니다.');
  if (!r.ok) throw new HttpError(403, '작성중 또는 반려 상태의 본인 보고서만 수정할 수 있습니다.');
}

export const POST = route({}, async ({ params, req, db }) => {
  const rid = uuid(params.id);
  const b = await readJson(req);
  const section = oneOf<SectionKey>(b.section, SECTION_KEYS, '구분');
  const data = sanitizeItem(section, b);
  return db(async (tx) => {
    await assertEditable(tx, rid);
    const [m] = await tx`select coalesce(max(sort_order), 0) + 1 as n from report_items where report_id = ${rid} and section = ${section}`;
    const [row] = await tx`insert into report_items ${tx({ ...data, report_id: rid, section, sort_order: m.n })} returning id, version`;
    return { id: row.id, version: row.version };
  });
});

export const PATCH = route({}, async ({ params, req, db }) => {
  const rid = uuid(params.id);
  const b = await readJson(req);
  const id = uuid(b.id);
  const version = int(b.version, 1, 1e9, '버전');
  return db(async (tx) => {
    await assertEditable(tx, rid);
    const [cur] = await tx`select section, version from report_items where id = ${id} and report_id = ${rid}`;
    if (!cur) throw new HttpError(404, '항목을 찾을 수 없습니다.');
    const data = sanitizeItem(cur.section as SectionKey, b);
    const [row] = await tx`update report_items set ${tx(data)} where id = ${id} and version = ${version} returning version`;
    if (!row) throw new HttpError(409, '다른 화면에서 먼저 수정되었습니다. 새로 고친 뒤 다시 시도해 주세요.');
    return { version: row.version };
  });
});

export const DELETE = route({}, async ({ params, req, db }) => {
  const rid = uuid(params.id);
  const id = uuid(req.nextUrl.searchParams.get('item'));
  return db(async (tx) => {
    await assertEditable(tx, rid);
    const rows = await tx`delete from report_items where id = ${id} and report_id = ${rid} returning id`;
    if (!rows.length) throw new HttpError(404, '항목을 찾을 수 없습니다.');
    return { ok: true };
  });
});
