// 개발현황(/api/dev-works)·생산이관(/api/transfers) 회귀 검증.
//   node dev/verify/dev-transfers.mjs
// 가상 계정(admin, emp1, emp2)으로 실제 서버에 요청한다. 만든 기록은 끝에서 모두 지우고, 시드 자료는 건드리지 않는다.
// 전제(시드): 이번 달(한국시간) emp1 월차보고는 작성중, emp2 는 제출완료.
import { session, Session, BASE } from './client.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  → ${detail}`}`);
}
const brief = (r) => `${r.status} ${JSON.stringify(r.json)?.slice(0, 160) ?? r.text.slice(0, 160)}`;

function kstNow() {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  return { year: y, month: m };
}
const prevYm = (y, m) => (m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 });

/** 최근 36개월 안에서 본인 기록 하나를 찾아 user_id·product_id 를 얻는다. */
async function findOwn(sess, cur) {
  let { year, month } = cur;
  for (let i = 0; i < 36; i++) {
    for (const [url, key] of [['/api/dev-works', 'works'], ['/api/transfers', 'transfers']]) {
      const r = await sess.get(`${url}?year=${year}&month=${month}`);
      const row = r.json?.[key]?.[0];
      if (row) return { user_id: row.user_id, product_id: row.product_id };
    }
    ({ year, month } = prevYm(year, month));
  }
  throw new Error('시드 자료에서 기록을 찾지 못했습니다. (npm run local:seed 확인)');
}

console.log('BASE', BASE);
const cur = kstNow();
const prev = prevYm(cur.year, cur.month);
const q = `year=${cur.year}&month=${cur.month}`;
const TAG = `[검증 ${Date.now()}]`;

const admin = await session('admin');
const emp1 = await session('emp1');
const emp2 = await session('emp2');
const me1 = await findOwn(emp1, cur);
const me2 = await findOwn(emp2, cur);
const productId = me1.product_id;

// 정리 대상: [url] (관리자 권한, 버전 무시로 삭제)
const cleanup = new Set();
const track = (url) => { cleanup.add(url); return url; };

