// 개발과제: 과제 기본 정보(dev_projects)와 월별 진행률·결과(dev_project_monthly)를 분리해 관리
import { route, readJson } from '@/lib/auth';
import { HttpError, type Tx, type Row } from '@/lib/db';
import { uuid, optUuid, int, oneOf, reqStr, text, optDate } from '@/lib/validate';
import { ITEM_STATUS_KEYS } from '@/lib/constants';

async function assertEditable(tx: Tx, reportId: string) {
  const [r] = await tx`select report_editable(${reportId}) as ok, exists(select 1 from monthly_reports where id = ${reportId}) as found`;
  if (!r.found) throw new HttpError(404, '보고서를 찾을 수 없습니다.');
  if (!r.ok) throw new HttpError(403, '작성중 또는 반려 상태의 본인 보고서만 수정할 수 있습니다.');
}
function projectFields(b: Record<string, unknown>): Row {
  const start = optDate(b.start_date, '시작일');
  const end = optDate(b.end_date, '종료일');
  if (start && end && start > end) throw new HttpError(400, '종료일이 시작일보다 빠릅니다.');
  return {
    name: reqStr(b.name, 200, '과제명'), product_id: optUuid(b.product_id, '제품'), category_id: optUuid(b.category_id, '업무 분류'),
    goal: text(b.goal, 3000, '과제 목표'), start_date: start, end_date: end,
  };
}
function monthlyFields(b: Record<string, unknown>): Row {
  return {
    progress: int(b.progress ?? 0, 0, 100, '진행률'), status: oneOf(b.status ?? 'in_progress', ITEM_STATUS_KEYS, '상태'),
    result: text(b.result, 5000, '금월 결과'), issue: text(b.issue, 3000, '이슈'), next_plan: text(b.next_plan, 3000, '차월 계획'),
  };
}

/** 이 보고서에 아직 추가하지 않은 내 과제 목록 (기존 과제 불러오기용) */
export const GET = route({}, async ({ user, params, db }) => {
  const rid = uuid(params.id);
  return db(async (tx) => ({
    projects: await tx`
      select j.id, j.name, j.goal, j.start_date, j.end_date, j.product_id, j.category_id,
        (select m.progress from dev_project_monthly m join monthly_reports r on r.id = m.report_id
          where m.project_id = j.id order by r.year desc, r.month desc limit 1) as last_progress
      from dev_projects j
      where j.user_id = ${user.id} and not j.is_closed
        and not exists (select 1 from dev_project_monthly m where m.project_id = j.id and m.report_id = ${rid})
      order by j.created_at desc`,
  }));
});

export const POST = route({}, async ({ user, params, req, db }) => {
  const rid = uuid(params.id);
  const b = await readJson(req);
  const monthly = monthlyFields(b);
  return db(async (tx) => {
    await assertEditable(tx, rid);
    let projectId: string;
    if (b.project_id) {
      projectId = uuid(b.project_id, '과제');
      const [own] = await tx`select 1 from dev_projects where id = ${projectId} and user_id = ${user.id}`;
      if (!own) throw new HttpError(404, '과제를 찾을 수 없습니다.');
    } else {
      const [p] = await tx`insert into dev_projects ${tx({ ...projectFields(b), user_id: user.id })} returning id`;
      projectId = p.id;
    }
    const [m] = await tx`insert into dev_project_monthly ${tx({ ...monthly, project_id: projectId, report_id: rid })} returning id`;
    return { id: m.id, project_id: projectId };
  });
});

export const PATCH = route({}, async ({ user, params, req, db }) => {
  const rid = uuid(params.id);
  const b = await readJson(req);
  const id = uuid(b.id);
  const version = int(b.version, 1, 1e9, '버전');
  const kind = oneOf(b.kind, ['project', 'monthly'] as const, '구분');
  return db(async (tx) => {
    await assertEditable(tx, rid);
    const stale = new HttpError(409, '다른 화면에서 먼저 수정되었습니다. 새로 고친 뒤 다시 시도해 주세요.');
    if (kind === 'project') {
      const [row] = await tx`update dev_projects set ${tx(projectFields(b))} where id = ${id} and user_id = ${user.id} and version = ${version} returning version`;
      if (!row) throw stale;
      return { version: row.version };
    }
    const [row] = await tx`update dev_project_monthly set ${tx(monthlyFields(b))} where id = ${id} and report_id = ${rid} and version = ${version} returning version`;
    if (!row) throw stale;
    return { version: row.version };
  });
});

/** 이 보고서에서 과제의 월별 기록을 뺀다. 다른 달 기록이 없는 과제는 기본 정보도 함께 삭제한다. */
export const DELETE = route({}, async ({ user, params, req, db }) => {
  const rid = uuid(params.id);
  const id = uuid(req.nextUrl.searchParams.get('monthly'));
  return db(async (tx) => {
    await assertEditable(tx, rid);
    const [m] = await tx`delete from dev_project_monthly where id = ${id} and report_id = ${rid} returning project_id`;
    if (!m) throw new HttpError(404, '과제 기록을 찾을 수 없습니다.');
    await tx`delete from dev_projects j where j.id = ${m.project_id} and j.user_id = ${user.id}
             and not exists (select 1 from dev_project_monthly x where x.project_id = j.id)`;
    return { ok: true };
  });
});
