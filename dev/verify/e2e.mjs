// 전체 흐름 검증 (직원·관리자 두 역할).  npm run local:verify
// 전제: 로컬 스택 + 웹 서버 실행 중, 가상 데이터(npm run local:seed) 적재.
// 검증 중 만든 자료는 끝에서 지운다. 가상 계정의 비밀번호를 바꾸는 단계는 원래 값으로 되돌린다.
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { session, Session, accounts, BASE } from './client.mjs';
import { ROOT, loadEnv } from '../../scripts/lib.mjs';

loadEnv();
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {}, types: { pgdate: { to: 1082, from: [1082], serialize: (x) => x, parse: (x) => x } } });
const OUT = path.join(ROOT, 'dev', 'verify', 'out');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const failed = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; failed.push(name); console.log(`  ✘ ${name}${detail ? `  → ${detail}` : ''}`); }
}
const section = (t) => console.log(`\n■ ${t}`);
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const want = (k) => !only.length || only.includes(k);

const kst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date());
const CY = Number(kst.slice(0, 4)), CM = Number(kst.slice(5, 7));
const next = CM === 12 ? { y: CY + 1, m: 1 } : { y: CY, m: CM + 1 };
const cleanup = [];

try {
  console.log(`대상: ${BASE}`);
  const admin = await session('admin');
  const emp1 = await session('emp1');
  const emp2 = await session('emp2');
  const emp3 = await session('emp3');

  // ─────────────────────────────────────────────────────────────
  if (want('auth')) {
    section('인증·권한');
    const anon = new Session();
    check('비로그인 페이지 접근 → 로그인으로 이동', (await anon.get('/dashboard')).status === 307);
    check('비로그인 API → 401', (await anon.get('/api/notifications')).status === 401);
    check('틀린 비밀번호 → 401', (await anon.login(accounts.emp1.email, 'wrong-password-x')).status === 401);
    const ina = await anon.login(accounts.inactive.email, accounts.inactive.password);
    check('비활성 계정 로그인 차단', ina.status === 401 || ina.status === 403, String(ina.status));
    const s1 = new Session();
    await s1.login(accounts.emp1.email, accounts.emp1.password, false);
    const raw = (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ email: accounts.emp1.email, password: accounts.emp1.password, remember: false }) })).headers.getSetCookie();
    check('로그인 유지 해제 → 세션 쿠키(만료 없음)', raw.filter((c) => /auth-token/.test(c)).every((c) => !/max-age|expires/i.test(c)), raw.join(' | ').slice(0, 200));
    const raw2 = (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ email: accounts.emp1.email, password: accounts.emp1.password, remember: true }) })).headers.getSetCookie();
    check('로그인 유지 → 만료가 있는 쿠키 + HttpOnly', raw2.filter((c) => /auth-token/.test(c)).every((c) => /max-age|expires/i.test(c) && /httponly/i.test(c)));
    check('교차 출처 POST 차단', (await emp1.post('/api/notifications', { action: 'read_all' }, { headers: { origin: 'http://evil.example' } })).status === 403);
    check('직원의 관리자 페이지 접근 → 대시보드로', [307, 308].includes((await emp1.get('/admin/reports')).status));
    check('관리자 페이지 접근(관리자) → 200', (await admin.get('/admin/reports')).status === 200);
    check('외부 주소 next 파라미터 무시', ((await emp1.get('/login?next=//evil.example')).headers.get('location') ?? '').endsWith('/dashboard'));
  }

  // ─────────────────────────────────────────────────────────────
  let reportId = null;
  if (want('report')) {
    section('월차보고 작성 → 제출 → 반려 → 재제출 → 확인 → 최종확정');
    await sql`delete from monthly_reports where user_id = (select id from profiles where email = ${accounts.emp3.email}) and year = ${next.y} and month = ${next.m}`;
    const c = await emp3.post('/api/reports', { year: next.y, month: next.m });
    reportId = c.json?.id;
    cleanup.push(() => sql`delete from monthly_reports where id = ${reportId}`);
    check('보고서 생성', c.status === 200 && !!reportId && c.json.created === true, c.text.slice(0, 200));
    const c2 = await emp3.post('/api/reports', { year: next.y, month: next.m });
    check('같은 연월 재생성 → 기존 보고서 반환(1건 유지)', c2.json?.id === reportId && c2.json.created === false);
    check('내용 없는 보고서 제출 거부', (await emp3.post(`/api/reports/${reportId}/transition`, { action: 'submit' })).status === 400);

    const s = await emp3.patch(`/api/reports/${reportId}`, { summary: '검증용 요약 <script>alert(1)</script>', version: 1 });
    check('요약 저장', s.status === 200 && s.json.version === 2, s.text.slice(0, 200));
    check('오래된 버전으로 저장 → 409', (await emp3.patch(`/api/reports/${reportId}`, { summary: '덮어쓰기', version: 1 })).status === 409);
    const [prod] = await sql`select id from products where deleted_at is null order by name limit 1`;
    const it = await emp3.post(`/api/reports/${reportId}/items`, { section: 'sm_drawing', product_id: prod.id, title: '검증 도면', revision: 'Rev.Z', change_note: '검증용 변경', status: 'in_progress' });
    check('SM 도면 항목 추가', it.status === 200 && !!it.json?.id, it.text.slice(0, 200));
    check('필수값 없는 항목 거부', (await emp3.post(`/api/reports/${reportId}/items`, { section: 'purchase', vendor: '업체만' })).status === 400);
    const pu = await emp3.post(`/api/reports/${reportId}/items`, { section: 'purchase', item_name: '검증 부품', vendor: '검증업체', quantity: 3, unit: 'EA', schedule: '말일 입고', note: '비고' });
    check('타사제품 구매 항목 추가', pu.status === 200);
    const up = await emp3.patch(`/api/reports/${reportId}/items`, { id: it.json.id, version: 1, product_id: prod.id, title: '검증 도면(수정)', revision: 'Rev.Z1', change_note: '수정됨', status: 'done' });
    check('항목 수정', up.status === 200 && up.json.version === 2);
    const pj = await emp3.post(`/api/reports/${reportId}/projects`, { name: '검증 과제', goal: '목표', progress: 30, status: 'in_progress', result: '금월 결과' });
    check('개발과제(기본 정보 + 월별 진행) 추가', pj.status === 200 && !!pj.json?.project_id, pj.text.slice(0, 200));
    cleanup.push(() => sql`delete from dev_projects where id = ${pj.json.project_id}`);
    const pm = await emp3.patch(`/api/reports/${reportId}/projects`, { kind: 'monthly', id: pj.json.id, version: 1, progress: 55, status: 'done', result: '완료' });
    const [mrow] = await sql`select progress from dev_project_monthly where id = ${pj.json.id}`;
    check('월별 진행 수정: 완료 → 진행률 100%', pm.status === 200 && mrow.progress === 100);

    // 첨부
    const pdf = Buffer.from('%PDF-1.4\n% 검증용\n');
    const fd = new FormData(); fd.append('file', new Blob([pdf], { type: 'application/pdf' }), '검증 첨부.pdf');
    const at = await emp3.upload(`/api/reports/${reportId}/attachments`, fd);
    check('PDF 첨부', at.status === 200 && !!at.json?.id, at.text.slice(0, 200));
    const fd2 = new FormData(); fd2.append('file', new Blob([Buffer.from('MZ\x90\x00')]), 'bad.exe');
    check('허용되지 않은 형식 첨부 거부', (await emp3.upload(`/api/reports/${reportId}/attachments`, fd2)).status === 400);
    const fd3 = new FormData(); fd3.append('file', new Blob([Buffer.from('MZ\x90\x00 not a pdf')]), 'fake.pdf');
    check('확장자만 바꾼 파일 거부', (await emp3.upload(`/api/reports/${reportId}/attachments`, fd3)).status === 400);
    const dl = await emp3.get(`/api/reports/${reportId}/attachments?attachment=${at.json.id}`);
    check('작성자 첨부 다운로드', dl.status === 200 && dl.buf.equals(pdf) && /attachment/.test(dl.headers.get('content-disposition') ?? ''));
    check('관리자 첨부 다운로드', (await admin.get(`/api/reports/${reportId}/attachments?attachment=${at.json.id}`)).status === 200);
    check('다른 직원 첨부 다운로드 차단', (await emp1.get(`/api/reports/${reportId}/attachments?attachment=${at.json.id}`)).status === 404);
    check('다른 직원 보고서 열람 차단', (await emp1.get(`/reports/${reportId}`)).status === 404);
    check('다른 직원 보고서 수정 차단', [403, 404].includes((await emp1.patch(`/api/reports/${reportId}`, { summary: '침입', version: 2 })).status));
    check('직원의 확인·반려 요청 차단', (await emp3.post(`/api/reports/${reportId}/transition`, { action: 'review' })).status === 403);

    // 제출
    const sub = await emp3.post(`/api/reports/${reportId}/transition`, { action: 'submit' });
    check('제출 → 제출완료', sub.status === 200 && sub.json.status === 'submitted', sub.text.slice(0, 200));
    check('제출 후 요약 수정 차단', (await emp3.patch(`/api/reports/${reportId}`, { summary: 'x', version: sub.json.version })).status === 403);
    check('제출 후 항목 추가 차단', (await emp3.post(`/api/reports/${reportId}/items`, { section: 'spec', title: 'x' })).status === 403);
    check('제출 후 첨부 삭제 차단', (await emp3.del(`/api/reports/${reportId}/attachments?attachment=${at.json.id}`)).status === 403);
    const [n1] = await sql`select count(*)::int as n from notifications where type = 'report_submitted' and link = ${`/reports/${reportId}`}`;
    check('제출 알림이 관리자에게 생성', n1.n >= 1);
    // DB 직접 우회 시도 (RLS·트리거): authenticated 역할로 상태 직접 변경
    const [e3] = await sql`select id from profiles where email = ${accounts.emp3.email}`;
    let dbBlocked = false;
    try {
      await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: e3.id, role: 'authenticated' })}, true), set_config('role', 'authenticated', true)`;
        const r = await tx`update monthly_reports set status = 'finalized' where id = ${reportId} returning id`;
        if (r.length === 0) dbBlocked = true; else throw new Error('updated');
      });
    } catch (e) { dbBlocked = e.message !== 'updated'; }
    check('DB 직접 요청으로 상태 변경 불가(RLS/트리거)', dbBlocked);

    check('제출 취소(검토 전) → 작성중', (await emp3.post(`/api/reports/${reportId}/transition`, { action: 'cancel' })).json?.status === 'draft');
    await emp3.post(`/api/reports/${reportId}/transition`, { action: 'submit' });
    check('사유 없는 반려 거부', (await admin.post(`/api/reports/${reportId}/transition`, { action: 'reject', reason: '  ' })).status === 400);
    const rj = await admin.post(`/api/reports/${reportId}/transition`, { action: 'reject', reason: '시험결과 보완 필요' });
    check('관리자 반려(사유 포함)', rj.status === 200 && rj.json.status === 'rejected', rj.text.slice(0, 200));
    const [n2] = await sql`select body from notifications where type = 'report_rejected' and link = ${`/reports/${reportId}`} order by created_at desc limit 1`;
    check('반려 알림이 작성자에게 사유와 함께 전달', /시험결과 보완 필요/.test(n2?.body ?? ''));
    const [rv] = await sql`select version from monthly_reports where id = ${reportId}`;
    check('반려 후 작성자 수정 가능', (await emp3.patch(`/api/reports/${reportId}`, { summary: '보완한 요약', version: rv.version })).status === 200);
    check('반려 후 첨부 삭제 가능', (await emp3.del(`/api/reports/${reportId}/attachments?attachment=${at.json.id}`)).status === 200);
    check('재제출', (await emp3.post(`/api/reports/${reportId}/transition`, { action: 'submit' })).json?.status === 'submitted');
    check('확인 전 최종확정 거부(순서 강제)', (await admin.post(`/api/reports/${reportId}/transition`, { action: 'finalize' })).status === 409);
    check('관리자 확인', (await admin.post(`/api/reports/${reportId}/transition`, { action: 'review' })).json?.status === 'reviewed');
    check('검토 후 제출 취소 불가', (await emp3.post(`/api/reports/${reportId}/transition`, { action: 'cancel' })).status === 409);
    check('최종확정', (await admin.post(`/api/reports/${reportId}/transition`, { action: 'finalize' })).json?.status === 'finalized');
    check('최종확정 보고서도 사유와 함께 반려 가능', (await admin.post(`/api/reports/${reportId}/transition`, { action: 'reject', reason: '확정 후 오류 발견' })).json?.status === 'rejected');
    const hist = await sql`select to_status from report_status_history where report_id = ${reportId} order by created_at`;
    check('상태 변경 이력 기록', hist.map((h) => h.to_status).join('>') === 'submitted>draft>submitted>rejected>submitted>reviewed>finalized>rejected', hist.map((h) => h.to_status).join('>'));
    const page = await emp3.get(`/reports/${reportId}`);
    check('보고서 화면 렌더링 + 입력값 이스케이프', page.status === 200 && !page.text.includes('<script>alert(1)</script>'));
    check('대시보드·내역·작성 화면 200', (await emp3.get('/dashboard')).status === 200 && (await emp3.get('/reports')).status === 200 && (await emp3.get(`/reports/write?year=${next.y}&month=${next.m}`)).status === 200);
  }

  globalThis.__e2e = { admin, emp1, emp2, emp3, sql, check, section, want, cleanup, CY, CM, next, OUT, reportId };
  for (const f of ['e2e-timeline.mjs', 'e2e-sales-export.mjs']) {
    if (fs.existsSync(path.join(ROOT, 'dev', 'verify', f))) await (await import(`./${f}`)).default(globalThis.__e2e);
  }
} catch (e) {
  fail++; failed.push(`예외: ${e.message}`);
  console.error('\n검증 중 예외:', e);
} finally {
  for (const fn of cleanup.reverse()) { try { await fn(); } catch (e) { console.error('정리 실패:', e.message); } }
  await sql.end();
}
console.log(`\n결과: 통과 ${pass} / 실패 ${fail}`);
if (failed.length) console.log('실패 항목:\n - ' + failed.join('\n - '));
process.exit(fail ? 1 : 0);
