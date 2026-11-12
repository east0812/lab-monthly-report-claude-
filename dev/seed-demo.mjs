// 검증용 가상 데이터 생성 (운영 환경과 분리).
//   npm run local:seed            : 비어 있는 DB 에 가상 데이터 생성
//   npm run local:seed -- --reset : 업무 데이터와 가상 계정을 지우고 다시 생성
// 안전장치: .env.local 의 ALLOW_DEMO_SEED=true 일 때만 동작한다. 운영 DB 에서는 절대 켜지 말 것.
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { ROOT, loadEnv, requireEnv } from '../scripts/lib.mjs';

loadEnv();
requireEnv('DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
if (process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('ALLOW_DEMO_SEED=true 가 아니므로 중단합니다. (운영 환경 보호)');
  process.exit(1);
}
const RESET = process.argv.includes('--reset');
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { accounts } = JSON.parse(fs.readFileSync(path.join(ROOT, 'dev/demo-accounts.json'), 'utf8'));

// 고정 난수 (매번 같은 데이터)
let seed = 20261111;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const now = new Date();
const kst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(now);
const CUR_Y = Number(kst.slice(0, 4)), CUR_M = Number(kst.slice(5, 7));
const idx = (y, m) => y * 12 + (m - 1);
const fromIdx = (i) => ({ y: Math.floor(i / 12), m: (i % 12) + 1 });
const CUR = idx(CUR_Y, CUR_M);
const START = idx(CUR_Y - 1, 1);

try {
  const [{ n }] = await sql`select count(*)::int as n from public.monthly_reports`;
  if (n > 0 && !RESET) {
    console.error('이미 보고서 데이터가 있습니다. 다시 만들려면 --reset 을 붙여 주세요.');
    process.exit(1);
  }
  if (RESET) {
    console.log('기존 업무 데이터 삭제...');
    await sql`truncate public.notifications, public.sales, public.sales_imports, public.sales_closings, public.transfers, public.dev_works,
      public.report_attachments, public.report_status_history, public.dev_project_monthly, public.dev_projects, public.report_items,
      public.monthly_reports, public.product_revisions, public.products cascade`;
    for (const a of accounts) {
      const [p] = await sql`select id from public.profiles where lower(email) = ${a.email}`;
      if (p) { await sql`delete from public.profiles where id = ${p.id}`; await admin.auth.admin.deleteUser(p.id); }
    }
  }

  // 1) 계정
  console.log('가상 계정 생성...');
  const U = {};
  for (const a of accounts) {
    const { data, error } = await admin.auth.admin.createUser({ email: a.email, password: a.password, email_confirm: true, user_metadata: { name: a.name } });
    if (error) throw new Error(`계정 생성 실패(${a.email}): ${error.message}`);
    U[a.key] = data.user.id;
    await sql`insert into public.profiles (id, email, name, role, is_active) values (${data.user.id}, ${a.email}, ${a.name}, ${a.role}, ${a.active})`;
    if (!a.active) await admin.auth.admin.updateUserById(data.user.id, { ban_duration: '876000h' });
  }
  const emps = ['emp1', 'emp2', 'emp3'];

  // 2) 제품
  const prodDefs = [
    ['광대역 증폭기', 'WBA-2600', '증폭기', '2~6 GHz', 'Rev.C'], ['저잡음 증폭기', 'LNA-1800', '증폭기', '1.7~1.9 GHz', 'Rev.B'],
    ['대역통과 필터', 'BPF-3500', '필터', '3.4~3.6 GHz', 'Rev.A'], ['듀플렉서', 'DPX-0900', '필터', '880~960 MHz', 'Rev.D'],
    ['주파수 합성기', 'SYN-6000', '합성기', '0.1~6 GHz', 'Rev.B'], ['전력 분배기', 'PD-4W-2700', '수동소자', '0.7~2.7 GHz', 'Rev.A'],
    ['RF 스위치 모듈', 'SWM-8X8', '모듈', 'DC~8 GHz', 'Rev.A'], ['안테나 모듈', 'ANT-28G', '안테나', '26.5~29.5 GHz', 'Rev.A'],
  ];
  const P = [];
  for (const [name, model, family, freq_band, revision] of prodDefs) {
    const [p] = await sql`insert into public.products (name, model, family, freq_band, revision) values (${name}, ${model}, ${family}, ${freq_band}, ${revision}) returning id, name, model, revision`;
    P.push(p);
  }
  const cats = await sql`select id, name from public.work_categories order by sort_order`;

  // 3) 월차보고 + 항목
  console.log('월차보고·개발현황·생산이관 생성...');
  const ts = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 3, 0, 0)).toISOString();
  const reportOf = {}; // `${emp}:${i}` -> report id
  for (const e of emps) {
    for (let i = START; i <= CUR; i++) {
      const { y, m } = fromIdx(i);
      let status = 'finalized';
      if (i === CUR) status = e === 'emp1' ? 'draft' : e === 'emp2' ? 'submitted' : null;
      else if (i === CUR - 1) status = e === 'emp1' ? 'finalized' : e === 'emp2' ? 'reviewed' : 'rejected';
      if (!status) continue;
      const next = fromIdx(i + 1);
      const sub = status === 'draft' ? null : i === CUR ? new Date().toISOString() : ts(next.y, next.m, ri(1, 4));
      const [r] = await sql`insert into public.monthly_reports (user_id, year, month, status, summary, submitted_at, reviewed_at, finalized_at, rejected_at, reject_reason)
        values (${U[e]}, ${y}, ${m}, ${status}, ${`${m}월 주요 업무: ${pick(['시제품 시험 및 도면 개정', '양산 이관 준비와 사양서 정리', '신규 과제 설계 검토', '고객 요구사항 반영 설계 변경'])}. ${pick(['일정 내 진행 중입니다.', '일부 부품 납기 지연이 있었습니다.', '시험 결과 목표 규격을 만족했습니다.'])}`},
          ${sub}, ${['reviewed', 'finalized'].includes(status) ? ts(next.y, next.m, 6) : null}, ${status === 'finalized' ? ts(next.y, next.m, 8) : null},
          ${status === 'rejected' ? ts(next.y, next.m, 5) : null}, ${status === 'rejected' ? '시험결과 수치와 차월계획이 누락되었습니다. 보완 후 재제출 바랍니다.' : null})
        returning id`;
      reportOf[`${e}:${i}`] = r.id;
      if (sub) await sql`insert into public.report_status_history (report_id, from_status, to_status, actor_id, created_at) values (${r.id}, 'draft', 'submitted', ${U[e]}, ${sub})`;
      if (['reviewed', 'finalized'].includes(status)) await sql`insert into public.report_status_history (report_id, from_status, to_status, actor_id, created_at) values (${r.id}, 'submitted', 'reviewed', ${U.admin}, ${ts(next.y, next.m, 6)})`;
      if (status === 'finalized') await sql`insert into public.report_status_history (report_id, from_status, to_status, actor_id, created_at) values (${r.id}, 'reviewed', 'finalized', ${U.admin}, ${ts(next.y, next.m, 8)})`;
      if (status === 'rejected') await sql`insert into public.report_status_history (report_id, from_status, to_status, actor_id, reason, created_at) values (${r.id}, 'submitted', 'rejected', ${U.admin}, '시험결과 수치와 차월계획이 누락되었습니다. 보완 후 재제출 바랍니다.', ${ts(next.y, next.m, 5)})`;
      const items = [];
      const p1 = pick(P), p2 = pick(P);
      const st = () => (i < CUR - 1 ? pick(['done', 'done', 'in_progress']) : pick(['done', 'in_progress', 'on_hold']));
      items.push({ section: 'sm_drawing', product_id: p1.id, title: `${p1.model} 하우징 조립도`, revision: `Rev.${pick(['A', 'B', 'C'])}`, change_note: pick(['커넥터 위치 2mm 이동', '방열판 체결 홀 추가', '커버 두께 변경(1.5→2.0t)']), status: st() });
      items.push({ section: 'spec', product_id: p2.id, title: `${p2.model} 제작사양서`, revision: `Rev.${pick(['A', 'B'])}`, change_note: pick(['시험 항목(VSWR) 기준 갱신', '도금 사양 변경', '납품 포장 규격 추가']), status: st() });
      if (rnd() < 0.6) items.push({ section: 'education', category_id: cats.find((c) => c.name === '교육')?.id ?? null, title: pick(['RF 회로 시뮬레이션 교육', '신뢰성 시험 세미나', 'EMC 설계 온라인 과정']), content: '사내 교육 참석 및 자료 정리', schedule: `${m}월 2주차`, status: 'done' });
      if (rnd() < 0.7) items.push({ section: 'purchase', item_name: pick(['SMA 커넥터', '시험용 감쇠기 20dB', '타사 LNA 샘플', '고주파 케이블 어셈블리']), vendor: pick(['한빛전자', '대성부품', '코리아RF']), quantity: ri(2, 50), unit: 'EA', schedule: `${m}/${ri(5, 25)} 입고`, status: st() });
      if (rnd() < 0.6) items.push({ section: 'machining', item_name: pick(['알루미늄 하우징 시제품', '지그 가공', '방열판 가공']), vendor: pick(['정밀가공', '우성테크']), quantity: ri(1, 10), unit: pick(['EA', 'SET']), schedule: `${m}/${ri(10, 28)} 납품`, product_id: p1.id, status: st() });
      let so = 0;
      for (const it of items) {
        await sql`insert into public.report_items ${sql({ report_id: r.id, sort_order: so++, product_id: null, category_id: null, title: '', revision: '', change_note: '', content: '', item_name: '', vendor: '', quantity: null, unit: '', schedule: '', note: '', ...it })}`;
      }
    }
  }

  // 4) 개발과제 (기본 정보 + 월별 진행)
  const projDefs = [['emp1', '5G 중계기용 광대역 증폭기 개발', 0], ['emp2', '소형 주파수 합성기 국산화', 4], ['emp3', '28GHz 안테나 모듈 선행 개발', 7]];
  for (const [e, name, pi] of projDefs) {
    const [pj] = await sql`insert into public.dev_projects (user_id, name, product_id, category_id, goal, start_date, end_date)
      values (${U[e]}, ${name}, ${P[pi].id}, ${cats[0].id}, '목표 규격 만족 시제품 확보 및 양산 이관', ${`${CUR_Y - 1}-03-01`}, ${`${CUR_Y + 1}-02-28`}) returning id`;
    let prog = 0;
    for (let i = idx(CUR_Y - 1, 3); i <= CUR; i++) {
      const rid = reportOf[`${e}:${i}`];
      if (!rid) continue;
      prog = Math.min(95, prog + ri(3, 7));
      await sql`insert into public.dev_project_monthly (project_id, report_id, progress, status, result, issue, next_plan)
        values (${pj.id}, ${rid}, ${prog}, 'in_progress', ${pick(['회로 설계 검토 완료', '시제품 1차 시험 완료', 'PCB 재설계 진행', '환경시험 준비'])}, ${pick(['', '', '부품 납기 지연', '이득 평탄도 미달'])}, ${pick(['2차 시제품 제작', '신뢰성 시험', '설계 검증 보고서 작성'])})`;
    }
  }

  // 5) 개발현황: 담당자별 모델 2~3개, 월별 상태가 이어지도록
  const assign = { emp1: [0, 1, 6], emp2: [4, 2], emp3: [7, 3, 5] };
  const doneTexts = ['회로 시뮬레이션 및 레이아웃 수정', '시제품 조립과 초기 튜닝', '환경시험(온도 사이클) 수행', '고객 샘플 대응 및 측정 데이터 정리', '양산성 검토와 BOM 정리'];
  for (const e of emps) {
    for (const pi of assign[e]) {
      const begin = START + ri(0, 8);
      const len = rnd() < 0.65 ? 99 : ri(7, 14); // 99 = 금월까지 계속 진행
      let prev = null, prog = 0;
      for (let i = begin; i <= Math.min(CUR, begin + len); i++) {
        if (i === CUR && e === 'emp3') break; // emp3 는 금월 미작성
        const { y, m } = fromIdx(i);
        const step = i - begin;
        let status = step === 0 ? 'planned' : 'in_progress';
        if (step > 2 && rnd() < 0.12) status = 'on_hold';
        if (i === begin + len && i < CUR) status = rnd() < 0.85 ? 'done' : 'stopped';
        prog = status === 'done' ? 100 : Math.min(95, prog + (status === 'on_hold' ? 0 : ri(5, 12)));
        const [w] = await sql`insert into public.dev_works (user_id, year, month, product_id, revision, category_id, title, status, progress, work_done, test_result, issues, actions, next_plan, carried_from_id, updated_by)
          values (${U[e]}, ${y}, ${m}, ${P[pi].id}, ${P[pi].revision}, ${pick(cats.slice(0, 4)).id}, ${`${P[pi].model} ${pick(['성능 개선', '시제품 개발', '설계 검증'])}`}, ${status}, ${prog},
            ${status === 'planned' ? '' : pick(doneTexts)}, ${status === 'planned' ? '' : pick(['이득 32.1 dB, NF 1.2 dB (규격 만족)', 'VSWR 1.35:1, 삽입손실 0.8 dB', '온도 -20~60℃ 구간 특성 변동 ±0.6 dB', '출력 P1dB 38.5 dBm'])},
            ${pick(['', '', '고온에서 이득 저하', '납땜 불량 2건', '부품 단종 예고'])}, ${pick(['', '', '바이어스 회로 보정', '대체 부품 검토', '공정 조건 재설정'])},
            ${status === 'done' || status === 'stopped' ? '' : pick(['2차 시제품 제작', '신뢰성 시험 진행', '고객 승인 시험', '양산 이관 문서 작성'])}, ${prev}, ${U[e]})
          returning id`;
        prev = ['planned', 'in_progress', 'on_hold'].includes(status) ? w.id : null;
      }
    }
  }

  // 6) 생산이관
  const trDefs = [['emp1', 1, 5], ['emp2', 2, 8], ['emp3', 3, 3], ['emp1', 6, 14]];
  for (const [e, pi, off] of trDefs) {
    const begin = START + off;
    const stages = ['planned', 'in_progress', 'in_progress', 'in_progress', 'done'];
    for (let s = 0; s < stages.length; s++) {
      const i = begin + s * 2;
      if (i > CUR || (i === CUR && e === 'emp3')) break;
      const { y, m } = fromIdx(i);
      const end = fromIdx(begin + 8);
      await sql`insert into public.transfers (user_id, year, month, product_id, dev_status, transfer_status, planned_date, completed_date, content, plan, updated_by)
        values (${U[e]}, ${y}, ${m}, ${P[pi].id}, ${stages[s] === 'planned' ? 'in_progress' : 'done'}, ${stages[s]}, ${`${end.y}-${String(end.m).padStart(2, '0')}-20`},
          ${stages[s] === 'done' ? `${y}-${String(m).padStart(2, '0')}-18` : null},
          ${['이관 일정 협의', '작업표준서·검사기준서 전달', '초도품 생산 입회', '공정 불량 원인 분석 지원', '이관 완료 보고'][s]}, ${stages[s] === 'done' ? '' : '차월 생산기술팀 교육 및 치공구 이관'}, ${U[e]})`;
    }
  }

  // 7) 매출 (최근 5개년). 금월은 미등록, 4년 전 2월은 "0원 확정", 3년 전 8월은 미등록으로 둔다.
  console.log('매출 생성...');
  const customers = ['㈜한국통신기술', '대한전자', '글로벌RF', 'KT네트웍스', '세종시스템'];
  const [imp] = await sql`insert into public.sales_imports (file_name, months, imported_by) values ('가상데이터(seed)', '', ${U.admin}) returning id`;
  let rowNo = 0;
  for (let y = CUR_Y - 4; y <= CUR_Y; y++) {
    for (let m = 1; m <= 12; m++) {
      if (idx(y, m) >= CUR) break;
      if (y === CUR_Y - 4 && m === 2) { await sql`insert into public.sales_closings (year, month, note, confirmed_by) values (${y}, ${m}, '납품 없음', ${U.admin})`; continue; }
      if (y === CUR_Y - 3 && m === 8) continue;
      const cnt = ri(6, 12);
      const growth = 1 + (y - (CUR_Y - 4)) * 0.18;
      for (let k = 0; k < cnt; k++) {
        const p = pick(P);
        const kind = rnd() < 0.05 ? 'return' : rnd() < 0.08 ? 'freight' : 'sale';
        const unit = pick(['EA', 'EA', 'EA', 'SET']);
        const qty = kind === 'freight' ? null : ri(5, 120) * (kind === 'return' ? -1 : 1);
        const price = kind === 'freight' ? null : Math.round(ri(80, 900) * 1000 * growth * (unit === 'SET' ? 3 : 1));
        const supply = kind === 'freight' ? ri(3, 20) * 10000 : Math.round(qty * price * (kind === 'return' ? 0.1 : 1));
        const vat = Math.round(supply * 0.1);
        const date = `${y}-${String(m).padStart(2, '0')}-${String(ri(1, 27)).padStart(2, '0')}`;
        rowNo++;
        await sql`insert into public.sales (sale_date, kind, customer, product_name, model, manager, quantity, unit, unit_price, supply_amount, vat_amount, total_amount,
            import_key, import_id, source_file, source_sheet, source_row, orig_supply_amount, orig_vat_amount, orig_total_amount, created_by)
          values (${date}, ${kind}, ${pick(customers)}, ${kind === 'freight' ? '운임' : p.name}, ${kind === 'freight' ? '' : p.model}, ${pick(['이연구', '박개발', '최설계'])},
            ${qty}, ${kind === 'freight' ? '' : unit}, ${price}, ${supply}, ${vat}, ${supply + vat},
            ${`seed#${rowNo}`}, ${imp.id}, '가상데이터(seed)', ${`${y}년`}, ${rowNo}, ${supply}, ${vat}, ${supply + vat}, ${U.admin})`;
      }
    }
  }

  // 8) 알림 몇 건
  await sql`insert into public.notifications (user_id, type, title, body, link) values
    (${U.admin}, 'report_submitted', ${`박개발님이 ${CUR_Y}년 ${CUR_M}월 월차보고를 제출했습니다.`}, '', ${`/reports/${reportOf[`emp2:${CUR}`]}`}),
    (${U.emp3}, 'report_rejected', '전월 월차보고가 반려되었습니다.', '사유: 시험결과 수치와 차월계획이 누락되었습니다.', ${`/reports/${reportOf[`emp3:${CUR - 1}`]}`})`;

  // 9) 가져오기 검증용 판매 Excel (xlsx / xls). 금월·다음 달 거래, 소계·합계·빈 행·반품·운임·오류 행 포함
  const nx = fromIdx(CUR + 1);
  const d = (y, m, day) => `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const rows = [
    ['연구소 판매내역'], [`출력일: ${d(CUR_Y, CUR_M, 28)}`], [],
    ['납품일', '구분', '거래처', '품명', '모델', '담당자', '수량', '단위', '단가', '통화', '환율', '공급가액', '부가세', '합계금액', '비고'],
    [d(CUR_Y, CUR_M, 3), '판매', '㈜한국통신기술', '광대역 증폭기', 'WBA-2600', '이연구', 20, 'EA', 850000, 'KRW', 1, 17000000, 1700000, 18700000, ''],
    [d(CUR_Y, CUR_M, 3), '판매', '㈜한국통신기술', '광대역 증폭기', 'WBA-2600', '이연구', 20, 'EA', 850000, 'KRW', 1, 17000000, 1700000, 18700000, '동일 조건 2차 납품'],
    [d(CUR_Y, CUR_M, 7), '판매', '대한전자', '대역통과 필터', 'BPF-3500', '박개발', 5, 'SET', 1200000, 'KRW', 1, 6000000, 600000, 6600000, ''],
    [d(CUR_Y, CUR_M, 9), '운임', '대한전자', '운임', '', '박개발', '', '', '', 'KRW', 1, 55000, 5500, 60500, '퀵 배송'],
    [d(CUR_Y, CUR_M, 12), '판매', '글로벌RF', '저잡음 증폭기', 'LNA-1800', '최설계', 10, 'EA', 420, 'USD', 1380, 5796000, 0, 5796000, '수출(영세율)'],
    [d(CUR_Y, CUR_M, 15), '반품', '대한전자', '대역통과 필터', 'BPF-3500', '박개발', 1, 'SET', 1200000, 'KRW', 1, 1200000, 120000, 1320000, '외관 불량 반품'],
    [d(CUR_Y, CUR_M, 18), '기타자재', '세종시스템', '포장재', '', '이연구', '', '', '', 'KRW', 1, 88000, 8800, 96800, ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['소계', '', '', '', '', '', 54, '', '', '', '', 44739000, 3894300, 48633300, ''],
    [d(nx.y, nx.m, 2), '판매', 'KT네트웍스', '주파수 합성기', 'SYN-6000', '박개발', 8, 'EA', 2300000, 'KRW', 1, 18400000, 1840000, 20240000, ''],
    [d(nx.y, nx.m, 5), '판매', '세종시스템', '전력 분배기', 'PD-4W-2700', '최설계', 40, 'EA', 95000, 'KRW', 1, 3800000, 380000, 4180000, ''],
    ['날짜오류', '판매', '세종시스템', 'RF 스위치 모듈', 'SWM-8X8', '이연구', 2, 'EA', 3100000, 'KRW', 1, 6200000, 620000, 6820000, '날짜가 잘못된 행'],
    [d(nx.y, nx.m, 9), '판매', '글로벌RF', '안테나 모듈', 'ANT-28G', '최설계', '', 'EA', '', 'KRW', 1, 9000000, 900000, 9900000, '수량·단가 누락 행'],
    ['합계', '', '', '', '', '', 102, '', '', '', '', 66939000, 6114300, 73053300, ''],
  ];
  const sampleDir = path.join(ROOT, 'dev', 'sample');
  fs.mkdirSync(sampleDir, { recursive: true });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '판매내역');
  fs.writeFileSync(path.join(sampleDir, '판매내역_샘플.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  fs.writeFileSync(path.join(sampleDir, '판매내역_샘플.xls'), XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }));

  console.log(`완료: 계정 ${accounts.length}개, 제품 ${P.length}개. 계정 정보는 dev/demo-accounts.json 을 참고하세요.`);
  console.log('가져오기 검증용 파일: dev/sample/판매내역_샘플.xlsx, .xls');
} catch (e) {
  console.error('가상 데이터 생성 실패:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
