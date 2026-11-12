// 회귀 검증: 관리 화면(직원·제품·업무분류·시스템 설정), 내 정보, 전체 검색, 내 업무 이력, 제품 개발이력
//   node dev/verify/admin-misc.mjs        (개발 서버와 로컬 DB 가 떠 있어야 한다)
// - 비밀번호는 무작위로 만들고 어디에도 출력하지 않는다.
// - 만든 검증용 계정·제품·분류·검색용 기록은 끝나면 지우고, 바꾼 설정·가상 계정 이름은 원래대로 되돌린다.
// - DB 직접 연결과 서비스 키는 "정리"와 "검색 공개 범위 검증용 기록 준비"에만 쓴다(앱 동작 검증은 모두 HTTP).
import crypto from 'node:crypto';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { session, Session, accounts, BASE } from './client.mjs';

const TS = Date.now();
const rand = (n) => crypto.randomBytes(n).toString('base64url').slice(0, n);
const PW = {            // 값은 출력하지 않는다
  init6: rand(6),       // 관리자 초기 발급 (6자)
  short5: rand(5),
  reset6: rand(6),      // 관리자 재설정 (6자)
  self11: rand(11),
  self12: rand(14),     // 본인 변경 (12자 이상)
};
const TEST_EMAIL = `verify-${TS}@lab.test`;
const PRODUCT_NAME = `VERIFY-제품-${TS}`;
const CATEGORY_NAME = `VERIFY-분류-${TS}`;
const MARK = `VERIFYSRCH${TS}`;

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
const sbAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0;
const fails = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? `  → ${detail}` : ''}`); }
}
const section = (t) => console.log(`\n[${t}]`);
const st = (r) => `${r.status} ${String(r.text).slice(0, 140).replace(/\s+/g, ' ')}`;
/** 응답에 비밀번호 값이나 password 항목이 없는지 */
const noPassword = (r, ...pws) => !/password/i.test(r.text) && pws.every((p) => !r.text.includes(p));

async function purgeLeftovers() {
  const users = await sql`select id from public.profiles where email like 'verify-%@lab.test'`;
  for (const u of users) {
    await sql`delete from public.notifications where user_id = ${u.id}`;
    await sql`delete from public.profiles where id = ${u.id}`;
    await sbAdmin.auth.admin.deleteUser(u.id).catch(() => {});
  }
  await sql`delete from public.dev_works where title like 'VERIFYSRCH%'`;
  await sql`delete from public.products where name like 'VERIFY-제품-%'`;
  await sql`delete from public.work_categories where name like 'VERIFY-분류-%'`;
}

const restore = { settings: null, emp1Name: null };
let admin;

try {
  console.log('BASE', BASE);
  await purgeLeftovers();

  admin = await session('admin');
  const emp1 = await session('emp1');
  const emp2 = await session('emp2');
  const anon = new Session();
  const meAdmin = (await admin.get('/api/me')).json?.me;
  const meEmp1 = (await emp1.get('/api/me')).json?.me;
  const meEmp2 = (await emp2.get('/api/me')).json?.me;
  restore.emp1Name = meEmp1?.name ?? accounts.emp1.name;

  // ───────────────────────── 직원 관리 ─────────────────────────
  section('직원 관리');
  let r = await admin.post('/api/admin/users', { email: TEST_EMAIL, name: '검증직원', role: 'employee', password: PW.short5, confirm: PW.short5 });
  check('직원 등록: 5자 비밀번호 거부(400)', r.status === 400, st(r));
  r = await admin.post('/api/admin/users', { email: TEST_EMAIL, name: '검증직원', role: 'employee', password: PW.init6, confirm: PW.reset6 });
  check('직원 등록: 비밀번호 확인 불일치 거부(400)', r.status === 400, st(r));
  r = await admin.post('/api/admin/users', { email: 'not-an-email', name: '검증직원', role: 'employee', password: PW.init6, confirm: PW.init6 });
  check('직원 등록: 잘못된 이메일 거부(400)', r.status === 400, st(r));
  r = await admin.post('/api/admin/users', { email: TEST_EMAIL, name: '검증직원', role: 'employee', password: PW.init6, confirm: PW.init6 });
  const testId = r.json?.user?.id;
  check('직원 등록: 6자 비밀번호 허용(200)', r.status === 200 && !!testId && r.json.user.role === 'employee' && r.json.user.is_active === true, st(r));
  check('직원 등록 응답에 비밀번호 없음', noPassword(r, PW.init6));
  r = await admin.post('/api/admin/users', { email: TEST_EMAIL.toUpperCase(), name: '중복', role: 'employee', password: PW.init6, confirm: PW.init6 });
  check('직원 등록: 중복 이메일 거부(409)', r.status === 409, st(r));
  r = await admin.get('/api/admin/users');
  check('직원 목록에 새 직원 포함', r.status === 200 && r.json.users.some((u) => u.id === testId && u.email === TEST_EMAIL), st(r));
  check('직원 목록 응답에 비밀번호 없음', noPassword(r, PW.init6));

  const first = new Session();
  r = await first.login(TEST_EMAIL, PW.init6);
  check('새 직원 로그인 성공', r.status === 200, st(r));
  r = await first.get('/api/me');
  check('새 직원 /api/me 조회', r.status === 200 && r.json.me.email === TEST_EMAIL && r.json.me.role === 'employee', st(r));

  r = await admin.post(`/api/admin/users/${testId}/password`, { password: PW.short5, confirm: PW.short5 });
  check('비밀번호 재설정: 5자 거부(400)', r.status === 400, st(r));
  r = await admin.post(`/api/admin/users/${testId}/password`, { password: PW.reset6, confirm: PW.reset6 });
  check('비밀번호 재설정: 6자 허용, 응답은 { ok: true } 뿐', r.status === 200 && JSON.stringify(r.json) === '{"ok":true}', st(r));
  check('비밀번호 재설정 응답에 비밀번호 없음', noPassword(r, PW.reset6));
  r = await admin.post('/api/admin/users/00000000-0000-4000-8000-000000000000/password', { password: PW.reset6, confirm: PW.reset6 });
  check('비밀번호 재설정: 없는 직원(404)', r.status === 404, st(r));
  r = await new Session().login(TEST_EMAIL, PW.init6);
  check('재설정 후 이전 비밀번호 로그인 실패', r.status === 401, st(r));
  const live = new Session();
  r = await live.login(TEST_EMAIL, PW.reset6);
  check('재설정 후 새 비밀번호 로그인 성공', r.status === 200, st(r));

  r = await admin.patch(`/api/admin/users/${testId}`, { name: '검증직원2', is_active: false });
  check('직원 비활성화(200)', r.status === 200 && r.json.user.is_active === false && r.json.user.name === '검증직원2', st(r));
  r = await live.get('/api/me');
  check('비활성화: 기존 세션의 API 호출 401', r.status === 401, st(r));
  r = await new Session().login(TEST_EMAIL, PW.reset6);
  check('비활성화: 로그인 차단', r.status === 401 || r.status === 403, st(r));
  r = await admin.patch(`/api/admin/users/${testId}`, { is_active: true });
  check('직원 재활성화(200)', r.status === 200 && r.json.user.is_active === true, st(r));
  const tester = new Session();
  r = await tester.login(TEST_EMAIL, PW.reset6);
  check('재활성화 후 로그인 성공', r.status === 200, st(r));

  r = await admin.patch(`/api/admin/users/${meAdmin.id}`, { is_active: false });
  check('관리자 본인 비활성화 거부(400)', r.status === 400, st(r));
  r = await admin.patch(`/api/admin/users/${meAdmin.id}`, { role: 'employee' });
  check('관리자 본인 역할 변경 거부(400)', r.status === 400, st(r));
  r = await admin.get('/api/me');
  check('관리자 계정 그대로 유지', r.status === 200 && r.json.me.role === 'admin', st(r));
  r = await admin.patch(`/api/admin/users/${testId}`, { role: 'superuser' });
  check('직원 수정: 잘못된 역할 거부(400)', r.status === 400, st(r));
  r = await admin.patch(`/api/admin/users/${testId}`, { role: 'admin' });
  check('직원 역할을 관리자로 변경', r.status === 200 && r.json.user.role === 'admin', st(r));
  r = await tester.get('/api/admin/users');
  check('관리자가 된 계정은 관리자 API 사용 가능', r.status === 200, st(r));
  r = await admin.patch(`/api/admin/users/${testId}`, { role: 'employee' });
  check('직원 역할을 직원으로 되돌림', r.status === 200 && r.json.user.role === 'employee', st(r));
  r = await tester.get('/api/admin/users');
  check('직원으로 돌아간 계정은 관리자 API 403', r.status === 403, st(r));

  // ───────────────────────── 제품 관리 ─────────────────────────
  section('제품 관리');
  r = await admin.post('/api/admin/products', { name: '  ', model: 'X' });
  check('제품 등록: 제품명 없음 거부(400)', r.status === 400, st(r));
  r = await admin.post('/api/admin/products', { name: PRODUCT_NAME, model: 'VM-1', family: '검증', freq_band: '1~2 GHz', revision: 'Rev.A', note: '검증용' });
  const prod = r.json?.product;
  check('제품 등록(200)', r.status === 200 && !!prod?.id && prod.version === 1 && prod.deleted_at === null, st(r));
  check('제품 응답에 고객사 항목 없음', !!prod && !('customer' in prod) && !/고객사/.test(r.text));
  r = await admin.post('/api/admin/products', { name: PRODUCT_NAME.toLowerCase(), model: 'vm-1' });
  check('제품 등록: 같은 제품명+모델 거부(409)', r.status === 409, st(r));
  r = await admin.patch(`/api/admin/products/${prod.id}`, { name: PRODUCT_NAME, model: 'VM-1', family: '검증', freq_band: '1~2 GHz', revision: 'Rev.B', note: '수정', version: 1 });
  check('제품 수정(200, 버전 증가)', r.status === 200 && r.json.product.version === 2 && r.json.product.revision === 'Rev.B', st(r));
  r = await admin.patch(`/api/admin/products/${prod.id}`, { name: PRODUCT_NAME, model: 'VM-1', revision: 'Rev.C', version: 1 });
  check('제품 수정: 이전 버전으로 저장 시 409', r.status === 409, st(r));
  r = await admin.patch('/api/admin/products/00000000-0000-4000-8000-000000000000', { name: 'x', version: 1 });
  check('제품 수정: 없는 제품 404', r.status === 404, st(r));
  r = await admin.get(`/api/admin/products/${prod.id}/revisions`);
  const revs = r.json?.revisions ?? [];
  check('Revision 변경 이력 생성(Rev.A 최초, Rev.A→Rev.B)', r.status === 200 && revs.length === 2
    && revs.some((x) => x.revision === 'Rev.A' && x.prev_revision === null)
    && revs.some((x) => x.revision === 'Rev.B' && x.prev_revision === 'Rev.A' && x.changed_by_name === meAdmin.name), st(r));
  r = await admin.patch(`/api/admin/products/${prod.id}`, { action: 'delete', version: 1 });
  check('제품 삭제: 이전 버전이면 409', r.status === 409, st(r));
  r = await admin.patch(`/api/admin/products/${prod.id}`, { action: 'delete', version: 2 });
  check('제품 삭제(soft delete, 200)', r.status === 200 && !!r.json.product.deleted_at && r.json.product.version === 3, st(r));
  r = await admin.get('/api/admin/products');
  check('기본 목록에서는 삭제된 제품 제외', r.status === 200 && !r.json.products.some((p) => p.id === prod.id), st(r));
  r = await admin.get('/api/admin/products?includeDeleted=1');
  check('includeDeleted 목록에는 삭제된 제품 포함', r.status === 200 && r.json.products.some((p) => p.id === prod.id && p.deleted_at), st(r));
  r = await admin.post('/api/admin/products', { name: PRODUCT_NAME, model: 'VM-1' });
  const twin = r.json?.product;
  check('삭제된 제품과 같은 이름으로 새 제품 등록 가능', r.status === 200 && !!twin?.id, st(r));
  r = await admin.patch(`/api/admin/products/${prod.id}`, { action: 'restore', version: 3 });
  check('복원: 같은 제품명+모델이 사용 중이면 409', r.status === 409, st(r));
  r = await admin.patch(`/api/admin/products/${twin.id}`, { action: 'delete', version: twin.version });
  check('중복 제품 삭제(200)', r.status === 200, st(r));
  r = await admin.patch(`/api/admin/products/${prod.id}`, { action: 'restore', version: 3 });
  check('제품 복원(200)', r.status === 200 && r.json.product.deleted_at === null && r.json.product.version === 4, st(r));
  r = await admin.get('/api/admin/products');
  check('복원 후 기본 목록에 다시 표시', r.status === 200 && r.json.products.some((p) => p.id === prod.id), st(r));
  r = await admin.get('/admin/products');
  check('제품 관리 화면에 고객사 항목 없음', r.status === 200 && !/고객사/.test(r.text), `${r.status}`);

  // ───────────────────────── 업무분류 관리 ─────────────────────────
  section('업무분류 관리');
  r = await admin.post('/api/admin/categories', { name: CATEGORY_NAME, sort_order: 77 });
  const cat = r.json?.category;
  check('업무분류 추가(200)', r.status === 200 && !!cat?.id && cat.sort_order === 77 && cat.is_active === true, st(r));
  r = await admin.post('/api/admin/categories', { name: CATEGORY_NAME });
  check('업무분류: 같은 이름 거부(409)', r.status === 409, st(r));
  r = await admin.post('/api/admin/categories', { name: '' });
  check('업무분류: 이름 없음 거부(400)', r.status === 400, st(r));
  r = await admin.patch(`/api/admin/categories/${cat.id}`, { name: `${CATEGORY_NAME}-수정`, sort_order: 78, is_active: false });
  check('업무분류 수정(200)', r.status === 200 && r.json.category.name === `${CATEGORY_NAME}-수정` && r.json.category.sort_order === 78 && r.json.category.is_active === false, st(r));
  r = await admin.get('/api/admin/categories');
  check('업무분류 목록(사용 안 함 포함)', r.status === 200 && r.json.categories.some((c) => c.id === cat.id && !c.is_active), st(r));
  r = await admin.del(`/api/admin/categories/${cat.id}`);
  check('업무분류 삭제(200)', r.status === 200, st(r));
  r = await admin.del(`/api/admin/categories/${cat.id}`);
  check('업무분류: 이미 삭제된 분류 404', r.status === 404, st(r));

  // ───────────────────────── 시스템 설정 ─────────────────────────
  section('시스템 설정');
  r = await admin.get('/api/admin/settings');
  check('설정 조회(200)', r.status === 200 && typeof r.json.settings.lab_name === 'string' && typeof r.json.status.email_reset_enabled === 'boolean', st(r));
  restore.settings = r.json.settings;
  const secrets = [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SUPABASE_ANON_KEY, process.env.DATABASE_URL].filter(Boolean);
  check('설정 응답에 키·DB 주소 없음', secrets.every((s) => !r.text.includes(s)) && !/DATABASE_URL|SERVICE_ROLE/i.test(r.text));
  const labName = `검증연구소${String(TS).slice(-5)}`;
  const contact = `검증 문의 안내 ${TS}\n내선 1234`;
  r = await admin.put('/api/admin/settings', { lab_name: labName, admin_contact: contact, attachment_max_mb: 77 });
  check('설정 저장(200)', r.status === 200 && r.json.settings.lab_name === labName && r.json.settings.attachment_max_mb === 77, st(r));
  r = await admin.put('/api/admin/settings', { attachment_max_mb: 0 });
  check('설정: 첨부 크기 0 거부(400)', r.status === 400, st(r));
  r = await admin.put('/api/admin/settings', { attachment_max_mb: 201 });
  check('설정: 첨부 크기 201 거부(400)', r.status === 400, st(r));
  r = await admin.put('/api/admin/settings', { attachment_max_mb: 12.5 });
  check('설정: 첨부 크기 소수 거부(400)', r.status === 400, st(r));
  r = await anon.get('/login');
  check('로그인 화면에 연구소 이름 반영(login_notice)', r.status === 200 && r.text.includes(labName), `${r.status}`);
  r = await anon.get('/forgot-password');
  check('비밀번호 찾기 화면에 관리자 문의 방법 반영(login_notice)', r.status === 200 && r.text.includes(`검증 문의 안내 ${TS}`), `${r.status}`);
  r = await admin.get('/admin/settings');
  check('설정 화면에 키·DB 주소 없음', r.status === 200 && secrets.every((s) => !r.text.includes(s)), `${r.status}`);
  r = await admin.put('/api/admin/settings', restore.settings);
  check('설정 원래 값으로 복원', r.status === 200 && r.json.settings.lab_name === restore.settings.lab_name
    && r.json.settings.admin_contact === restore.settings.admin_contact && r.json.settings.attachment_max_mb === restore.settings.attachment_max_mb, st(r));
  if (r.status === 200) restore.settings = null;

  // ───────────────────────── 직원의 관리자 API 접근 차단 ─────────────────────────
  section('권한: 직원은 관리자 API 403');
  const nil = '00000000-0000-4000-8000-000000000000';
  const adminCalls = [
    ['GET', '/api/admin/users'], ['POST', '/api/admin/users'], ['PATCH', `/api/admin/users/${testId}`], ['POST', `/api/admin/users/${testId}/password`],
    ['GET', '/api/admin/products'], ['POST', '/api/admin/products'], ['PATCH', `/api/admin/products/${prod.id}`], ['GET', `/api/admin/products/${prod.id}/revisions`],
    ['GET', '/api/admin/categories'], ['POST', '/api/admin/categories'], ['PATCH', `/api/admin/categories/${nil}`], ['DELETE', `/api/admin/categories/${nil}`],
    ['GET', '/api/admin/settings'], ['PUT', '/api/admin/settings'],
  ];
  for (const [m, u] of adminCalls) {
    const body = m === 'GET' ? undefined : { name: 'x', email: 'x@lab.test', password: PW.init6, confirm: PW.init6, is_active: false, lab_name: 'x', version: 1 };
    r = await emp1.request(m, u, body);
    check(`emp1 ${m} ${u.replace(/[0-9a-f-]{36}/g, ':id')} → 403`, r.status === 403, st(r));
  }
  r = await anon.get('/api/admin/users');
  check('비로그인 관리자 API → 401', r.status === 401, st(r));
  r = await anon.request('PATCH', '/api/me', { name: 'x' });
  check('비로그인 /api/me → 401', r.status === 401, st(r));
  r = await admin.get('/api/admin/users');
  check('emp1 요청으로 바뀐 것 없음(검증 직원 그대로)', r.status === 200 && r.json.users.some((u) => u.id === testId && u.is_active && u.name === '검증직원2'), st(r));

  // ───────────────────────── 내 정보 ─────────────────────────
  section('내 정보');
  r = await emp1.patch('/api/me', { name: '' });
  check('이름 변경: 빈 이름 거부(400)', r.status === 400, st(r));
  r = await emp1.patch('/api/me', { name: `${restore.emp1Name}검증`, role: 'admin', is_active: false });
  check('이름 변경(200, 역할은 바뀌지 않음)', r.status === 200 && r.json.me.name === `${restore.emp1Name}검증` && r.json.me.role === 'employee', st(r));
  r = await emp1.get('/api/me');
  check('이름 변경 반영', r.status === 200 && r.json.me.name === `${restore.emp1Name}검증` && r.json.me.role === 'employee', st(r));
  r = await emp1.patch('/api/me', { name: restore.emp1Name });
  check('이름 원래대로 복원', r.status === 200 && r.json.me.name === restore.emp1Name, st(r));
  if (r.status === 200) restore.emp1Name = null;

  // 비밀번호 변경은 검증용 계정으로만 한다(가상 계정 비밀번호는 건드리지 않는다).
  r = await tester.post('/api/me/password', { current: PW.reset6, password: PW.self11, confirm: PW.self11 });
  check('비밀번호 변경: 11자 거부(400)', r.status === 400, st(r));
  r = await tester.post('/api/me/password', { current: PW.reset6, password: PW.self12, confirm: `${PW.self12}x` });
  check('비밀번호 변경: 확인 불일치 거부(400)', r.status === 400, st(r));
  r = await tester.post('/api/me/password', { current: `${PW.reset6}x`, password: PW.self12, confirm: PW.self12 });
  check('비밀번호 변경: 현재 비밀번호 틀림(400)', r.status === 400 && /현재 비밀번호/.test(r.json?.error ?? ''), st(r));
  r = await tester.post('/api/me/password', { current: PW.reset6, password: PW.self12, confirm: PW.self12 });
  check('비밀번호 변경: 12자 이상 허용, 응답은 { ok: true } 뿐', r.status === 200 && JSON.stringify(r.json) === '{"ok":true}', st(r));
  check('비밀번호 변경 응답에 비밀번호 없음', noPassword(r, PW.self12, PW.reset6));
  r = await tester.get('/api/me');
  check('비밀번호 변경 후 현재 세션 유지', r.status === 200, st(r));
  r = await new Session().login(TEST_EMAIL, PW.reset6);
  check('비밀번호 변경 후 이전 비밀번호 로그인 실패', r.status === 401, st(r));
  r = await new Session().login(TEST_EMAIL, PW.self12);
  check('비밀번호 변경 후 새 비밀번호 로그인 성공', r.status === 200, st(r));

  // ───────────────────────── 전체 검색 · 이력 (공개 범위) ─────────────────────────
  section('전체 검색 · 이력');
  const kst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date());
  const curY = Number(kst.slice(0, 4)), curM = Number(kst.slice(5, 7));
  // 숨김 기록: emp1 의 "제출되지 않은 달". 기본은 금월(가상 데이터에서 작성중). 다른 검증이 금월을 제출해 두었다면 보고서가 없는 먼 달을 쓴다.
  const [e1cur] = await sql`select status from public.monthly_reports where user_id = ${meEmp1.id} and year = ${curY} and month = ${curM}`;
  const hiddenYm = e1cur && ['submitted', 'reviewed', 'finalized'].includes(e1cur.status) ? { y: 2099, m: 12 } : { y: curY, m: curM };
  // 공개 기록: emp2 의 "제출 이후 상태인 달" 중 가장 최근(가상 데이터에서는 금월 제출완료).
  const [e2sh] = await sql`select year, month from public.monthly_reports where user_id = ${meEmp2.id} and status in ('submitted','reviewed','finalized') order by year desc, month desc limit 1`;
  const [wba] = await sql`select id from public.products where model = 'WBA-2600' and deleted_at is null`;
  const fixtureProduct = wba?.id ?? prod.id;
  console.log(`  (준비) emp1 미제출 달 ${hiddenYm.y}-${hiddenYm.m}${hiddenYm.y === curY ? ' [금월]' : ''}, emp2 제출된 달 ${e2sh ? `${e2sh.year}-${e2sh.month}${e2sh.year === curY && e2sh.month === curM ? ' [금월]' : ''}` : '없음'}`);
  const [hid] = await sql`insert into public.dev_works (user_id, year, month, product_id, title, status, progress, work_done)
    values (${meEmp1.id}, ${hiddenYm.y}, ${hiddenYm.m}, ${fixtureProduct}, ${`${MARK}H 숨김 검증`}, 'in_progress', 10, '미제출 달 기록') returning id`;
  let shared = null;
  if (e2sh) {
    [shared] = await sql`insert into public.dev_works (user_id, year, month, product_id, title, status, progress, work_done)
      values (${meEmp2.id}, ${e2sh.year}, ${e2sh.month}, ${fixtureProduct}, ${`${MARK}S 공유 검증`}, 'in_progress', 20, '제출된 달 기록') returning id`;
  }
  check('검증 준비: emp2 의 제출된 달이 있음', !!shared);
  const hit = (res, id) => res.text.includes(`data-hit="dev_works:${id}"`);

  r = await emp1.get(`/search?q=${MARK}`);
  check('emp1 검색: 본인 미제출 달 기록 포함', r.status === 200 && hit(r, hid.id), `${r.status}`);
  check('emp1 검색: emp2 의 제출된 달 기록 포함', !!shared && hit(r, shared.id));
  check('emp1 검색: 다른 직원 기록 링크에 user 지정', !!shared && r.text.includes(`tab=detail&amp;user=${meEmp2.id}`));
  r = await emp2.get(`/search?q=${MARK}`);
  check('emp2 검색: 본인 기록 포함', r.status === 200 && !!shared && hit(r, shared.id), `${r.status}`);
  check('emp2 검색: emp1 의 미제출 달 기록 미포함', r.status === 200 && !hit(r, hid.id) && !r.text.includes(`${MARK}H`));
  r = await admin.get(`/search?q=${MARK}`);
  check('관리자 검색: 두 기록 모두 포함', r.status === 200 && hit(r, hid.id) && !!shared && hit(r, shared.id), `${r.status}`);

  r = await emp1.get('/search?q=WBA');
  const total = Number(/data-search-total="(\d+)"/.exec(r.text)?.[1] ?? 0);
  check("emp1 'WBA' 검색 결과 있음", r.status === 200 && total > 0 && r.text.includes('data-group="products"') && r.text.replace(/<[^>]+>/g, '').includes('WBA-2600'), `${r.status} total=${total}`);
  check('검색 화면에 공개 범위 안내 표시', r.text.includes('권한 범위 안에서 검색됩니다') && r.text.includes('제출 이후 공개된 것만'));
  r = await emp1.get(`/search?q=${encodeURIComponent('<script>alert(1)</script>')}`);
  check('검색어의 HTML 은 해석되지 않음', r.status === 200 && !r.text.includes('<script>alert(1)</script>'), `${r.status}`);
  r = await emp1.get(`/search?q=${encodeURIComponent('100%_\\')}`);
  check('검색어의 %, _, \\ 는 문자 그대로 처리', r.status === 200 && /data-search-total="0"/.test(r.text), `${r.status}`);
  r = await emp1.get('/search?q=W');
  check('검색어 1자: 안내 표시', r.status === 200 && r.text.includes('2자 이상') && !r.text.includes('data-search-total'), `${r.status}`);
  r = await emp1.get('/search');
  check('검색어 없음: 안내 표시', r.status === 200 && r.text.includes('검색어를 입력해 주세요'), `${r.status}`);

  r = await emp1.get('/history/my');
  check('emp1 내 업무 이력: 본인 기록만', r.status === 200 && r.text.includes(`${MARK}H`) && !r.text.includes(`${MARK}S`), `${r.status}`);
  r = await emp1.get(`/history/my?year=${hiddenYm.y}`);
  check('내 업무 이력: 연도 선택', r.status === 200 && r.text.includes(`${MARK}H`), `${r.status}`);
  r = await emp2.get(`/history/products?product=${fixtureProduct}`);
  check('emp2 제품 개발이력: emp1 미제출 달 기록 미포함', r.status === 200 && !r.text.includes(`${MARK}H`) && !!shared && r.text.includes(`${MARK}S`), `${r.status}`);
  check('제품 개발이력: 공개 범위 안내 · 고객사 없음', r.text.includes('공개 범위') && !/고객사/.test(r.text));
  r = await emp1.get(`/history/products?product=${fixtureProduct}`);
  check('emp1 제품 개발이력: 본인 기록 + emp2 공개 기록', r.status === 200 && r.text.includes(`${MARK}H`) && !!shared && r.text.includes(`${MARK}S`), `${r.status}`);
  r = await admin.get(`/history/products?product=${fixtureProduct}`);
  check('관리자 제품 개발이력: 모두 포함', r.status === 200 && r.text.includes(`${MARK}H`) && !!shared && r.text.includes(`${MARK}S`), `${r.status}`);
  r = await admin.patch(`/api/admin/products/${prod.id}`, { action: 'delete', version: 4 });
  check('검증 제품 삭제(이력 화면 확인용)', r.status === 200, st(r));
  r = await emp1.get(`/history/products?product=${prod.id}`);
  check('삭제된 제품도 개발이력 표시(Revision 변경 포함)', r.status === 200 && r.text.includes(PRODUCT_NAME) && r.text.includes('삭제됨') && r.text.includes('Rev.B'), `${r.status}`);
  r = await emp1.get('/history/products?product=not-a-uuid');
  check('제품 개발이력: 잘못된 제품 값은 안내만 표시', r.status === 200 && r.text.includes('제품을 찾을 수 없습니다'), `${r.status}`);

  // ───────────────────────── 화면 접근 ─────────────────────────
  section('화면 접근');
  const adminPages = ['/admin/users', '/admin/products', '/admin/categories', '/admin/settings'];
  const userPages = ['/me', '/search?q=WBA', '/history/my', '/history/products'];
  for (const p of [...adminPages, ...userPages]) {
    r = await admin.get(p);
    check(`관리자 GET ${p} → 200`, r.status === 200, `${r.status}`);
  }
  for (const p of userPages) {
    r = await emp1.get(p);
    check(`emp1 GET ${p} → 200`, r.status === 200, `${r.status}`);
  }
  for (const p of adminPages) {
    r = await emp1.get(p);
    const loc = r.headers.get('location') ?? '';
    const redirected = (r.status >= 300 && r.status < 400 && loc.includes('/dashboard')) || (r.status === 200 && r.text.includes('/dashboard?denied=1'));
    check(`emp1 GET ${p} → 대시보드로 이동(관리 화면 내용 없음)`, redirected && !r.text.includes(accounts.admin.email) && !r.text.includes(TEST_EMAIL), `${r.status} ${loc}`);
  }
  r = await emp1.get('/history');
  check('GET /history → 내 업무 이력으로 이동', r.status >= 300 && r.status < 400 && (r.headers.get('location') ?? '').includes('/history/my'), `${r.status}`);
  r = await anon.get('/me');
  check('비로그인 GET /me → 로그인 화면으로 이동', r.status >= 300 && r.status < 400 && (r.headers.get('location') ?? '').includes('/login'), `${r.status}`);
} catch (e) {
  fails.push(`예외: ${e?.message ?? e}`);
  console.error('\n검증 중 예외:', e?.stack ?? e);
} finally {
  // ── 정리: 바꾼 값 복원, 검증용 자료 삭제 ──
  try {
    if (restore.settings) {
      for (const [k, v] of Object.entries(restore.settings)) await sql`update public.app_settings set value = ${String(v)} where key = ${k}`;
      console.log('\n(정리) 시스템 설정을 DB 에서 직접 복원했습니다.');
    }
    if (restore.emp1Name) {
      await sql`update public.profiles set name = ${restore.emp1Name} where lower(email) = ${accounts.emp1.email}`;
      console.log('(정리) emp1 이름을 DB 에서 직접 복원했습니다.');
    }
    await purgeLeftovers();
    const [left] = await sql`select
      (select count(*)::int from public.profiles where email like 'verify-%@lab.test') as users,
      (select count(*)::int from public.products where name like 'VERIFY-제품-%') as products,
      (select count(*)::int from public.work_categories where name like 'VERIFY-분류-%') as categories,
      (select count(*)::int from public.dev_works where title like 'VERIFYSRCH%') as works,
      (select name from public.profiles where lower(email) = ${accounts.emp1.email}) as emp1_name`;
    check('정리: 검증용 자료가 남지 않음', left.users + left.products + left.categories + left.works === 0, JSON.stringify(left));
    check('정리: emp1 이름 원상태', left.emp1_name === accounts.emp1.name, left.emp1_name);
    const s = new Session();
    check('정리: 가상 계정(admin, emp1) 로그인 그대로 가능',
      (await s.login(accounts.admin.email, accounts.admin.password)).status === 200 && (await new Session().login(accounts.emp1.email, accounts.emp1.password)).status === 200);
  } catch (e) {
    fails.push(`정리 실패: ${e?.message ?? e}`);
    console.error('정리 중 오류:', e?.message ?? e);
  }
  await sql.end();
}

console.log(`\n결과: 통과 ${pass}건, 실패 ${fails.length}건`);
if (fails.length) {
  for (const f of fails) console.log(`  - ${f}`);
  process.exitCode = 1;
}
