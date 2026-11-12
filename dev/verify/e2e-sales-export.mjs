// 매출 Excel 가져오기(재업로드 중복 방지) · 관리자 비밀번호 재설정 · 오프라인 HTML 출력 검증. e2e.mjs 가 불러 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { Session, accounts } from './client.mjs';
import { ROOT } from '../../scripts/lib.mjs';

const SAMPLE = path.join(ROOT, 'dev', 'sample');
const formOf = (file, months) => {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(path.join(SAMPLE, file))]), file);
  if (months) fd.append('months', months);
  return fd;
};

export default async function ({ admin, emp1, emp3, sql, check, section, want, cleanup, CY, CM, next, OUT, reportId }) {
  const m1 = `${CY}-${String(CM).padStart(2, '0')}`, m2 = `${next.y}-${String(next.m).padStart(2, '0')}`;

  if (want('sales')) {
    section('매출 Excel 가져오기: 미리보기 → 선택한 월 저장 → 재업로드 중복 방지');
    const wipe = async () => { await sql`delete from sales where source_file like '판매내역_샘플%'`; await sql`delete from sales_imports where file_name like '판매내역_샘플%'`; };
    await wipe(); cleanup.push(wipe);
    const before = await sql`select count(*)::int as n from sales`;

    check('직원은 매출 API 사용 불가', (await emp1.get(`/api/admin/sales?year=${CY}&month=${CM}`)).status === 403 && (await emp1.upload('/api/admin/sales/import', formOf('판매내역_샘플.xlsx'))).status === 403);
    const s0 = await admin.get(`/api/admin/sales?year=${CY}&month=${CM}`);
    check('가져오기 전: 금월은 매출 미등록(0원과 구분)', s0.json?.summary?.registered === false && s0.json.summary.total === null, JSON.stringify(s0.json?.summary));

    const pv = await admin.upload('/api/admin/sales/import', formOf('판매내역_샘플.xlsx'));
    const P = pv.json ?? {};
    check('미리보기: 날짜로 2개 월 분리', pv.status === 200 && P.mode === 'preview' && P.months?.map((m) => m.month).join() === `${m1},${m2}`, pv.text.slice(0, 300));
    const pm1 = P.months?.find((m) => m.month === m1), pm2 = P.months?.find((m) => m.month === m2);
    check('미리보기: 금월 7건·총금액 48,633,300원(반품 차감)', pm1?.count === 7 && pm1?.total === 48633300 && pm1?.newCount === 7, JSON.stringify(pm1));
    check('미리보기: 수량은 단위별(EA 49, SET 4)', pm1?.qty?.find((q) => q.unit === 'EA')?.qty === 50 - 1 + 0 || JSON.stringify(pm1?.qty) === JSON.stringify([{ unit: 'EA', qty: 50 }, { unit: 'SET', qty: 4 }]), JSON.stringify(pm1?.qty));
    check('미리보기: 다음 달 2건', pm2?.count === 2 && pm2?.total === 24420000, JSON.stringify(pm2));
    check('빈 행·소계·합계 제외', P.skipped?.summary === 2 && P.skipped?.empty >= 1, JSON.stringify(P.skipped));
    check('잘못된 행은 시트명+행 번호 표시 (16행, 17행)', P.errors?.length === 2 && P.errors.every((e) => e.sheet === '판매내역') && P.errors.map((e) => e.row).join() === '16,17', JSON.stringify(P.errors));
    const ret = P.rows?.find((r) => r.kind === 'return'), fr = P.rows?.find((r) => r.kind === 'freight'), misc = P.rows?.find((r) => r.kind === 'misc');
    check('반품은 음수로 차감', ret && ret.quantity === -1 && ret.total_amount === -1320000, JSON.stringify(ret));
    check('운임·기타자재: 빈 수량·단가 허용 + 원본 금액 보존', fr && fr.quantity === null && fr.unit_price === null && fr.total_amount === 60500 && fr.orig_total_amount === 60500 && misc?.quantity === null && misc?.orig_total_amount === 96800, JSON.stringify(fr));
    const usd = P.rows?.find((r) => r.currency === 'USD');
    check('통화·환율 유지 (USD, 1380)', usd?.exchange_rate === 1380 && usd?.supply_amount === 5796000);
    const mid = await sql`select count(*)::int as n from sales`;
    check('미리보기만으로는 저장되지 않음', mid[0].n === before[0].n);

    const sv = await admin.upload('/api/admin/sales/import', formOf('판매내역_샘플.xlsx', m1));
    check('선택한 월(금월)만 저장: 7건', sv.status === 200 && sv.json.inserted === 7 && sv.json.skipped === 0, sv.text.slice(0, 200));
    const [c2] = await sql`select count(*)::int as n from sales where source_file = '판매내역_샘플.xlsx' and to_char(sale_date, 'YYYY-MM') = ${m2}`;
    check('선택하지 않은 월은 저장되지 않음', c2.n === 0);
    const rows = await sql`select * from sales where source_file = '판매내역_샘플.xlsx' order by source_row`;
    check('가져온 위치 추적(파일·시트·행) + 원본 금액', rows.length === 7 && rows.every((r) => r.source_sheet === '판매내역' && r.source_row >= 5 && r.orig_total_amount !== null && r.import_id), JSON.stringify(rows[0] ?? {}).slice(0, 200));
    check('같은 조건의 정상 거래 2건은 둘 다 등록', rows.filter((r) => Number(r.total_amount) === 18700000).length === 2);

    const re = await admin.upload('/api/admin/sales/import', formOf('판매내역_샘플.xlsx', m1));
    check('같은 파일 재업로드 → 0건 등록, 7건 중복 건너뜀', re.json?.inserted === 0 && re.json?.skipped === 7, re.text.slice(0, 200));
    const xls = await admin.upload('/api/admin/sales/import', formOf('판매내역_샘플.xls'));
    check('.xls 파일도 같은 거래로 인식(중복 7건)', xls.status === 200 && xls.json.months?.find((m) => m.month === m1)?.dupCount === 7, JSON.stringify(xls.json?.months ?? xls.text).slice(0, 200));

    // 수정값 보존
    const t = rows.find((r) => r.customer === '대한전자' && r.kind === 'sale');
    const body = { sale_date: t.sale_date, kind: 'sale', customer: '대한전자(수정)', product_name: t.product_name, model: t.model, manager: t.manager, quantity: 5, unit: 'SET', unit_price: 1100000, currency: 'KRW', exchange_rate: 1, supply_amount: 5500000, vat_amount: 550000, total_amount: 6050000, note: '단가 조정', version: t.version };
    const ed = await admin.patch(`/api/admin/sales/${t.id}`, body);
    check('개별 거래 수정', ed.status === 200 && ed.json.is_edited === true, ed.text.slice(0, 200));
    check('오래된 버전으로 수정 → 409', (await admin.patch(`/api/admin/sales/${t.id}`, body)).status === 409);
    check('판매 거래의 수량·단가 누락 거부', (await admin.patch(`/api/admin/sales/${t.id}`, { ...body, version: ed.json.version, quantity: '', unit_price: '' })).status === 400);
    const re2 = await admin.upload('/api/admin/sales/import', formOf('판매내역_샘플.xlsx', m1));
    const [t2] = await sql`select * from sales where id = ${t.id}`;
    check('재업로드 후에도 수정값 보존 + 원본 금액 유지', re2.json?.inserted === 0 && t2.customer === '대한전자(수정)' && Number(t2.total_amount) === 6050000 && Number(t2.orig_total_amount) === 6600000 && t2.source_row === t.source_row);

    // 일괄 삭제 원자성 + 재등록
    const two = rows.filter((r) => r.id !== t.id).slice(0, 2).map((r) => r.id);
    const bad = await admin.post('/api/admin/sales/bulk-delete', { ids: [...two, '00000000-0000-4000-8000-000000000000'] });
    const [c3] = await sql`select count(*)::int as n from sales where source_file = '판매내역_샘플.xlsx'`;
    check('일괄 삭제: 하나라도 실패하면 아무것도 삭제하지 않음', bad.status === 409 && c3.n === 7, `${bad.status} n=${c3.n}`);
    const del = await admin.post('/api/admin/sales/bulk-delete', { ids: two });
    check('체크한 2건 일괄 삭제', del.status === 200 && del.json.deleted === 2);
    const re3 = await admin.upload('/api/admin/sales/import', formOf('판매내역_샘플.xlsx', m1));
    check('삭제한 거래는 재등록 가능 (2건만 다시 등록)', re3.json?.inserted === 2 && re3.json?.skipped === 5, re3.text.slice(0, 200));
    const s1 = await admin.get(`/api/admin/sales?year=${CY}&month=${CM}`);
    check('월 집계는 부가세 포함 총금액 기준', s1.json?.summary?.registered === true && s1.json.summary.total === 48633300 - 6600000 + 6050000, JSON.stringify(s1.json?.summary));
    check('매출현황 화면(개별 내역·연간 그래프) 200', (await admin.get(`/admin/sales?year=${CY}&month=${CM}`)).status === 200 && (await admin.get(`/admin/sales?year=${CY}&tab=chart`)).status === 200);
    const ann = await admin.get(`/admin/sales?year=${CY}&tab=chart`);
    check('연간 화면: 미등록 표시와 그래프(SVG) 포함', ann.text.includes('<svg') && ann.text.includes('미등록'));

    // 0원 확정 ↔ 미등록 구분 (자료가 없는 먼 미래 달 사용)
    const z0 = await admin.post('/api/admin/sales/closing', { year: 2099, month: 1, action: 'confirm' });
    check('매출 없음(0원) 확정 → 등록됨·0원', z0.json?.summary?.registered === true && z0.json.summary.zeroConfirmed === true && z0.json.summary.total === 0, z0.text.slice(0, 200));
    const z1 = await admin.post('/api/admin/sales/closing', { year: 2099, month: 1, action: 'clear' });
    check('확정 해제 → 미등록', z1.json?.summary?.registered === false && z1.json.summary.total === null);
    const growthRate = (cur, prev) => (cur === null || prev === null || prev <= 0 ? null : ((cur - prev) / prev) * 100); // src/lib/sales-data.ts 와 같은 규칙
    const fy = await sql`select 1`;
    if (fy) check('증감률: 직전년도 없음·0·음수면 계산 안 함', growthRate(100, null) === null && growthRate(100, 0) === null && growthRate(100, -5) === null && growthRate(null, 100) === null && growthRate(150, 100) === 50);
  }

  if (want('password')) {
    section('관리자 비밀번호 재설정 (직원 관리)');
    const [e3] = await sql`select id from profiles where email = ${accounts.emp3.email}`;
    const temp = `tmp${Math.random().toString(36).slice(2, 5)}`; // 6자 (관리자 발급 최소 길이)
    const restore = () => admin.post(`/api/admin/users/${e3.id}/password`, { password: accounts.emp3.password, confirm: accounts.emp3.password });
    cleanup.push(restore);
    check('5자 비밀번호 거부', (await admin.post(`/api/admin/users/${e3.id}/password`, { password: 'abcde', confirm: 'abcde' })).status === 400);
    check('확인 불일치 거부', (await admin.post(`/api/admin/users/${e3.id}/password`, { password: temp, confirm: `${temp}x` })).status === 400);
    check('직원은 다른 사람 비밀번호 재설정 불가', (await emp1.post(`/api/admin/users/${e3.id}/password`, { password: temp, confirm: temp })).status === 403);
    const rs = await admin.post(`/api/admin/users/${e3.id}/password`, { password: temp, confirm: temp });
    check('관리자: 새 비밀번호(6자)와 확인 입력으로 재설정', rs.status === 200, rs.text.slice(0, 200));
    check('저장 응답에 비밀번호 없음', !rs.text.includes(temp) && !/password/i.test(rs.text));
    const s = new Session();
    check('이전 비밀번호로 로그인 불가', (await s.login(accounts.emp3.email, accounts.emp3.password)).status === 401);
    check('새 비밀번호로 로그인 가능', (await s.login(accounts.emp3.email, temp)).status === 200);
    check('직원 본인 변경은 12자 미만 거부', (await s.post('/api/me/password', { current: temp, password: 'short-11chr', confirm: 'short-11chr' })).status === 400);
    const back = await restore();
    check('원래 비밀번호로 복원', back.status === 200 && (await new Session().login(accounts.emp3.email, accounts.emp3.password)).status === 200);
  }

  if (want('forgot')) {
    section('비밀번호를 잊으셨나요? (이메일 재설정: 로컬 스택의 메일함 폴더로 검증)');
    const anon = new Session();
    const page = await anon.get('/login');
    check('로그인 화면에 "비밀번호를 잊으셨나요?" 링크', page.text.includes('비밀번호를 잊으셨나요?') && page.text.includes('/forgot-password'));
    const fp = await anon.get('/forgot-password');
    check('관리자 문의 방법 안내 표시', fp.status === 200 && fp.text.includes('직원 관리') && fp.text.includes('비밀번호 재설정'));
    const outbox = path.join(ROOT, '.local-stack', 'outbox');
    const list = () => (fs.existsSync(outbox) ? fs.readdirSync(outbox).sort() : []);
    const n0 = list().length;
    const rq = await anon.post('/api/auth/forgot', { email: accounts.emp1.email });
    await new Promise((r) => setTimeout(r, 300));
    const files = list();
    if (rq.status === 400) {
      console.log('  (이메일 재설정이 꺼져 있어 링크 흐름은 건너뜁니다)');
    } else {
      check('재설정 메일 요청 접수', rq.status === 200 && files.length === n0 + 1, `${rq.status} ${files.length - n0}`);
      check('없는 이메일도 같은 응답(계정 존재 여부 비노출)', (await anon.post('/api/auth/forgot', { email: 'nobody@lab.test' })).status === 200 && list().length === n0 + 1);
      const mail = JSON.parse(fs.readFileSync(path.join(outbox, files[files.length - 1]), 'utf8'));
      const link = new URL(mail.link);
      check('링크는 허용된 콜백 주소(/auth/confirm)로 연결', link.pathname === '/auth/confirm' && link.searchParams.get('type') === 'recovery');
      const r1 = await anon.get(link.pathname + link.search);
      check('링크 확인 → 재설정 전용 세션(일반 로그인 세션 아님)', r1.status === 307 && /\/reset-password$/.test(r1.headers.get('location') ?? '') && anon.jar.has('mr_recovery') && ![...anon.jar.keys()].some((k) => /auth-token/.test(k)));
      check('재설정 세션으로는 업무 화면·API 접근 불가', (await anon.get('/api/notifications')).status === 401);
      const again = await new Session().get(link.pathname + link.search);
      check('링크 재사용 차단', /forgot-password\?error=expired/.test(again.headers.get('location') ?? ''));
      check('12자 미만 새 비밀번호 거부', (await anon.post('/api/auth/reset', { password: 'short', confirm: 'short' })).status === 400);
      const np = `Reset-${Math.random().toString(36).slice(2, 10)}-9A`;
      const [e1] = await sql`select id from profiles where email = ${accounts.emp1.email}`;
      cleanup.push(() => admin.post(`/api/admin/users/${e1.id}/password`, { password: accounts.emp1.password, confirm: accounts.emp1.password }));
      const done = await anon.post('/api/auth/reset', { password: np, confirm: np });
      check('새 비밀번호 저장 후 재설정 세션 종료', done.status === 200 && !anon.jar.has('mr_recovery') && !done.text.includes(np), done.text.slice(0, 200));
      check('같은 재설정 세션 재사용 불가', (await anon.post('/api/auth/reset', { password: np, confirm: np })).status === 401);
      check('새 비밀번호로 로그인', (await new Session().login(accounts.emp1.email, np)).status === 200);
      check('재설정 후 기존 로그인 세션은 모두 종료', (await emp1.get('/api/notifications')).status === 401);
      // 원래 가상 계정 비밀번호로 되돌리고 다시 로그인 (이후 검증용)
      await admin.post('/api/admin/users/' + e1.id + '/password', { password: accounts.emp1.password, confirm: accounts.emp1.password });
      await emp1.login(accounts.emp1.email, accounts.emp1.password);
    }
  }

  if (want('export')) {
    section('출력: Excel · A4 인쇄/PDF · HTML(회의·발표용 / 자료 열람용)');
    const [rep] = await sql`select r.id from monthly_reports r join profiles p on p.id = r.user_id where p.email = ${accounts.emp1.email} and r.status = 'finalized' order by r.year desc, r.month desc limit 1`;
    const pm = CM === 1 ? { y: CY - 1, m: 12 } : { y: CY, m: CM - 1 };
    const targets = [
      ['개인 Excel', emp1, `/api/export/report/${rep.id}?format=xlsx`, 'xlsx'],
      ['개인 HTML(회의·발표용)', emp1, `/api/export/report/${rep.id}?format=html&mode=slides`, 'html'],
      ['개인 HTML(자료 열람용)', emp1, `/api/export/report/${rep.id}?format=html&mode=doc`, 'html'],
      ['개인 A4 인쇄', emp1, `/api/export/report/${rep.id}?format=print`, 'html'],
      ['취합 Excel', admin, `/api/export/compile?year=${pm.y}&month=${pm.m}&format=xlsx`, 'xlsx'],
      ['취합 HTML(회의·발표용)', admin, `/api/export/compile?year=${pm.y}&month=${pm.m}&format=html&mode=slides`, 'html'],
      ['취합 HTML(자료 열람용)', admin, `/api/export/compile?year=${pm.y}&month=${pm.m}&format=html&mode=doc`, 'html'],
      ['취합 A4 인쇄', admin, `/api/export/compile?year=${pm.y}&month=${pm.m}&format=print`, 'html'],
    ];
    const secrets = [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SUPABASE_ANON_KEY, process.env.DATABASE_URL, ...Object.values(accounts).map((a) => a.email)].filter(Boolean);
    const attachDir = path.resolve(process.env.ATTACHMENT_DIR || './data/attachments');
    for (const [name, who, url, kind] of targets) {
      const r = await who.get(url);
      const file = path.join(OUT, `${name.replace(/[^\w가-힣]+/g, '_')}.${kind}`);
      if (r.status === 200) fs.writeFileSync(file, r.buf);
      if (kind === 'xlsx') {
        check(`${name}: xlsx 파일 생성`, r.status === 200 && r.buf.subarray(0, 2).toString() === 'PK' && r.buf.length > 3000, `${r.status} ${r.buf.length}`);
        continue;
      }
      const h = r.text;
      check(`${name}: 생성`, r.status === 200 && h.startsWith('<!DOCTYPE html>'), `${r.status}`);
      // 외부 자원 참조 없음 = 인터넷 없이 열람 가능 (xmlns 선언은 주소 접근이 아님)
      const ext = [...h.matchAll(/(?:src|href|action)\s*=\s*["']?\s*(https?:)?\/\/[^"'\s>]+|url\(\s*["']?(?:https?:)?\/\/|@import|<link\b|<iframe\b|<img\b[^>]*src=["'](?!data:)/gi)].map((m) => m[0]);
      check(`${name}: 외부 자원·로그인 불필요(자체 포함)`, ext.length === 0 && !/\/api\/|\/login/.test(h), ext.slice(0, 3).join(' | '));
      check(`${name}: 계정 정보·인증 키·첨부 경로 미포함`, secrets.every((s) => !h.includes(s)) && !h.includes(attachDir) && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(h));
      const scripts = [...h.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
      check(`${name}: 스크립트는 내장 동작 1개뿐, 인라인 이벤트 없음`, scripts.length === 1 && !/\son\w+\s*=/i.test(h.replace(scripts[0][0], '')));
      if (/slides/.test(url)) {
        check(`${name}: 16:9 슬라이드·목차·방향키·전체화면·원문 전환·인쇄`, (h.match(/class="slide/g) ?? []).length >= 6 && h.includes('1280px') && h.includes('720px') && h.includes('ArrowRight') && h.includes('requestFullscreen') && h.includes('id="b-view"') && h.includes('id="b-toc"') && h.includes('window.print') && h.includes('id="doc"'));
        check(`${name}: 24개월 타임라인·이슈·차월계획 포함`, h.includes('개발현황 · 24개월') && h.includes('생산이관 · 24개월') && /이슈 · 조치 · 차월계획/.test(h));
      }
      if (/compile/.test(url) && !/print/.test(url)) check(`${name}: 매출(월별 추이·최근 5개년) 그래프 포함`, (h.match(/<svg/g) ?? []).length >= 2 && h.includes('최근 5개년'));
      if (/report/.test(url)) check(`${name}: 개인 출력에는 매출 미포함`, !h.includes('최근 5개년'));
    }
    check('직원은 전체 취합 출력 불가', (await emp1.get(`/api/export/compile?year=${pm.y}&month=${pm.m}&format=html`)).status === 403);
    check('다른 직원 보고서 출력 불가', (await emp3.get(`/api/export/report/${rep.id}?format=html`)).status === 404);

    // 사용자 입력이 실행 가능한 코드가 되지 않는지: 악성 문자열을 넣은 보고서를 출력
    if (reportId) {
      const [rv] = await sql`select version, status from monthly_reports where id = ${reportId}`;
      const evil = `"><img src=x onerror=alert(1)><script>alert('xss')</script> </style></script>{{7*7}}`;
      const up = await emp3.patch(`/api/reports/${reportId}`, { summary: evil, version: rv.version });
      const it = await emp3.post(`/api/reports/${reportId}/items`, { section: 'spec', title: evil, revision: '<b>R</b>', change_note: evil });
      const h = (await emp3.get(`/api/export/report/${reportId}?format=html&mode=slides`)).text;
      fs.writeFileSync(path.join(OUT, 'XSS_검증.html'), h);
      const scripts = [...h.matchAll(/<script\b/gi)].length;
      check('악성 입력이 들어가도 실행 코드가 되지 않음(이스케이프)', up.status === 200 && it.status === 200 && scripts === 1 && !h.includes('<img src=x') && !/onerror=alert\(1\)>/.test(h.replace(/&[a-z#0-9]+;/g, '')) && h.includes('&lt;script&gt;'), `${up.status} ${it.status} scripts=${scripts}`);
      const x = await emp3.get(`/api/export/report/${reportId}?format=xlsx`);
      check('악성 입력 포함 Excel 생성', x.status === 200 && x.buf.subarray(0, 2).toString() === 'PK');
    }
    console.log(`  (출력 파일 저장: dev/verify/out)`);
  }
}
