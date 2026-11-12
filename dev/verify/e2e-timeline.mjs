// 관리자 월별 상태 수정 (개발현황·생산이관) 검증. e2e.mjs 가 불러 쓴다.
import { accounts } from './client.mjs';

export default async function ({ admin, emp1, sql, check, section, want, cleanup, CY, CM }) {
  if (!want('timeline')) return;
  section('관리자: 선택한 월의 상태만 수정 (다른 월·담당자·상세 보존)');
  const [e1] = await sql`select id from profiles where email = ${accounts.emp1.email}`;
  const [prod] = await sql`select id from products where deleted_at is null order by name limit 1`;
  const pm = CM === 1 ? { y: CY - 1, m: 12 } : { y: CY, m: CM - 1 };
  // 검증용 기록: 같은 모델·담당자, 전월 1건 + 금월 2건(한 칸에 여러 기록)
  const mk = (y, m, title, status, progress) => sql`
    insert into dev_works (user_id, year, month, product_id, title, status, progress, work_done, test_result, next_plan)
    values (${e1.id}, ${y}, ${m}, ${prod.id}, ${title}, ${status}, ${progress}, '상세 수행내용', '시험 OK', '차월 계획') returning *`;
  const [[prev], [a], [b]] = await Promise.all([mk(pm.y, pm.m, 'E2E 전월', 'in_progress', 40), mk(CY, CM, 'E2E 금월 A', 'in_progress', 50), mk(CY, CM, 'E2E 금월 B', 'planned', 0)]);
  cleanup.push(() => sql`delete from dev_works where id in ${sql([prev.id, a.id, b.id])}`);
  const [tr] = await sql`
    insert into transfers (user_id, year, month, product_id, dev_status, transfer_status, planned_date, completed_date, content, plan)
    values (${e1.id}, ${CY}, ${CM}, ${prod.id}, 'done', 'in_progress', ${`${CY}-12-20`}, null, 'E2E 이관 내용', 'E2E 계획') returning *`;
  cleanup.push(() => sql`delete from transfers where id = ${tr.id}`);

  check('직원은 월별 상태 직접 수정 API 사용 불가', (await emp1.post('/api/admin/month-status', { kind: 'dev', id: a.id, status: 'done', version: a.version })).status === 403);
  const r1 = await admin.post('/api/admin/month-status', { kind: 'dev', id: a.id, status: 'done', version: a.version });
  check('관리자: 금월 기록 A 상태 → 완료', r1.status === 200 && r1.json.version === a.version + 1, r1.text.slice(0, 200));
  const [a2] = await sql`select * from dev_works where id = ${a.id}`;
  check('완료 → 진행률 100% 처리', a2.status === 'done' && a2.progress === 100);
  check('상세 내용·담당자·연월 보존', a2.work_done === '상세 수행내용' && a2.test_result === '시험 OK' && a2.next_plan === '차월 계획' && a2.user_id === e1.id && a2.month === CM && a2.title === 'E2E 금월 A');
  const [prev2] = await sql`select * from dev_works where id = ${prev.id}`;
  const [b2] = await sql`select * from dev_works where id = ${b.id}`;
  check('다른 월 기록은 그대로', prev2.status === 'in_progress' && prev2.progress === 40 && prev2.version === prev.version);
  check('같은 칸의 다른 기록(B)은 그대로 — 선택한 기록만 수정', b2.status === 'planned' && b2.version === b.version);
  check('오래된 화면(이전 버전)으로 수정 → 409', (await admin.post('/api/admin/month-status', { kind: 'dev', id: a.id, status: 'on_hold', version: a.version })).status === 409);
  check('잘못된 상태 값 거부', (await admin.post('/api/admin/month-status', { kind: 'dev', id: b.id, status: 'finished', version: b.version })).status === 400);
  const r2 = await admin.post('/api/admin/month-status', { kind: 'transfer', id: tr.id, status: 'done', version: tr.version });
  const [tr2] = await sql`select * from transfers where id = ${tr.id}`;
  check('관리자: 생산이관 금월 이관상태 → 완료', r2.status === 200 && tr2.transfer_status === 'done');
  check('이관일·내용·개발상태 보존', tr2.planned_date === `${CY}-12-20` && tr2.completed_date === null && tr2.content === 'E2E 이관 내용' && tr2.plan === 'E2E 계획' && tr2.dev_status === 'done');
  const [n] = await sql`select count(*)::int as n from notifications where user_id = ${e1.id} and type = 'month_status_changed' and created_at > now() - interval '2 minutes'`;
  check('담당자에게 상태 변경 알림', n.n >= 2);
  cleanup.push(() => sql`delete from notifications where user_id = ${e1.id} and type = 'month_status_changed' and created_at > now() - interval '10 minutes'`);

  const page = await admin.get(`/admin/reports?year=${CY}&month=${CM}`);
  check('월차보고 관리 화면: 24개월 타임라인 + 선택 월 표시', page.status === 200 && page.text.includes(`${CY - 1}년`) && /모델별 24개월 타임라인/.test(page.text));
  // 그달에 신규 기록이 없는 월을 골라도 앞선 이력이 보인다
  const far = await admin.get(`/admin/reports?year=${CY}&month=12`);
  check('신규 기록이 없는 월을 선택해도 앞선 이력 표시', far.status === 200 && /aria-label="[^"]*상태[^"]*"|title="\d{4}년 \d+월/.test(far.text));
  check('연구소 현황 화면 200', (await admin.get(`/admin/overview?year=${CY}&month=${CM}`)).status === 200);
}
