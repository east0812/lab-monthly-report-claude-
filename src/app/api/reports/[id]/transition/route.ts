// 보고서 상태 전이: 제출·제출 취소(작성자) / 확인·최종확정·반려(관리자)
// 규칙·이력·알림은 DB 함수 report_transition 이 한 트랜잭션으로 처리한다.
import { route, readJson } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { uuid, oneOf, text } from '@/lib/validate';

const ACTIONS = ['submit', 'cancel', 'review', 'finalize', 'reject'] as const;

export const POST = route({}, async ({ params, req, db }) => {
  const id = uuid(params.id);
  const b = await readJson(req);
  const action = oneOf(b.action, ACTIONS, '요청');
  const reason = text(b.reason, 1000, '반려 사유');
  return db(async (tx) => {
    if (action === 'submit') {
      const [c] = await tx`
        select r.summary,
          (select count(*) from report_items i where i.report_id = r.id)
          + (select count(*) from dev_project_monthly m where m.report_id = r.id)
          + (select count(*) from dev_works d where d.user_id = r.user_id and d.year = r.year and d.month = r.month)
          + (select count(*) from transfers t where t.user_id = r.user_id and t.year = r.year and t.month = r.month) as n
        from monthly_reports r where r.id = ${id}`;
      if (c && !String(c.summary).trim() && Number(c.n) === 0) throw new HttpError(400, '내용이 없는 보고서는 제출할 수 없습니다. 요약이나 업무를 입력해 주세요.');
    }
    const [r] = await tx`select id, status, version from report_transition(${id}, ${action}, ${reason || null})`;
    return { status: r.status, version: r.version };
  });
});