try {
  // ── 인증 ──
  check('비로그인 조회 → 401', (await new Session().get(`/api/dev-works?${q}`)).status === 401);

  // ── 개발현황: emp1 생성·수정·삭제 ──
  let r = await emp1.post('/api/dev-works', { year: cur.year, month: cur.month, product_id: productId, title: `${TAG} 업무`, status: 'in_progress', progress: 10, user_id: me2.user_id });
  check('emp1 개발업무 생성 (이번 달)', r.status === 200 && r.json?.work?.id, brief(r));
  const w = r.json.work;
  const wUrl = track(`/api/dev-works/${w.id}`);
  check('직원이 보낸 user_id 는 무시되고 본인으로 저장', w.user_id === me1.user_id && w.version === 1, `user_id=${w.user_id}`);

  r = await emp1.get(`/api/dev-works?${q}`);
  const listed = r.json?.works?.find((x) => x.id === w.id);
  check('목록에 제품·담당자 이름 포함, 본인 기록만', r.status === 200 && listed && !!listed.product_name && !!listed.user_name && r.json.works.every((x) => x.user_id === me1.user_id) && r.json.locked === false, brief(r));

  r = await emp1.patch(wUrl, { version: 1, work_done: '회로 수정\n측정 완료', progress: 35 });
  check('emp1 수정 → 버전 2', r.status === 200 && r.json?.work?.version === 2 && r.json.work.progress === 35 && r.json.work.work_done === '회로 수정\n측정 완료', brief(r));

  r = await emp1.patch(wUrl, { version: 1, work_done: '오래된 화면의 내용' });
  check('오래된 버전으로 수정 → 409', r.status === 409, brief(r));
  r = await emp1.get(`/api/dev-works?${q}`);
  check('409 뒤에도 내용이 덮어써지지 않음', r.json?.works?.find((x) => x.id === w.id)?.work_done === '회로 수정\n측정 완료');

  r = await emp1.patch(wUrl, { version: 2, status: 'done', progress: 40 });
  check('상태 완료 → 진행률 100', r.status === 200 && r.json?.work?.status === 'done' && r.json.work.progress === 100 && r.json.work.version === 3, brief(r));

  check('진행률 101 → 400', (await emp1.patch(wUrl, { version: 3, progress: 101 })).status === 400);
  check('업무명 201자 → 400', (await emp1.patch(wUrl, { version: 3, title: 'x'.repeat(201) })).status === 400);
  check('수행내용 5001자 → 400', (await emp1.patch(wUrl, { version: 3, work_done: 'x'.repeat(5001) })).status === 400);
  check('알 수 없는 상태 → 400', (await emp1.patch(wUrl, { version: 3, status: 'nope' })).status === 400);
  check('버전 누락 → 400', (await emp1.patch(wUrl, { title: 'x' })).status === 400);
  check('월 13 생성 → 400', (await emp1.post('/api/dev-works', { year: cur.year, month: 13, product_id: productId })).status === 400);
  check('제품 누락 생성 → 400', (await emp1.post('/api/dev-works', { year: cur.year, month: cur.month })).status === 400);

  // ── 잠금: emp2 는 이번 달 제출완료 ──
  r = await emp2.post('/api/dev-works', { year: cur.year, month: cur.month, product_id: productId, title: `${TAG} 잠금` });
  if (r.json?.work?.id) track(`/api/dev-works/${r.json.work.id}`);
  check('emp2(제출된 월) 생성 → 403', r.status === 403, brief(r));
  r = await emp2.get(`/api/dev-works?${q}`);
  check('emp2 목록 locked=true', r.status === 200 && r.json?.locked === true, brief(r));

  r = await admin.post('/api/dev-works', { year: cur.year, month: cur.month, product_id: productId, title: `${TAG} emp2 기록`, user_id: me2.user_id, progress: 20 });
  check('관리자가 emp2 담당 기록 생성 (제출된 월)', r.status === 200 && r.json?.work?.user_id === me2.user_id, brief(r));
  const w2 = r.json.work;
  const w2Url = track(`/api/dev-works/${w2.id}`);

  r = await emp2.patch(w2Url, { version: w2.version, title: `${TAG} 직원 수정` });
  check('emp2(제출된 월) 본인 기록 수정 → 403', r.status === 403, brief(r));
  check('emp2(제출된 월) 본인 기록 삭제 → 403', (await emp2.del(`${w2Url}?version=${w2.version}`)).status === 403);
  r = await emp1.patch(w2Url, { version: w2.version, title: `${TAG} 남의 기록` });
  check('emp1 이 emp2 기록 수정 → 403/404', r.status === 403 || r.status === 404, brief(r));
  r = await emp1.del(w2Url);
  check('emp1 이 emp2 기록 삭제 → 403/404', r.status === 403 || r.status === 404, brief(r));
  r = await admin.patch(w2Url, { version: w2.version, title: `${TAG} 관리자 수정`, progress: 55 });
  check('관리자가 emp2 기록 수정', r.status === 200 && r.json?.work?.title === `${TAG} 관리자 수정` && r.json.work.progress === 55 && r.json.work.user_id === me2.user_id && r.json.work.version === w2.version + 1, brief(r));
  r = await admin.get(`/api/dev-works?${q}&user=${me2.user_id}`);
  check('관리자 담당자 필터 조회', r.status === 200 && r.json.works.length > 0 && r.json.works.every((x) => x.user_id === me2.user_id) && r.json.works.some((x) => x.id === w2.id), brief(r));

  // ── 전월 업무 이월 ──
  r = await admin.post('/api/dev-works', { year: prev.year, month: prev.month, product_id: productId, title: `${TAG} 이월 원본`, status: 'in_progress', progress: 40, revision: 'Rev.T', work_done: '전월 수행내용', test_result: '전월 시험결과', user_id: me1.user_id });
  check('관리자가 emp1 전월 업무 준비', r.status === 200 && r.json?.work?.user_id === me1.user_id, brief(r));
  const src = r.json.work;
  const srcUrl = track(`/api/dev-works/${src.id}`);
  r = await admin.post('/api/dev-works', { year: prev.year, month: prev.month, product_id: productId, title: `${TAG} 완료 업무`, status: 'done', user_id: me1.user_id });
  const doneSrc = r.json.work;
  track(`/api/dev-works/${doneSrc.id}`);

  r = await emp1.get(`/api/dev-works/carry-candidates?${q}`);
  const cand = r.json?.candidates?.find((x) => x.id === src.id);
  check('이월 후보에 전월 진행중 업무 포함(미이월), 완료 업무 제외', r.status === 200 && cand && cand.carried === false && !r.json.candidates.some((x) => x.id === doneSrc.id) && r.json.prev.month === prev.month, brief(r));

  r = await emp1.post('/api/dev-works/carry-over', { year: cur.year, month: cur.month, ids: [src.id, doneSrc.id] });
  check('이월 실행 → 1건 이월, 1건(완료 업무) 건너뜀', r.status === 200 && r.json?.created === 1 && r.json?.skipped === 1, brief(r));
  r = await emp1.post('/api/dev-works/carry-over', { year: cur.year, month: cur.month, ids: [src.id] });
  check('다시 이월 → 0건 이월, 1건 건너뜀', r.status === 200 && r.json?.created === 0 && r.json?.skipped === 1, brief(r));

  r = await emp1.get(`/api/dev-works?${q}`);
  const carried = (r.json?.works ?? []).filter((x) => x.carried_from_id === src.id);
  carried.forEach((x) => track(`/api/dev-works/${x.id}`));
  const c0 = carried[0];
  check('이월된 기록은 1건뿐 (중복 없음)', carried.length === 1, `count=${carried.length}`);
  check('이월 기록: 제품·Revision·업무명·상태·진행률 유지, 수행내용/시험결과 비움, 전월 진행률 연결',
    c0 && c0.product_id === src.product_id && c0.revision === 'Rev.T' && c0.title === src.title && c0.status === 'in_progress' && c0.progress === 40
      && c0.work_done === '' && c0.test_result === '' && c0.carried_progress === 40 && c0.carried_month === prev.month && c0.carried_year === prev.year, JSON.stringify(c0)?.slice(0, 300));
  r = await emp1.get(`/api/dev-works/carry-candidates?${q}`);
  check('이월 후 후보에 "이월됨" 표시', r.json?.candidates?.find((x) => x.id === src.id)?.carried === true, brief(r));
  check('emp2(제출된 월) 이월 → 403', (await emp2.post('/api/dev-works/carry-over', { year: cur.year, month: cur.month, ids: [src.id] })).status === 403);
  check('이월 대상 없음 → 400', (await emp1.post('/api/dev-works/carry-over', { year: cur.year, month: cur.month, ids: [] })).status === 400);

  // 원본을 지워도 이월된 기록은 남는다 (연결만 해제)
  r = await admin.del(srcUrl);
  check('이월 원본 삭제(관리자)', r.status === 200, brief(r));
  if (r.status === 200) cleanup.delete(srcUrl);
  r = await emp1.get(`/api/dev-works?${q}`);
  const orphan = r.json?.works?.find((x) => x.id === c0?.id);
  check('원본 삭제 뒤 이월 기록 유지 (연결 해제)', orphan && orphan.carried_from_id === null, JSON.stringify(orphan)?.slice(0, 200));

  // ── 삭제 ──
  r = await emp1.del(`${wUrl}?version=1`);
  check('오래된 버전으로 삭제 → 409', r.status === 409, brief(r));
  r = await emp1.del(`${wUrl}?version=3`);
  check('emp1 개발업무 삭제', r.status === 200, brief(r));
  if (r.status === 200) cleanup.delete(wUrl);
  r = await emp1.get(`/api/dev-works?${q}`);
  check('삭제한 업무는 목록에 없음', r.status === 200 && !r.json.works.some((x) => x.id === w.id));
  check('없는 기록 수정 → 404', (await emp1.patch(wUrl, { version: 3, title: 'x' })).status === 404);

  // ── 생산이관 ──
  r = await emp1.post('/api/transfers', { year: cur.year, month: cur.month, product_id: productId, dev_status: 'done', transfer_status: 'planned', planned_date: `${cur.year}-12-20`, content: `${TAG} 이관 일정 협의`, plan: '차월 교육', user_id: me2.user_id });
  check('emp1 이관 기록 생성', r.status === 200 && r.json?.transfer?.user_id === me1.user_id && r.json.transfer.planned_date === `${cur.year}-12-20` && r.json.transfer.completed_date === null, brief(r));
  const t = r.json.transfer;
  const tUrl = track(`/api/transfers/${t.id}`);
  r = await emp1.patch(tUrl, { version: t.version, transfer_status: 'done', completed_date: `${cur.year}-12-18` });
  check('emp1 이관 기록 수정 → 버전 증가', r.status === 200 && r.json?.transfer?.transfer_status === 'done' && r.json.transfer.completed_date === `${cur.year}-12-18` && r.json.transfer.version === t.version + 1, brief(r));
  check('이관: 오래된 버전으로 수정 → 409', (await emp1.patch(tUrl, { version: t.version, plan: '오래된 화면' })).status === 409);
  check('이관: 잘못된 날짜 → 400', (await emp1.patch(tUrl, { version: t.version + 1, planned_date: '2026-13-40' })).status === 400);
  check('이관: 날짜 형식 오류 → 400', (await emp1.patch(tUrl, { version: t.version + 1, planned_date: '20261220' })).status === 400);
  r = await emp1.get(`/api/transfers?${q}`);
  check('이관 목록: 본인 기록만, 제품·모델 포함', r.status === 200 && r.json.transfers.some((x) => x.id === t.id && x.product_name) && r.json.transfers.every((x) => x.user_id === me1.user_id), brief(r));

  r = await emp2.post('/api/transfers', { year: cur.year, month: cur.month, product_id: productId, content: `${TAG} 잠금` });
  if (r.json?.transfer?.id) track(`/api/transfers/${r.json.transfer.id}`);
  check('emp2(제출된 월) 이관 생성 → 403', r.status === 403, brief(r));
  r = await admin.post('/api/transfers', { year: cur.year, month: cur.month, product_id: productId, content: `${TAG} emp2 이관`, user_id: me2.user_id });
  check('관리자가 emp2 담당 이관 기록 생성', r.status === 200 && r.json?.transfer?.user_id === me2.user_id, brief(r));
  const t2 = r.json.transfer;
  const t2Url = track(`/api/transfers/${t2.id}`);
  check('emp2(제출된 월) 본인 이관 수정 → 403', (await emp2.patch(t2Url, { version: t2.version, plan: 'x' })).status === 403);
  r = await emp1.patch(t2Url, { version: t2.version, plan: 'x' });
  check('emp1 이 emp2 이관 수정 → 403/404', r.status === 403 || r.status === 404, brief(r));
  r = await admin.patch(t2Url, { version: t2.version, transfer_status: 'in_progress', plan: '관리자 수정' });
  check('관리자가 emp2 이관 수정', r.status === 200 && r.json?.transfer?.plan === '관리자 수정' && r.json.transfer.user_id === me2.user_id, brief(r));

  r = await emp1.del(`${tUrl}?version=${t.version + 1}`);
  check('emp1 이관 기록 삭제', r.status === 200, brief(r));
  if (r.status === 200) cleanup.delete(tUrl);
  r = await emp1.get(`/api/transfers?${q}`);
  check('삭제한 이관 기록은 목록에 없음', r.status === 200 && !r.json.transfers.some((x) => x.id === t.id));

  // ── 화면 ──
  for (const [name, s] of [['emp1', emp1], ['admin', admin]]) {
    for (const url of ['/dev-status', `/dev-status?${q}&tab=detail`, '/transfers', `/transfers?${q}&tab=detail`]) {
      const p = await s.get(url);
      check(`${name} GET ${url} → 200`, p.status === 200 && p.text.includes(url.startsWith('/dev') ? '개발현황' : '생산이관'), String(p.status));
    }
  }
  r = await admin.get(`/dev-status?${q}&tab=detail&user=${me2.user_id}`);
  check('admin GET /dev-status (담당자 지정) → 200, 제출 상태 안내', r.status === 200 && r.text.includes('관리자 권한으로는 수정할 수 있습니다') && r.text.includes('업무 추가'), String(r.status));
  r = await emp1.get(`/dev-status?${q}&tab=detail`);
  check('emp1 상세 화면: 업무 추가·전월 업무 이월 버튼, 잠금 안내 없음', r.text.includes('업무 추가') && r.text.includes('전월 업무 이월') && !r.text.includes('제출된 월은 수정할 수 없습니다'));
  r = await emp2.get(`/dev-status?${q}&tab=detail`);
  check('emp2(제출된 월) 상세 화면: 잠금 안내, 추가·이월 버튼 없음', r.status === 200 && r.text.includes('제출된 월은 수정할 수 없습니다') && !r.text.includes('전월 업무 이월'), String(r.status));
  r = await emp2.get(`/transfers?${q}&tab=detail`);
  check('emp2(제출된 월) 이관내역: 잠금 안내, 추가 버튼 없음', r.status === 200 && r.text.includes('제출된 월은 수정할 수 없습니다') && !r.text.includes('이관 기록 추가'), String(r.status));
  r = await emp1.get(`/transfers?${q}&tab=detail`);
  check('emp1 이관내역: 추가 버튼, 표 머리글', r.text.includes('이관 기록 추가') && r.text.includes('예정일') && r.text.includes('완료일') && r.text.includes('이관상태'));
  r = await emp1.get(`/dev-status?${q}&user=${me2.user_id}`);
  check('emp1 타임라인: user 쿼리를 줘도 본인 기록만', r.status === 200 && !r.text.includes('>박개발<'), String(r.status));
} catch (e) {
  check('검증 스크립트 실행', false, e?.stack ?? String(e));
} finally {
  // 만든 기록 정리 (관리자 권한). 이미 지운 것은 404 가 정상.
  let left = 0;
  for (const url of cleanup) {
    const d = await admin.del(url);
    if (d.status !== 200 && d.status !== 404) { left++; console.log('정리 실패', url, d.status); }
  }
  check('만든 기록 정리', left === 0, `${left}건 남음`);
}

const failed = results.filter((x) => !x.ok);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과${failed.length ? ` · 실패: ${failed.map((f) => f.name).join(' | ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
