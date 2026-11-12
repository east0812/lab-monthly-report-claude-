// Excel(.xlsx) 출력. 사용자 입력은 모두 문자열 셀로 기록되어 수식으로 실행되지 않는다.
import * as XLSX from 'xlsx';
import { ITEM_STATUS, SECTIONS, WORK_STATUS, type ItemField } from '../constants';
import type { TimelineRow } from '../data';
import { statusCounts, type ExportData } from './data';

type Cell = string | number | null;
const pl = (name: string | null, model: string | null) => (name ? `${name}${model ? ` (${model})` : ''}` : '');

function sheet(wb: XLSX.WorkBook, name: string, header: string[], rows: Cell[][], widths?: number[]) {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = header.map((h, i) => ({ wch: widths?.[i] ?? Math.max(10, h.length * 2 + 2) }));
  if (rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

function timelineSheet(wb: XLSX.WorkBook, name: string, year: number, rows: TimelineRow[]) {
  const months: string[] = [];
  for (const y of [year - 1, year]) for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, '0')}`);
  sheet(wb, name, ['제품', '모델', '담당자', ...months],
    rows.map((r) => [r.product_name, r.model, r.user_name, ...months.map((k) => (r.cells[k] ? r.cells[k].map((x) => WORK_STATUS[x.status].label).join(', ') : ''))]),
    [20, 14, 10, ...months.map(() => 9)]);
}

export function buildWorkbook(d: ExportData): Buffer {
  const wb = XLSX.utils.book_new();
  const c = statusCounts(d);
  const info: Cell[][] = [
    ['문서', `${d.labName} ${d.title}`], ['구분', d.subtitle], ['출력 일시', d.generatedAt], [],
    ['업무 상태별 건수'], ['전체', c.total], ['완료', c.done], ['진행중', c.in_progress], ['보류', c.on_hold], ['예정', c.planned], ['중단', c.stopped], [],
    ['작성자', '상태', '제출일시', '요약'], ...d.summaries.map((s) => [s.name, s.status, s.submittedAt, s.summary] as Cell[]),
  ];
  const ws0 = XLSX.utils.aoa_to_sheet(info);
  ws0['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, ws0, '요약');

  if (d.submission) sheet(wb, '제출현황', ['직원', '상태', '제출일시'], d.submission.map((s) => [s.name, s.status, s.submittedAt]), [14, 14, 18]);

  for (const sec of SECTIONS) {
    const list = d.items.filter((i) => i.section === sec.key);
    const val = (i: (typeof list)[number], k: ItemField): Cell => {
      if (k === 'product_id') return pl(i.product_name, i.product_model);
      if (k === 'category_id') return i.category_name ?? '';
      if (k === 'status') return ITEM_STATUS[i.status].label;
      if (k === 'quantity') return i.quantity;
      return String(i[k] ?? '');
    };
    sheet(wb, sec.label.replace('/', '·'), ['작성자', ...sec.fields.map((f) => f.label)], list.map((i) => [i.user_name, ...sec.fields.map((f) => val(i, f.key))]),
      [10, ...sec.fields.map((f) => (f.long ? 50 : f.key === 'title' || f.key === 'item_name' || f.key === 'product_id' ? 28 : 14))]);
    if (sec.key === 'spec') {
      sheet(wb, '개발과제', ['작성자', '과제명', '제품', '업무 분류', '시작일', '종료일', '과제 목표', '진행률(%)', '상태', '금월 결과', '이슈', '차월 계획'],
        d.projects.map((p) => [p.user_name, p.name, pl(p.product_name, p.product_model), p.category_name ?? '', p.start_date ?? '', p.end_date ?? '', p.goal, p.progress, ITEM_STATUS[p.status].label, p.result, p.issue, p.next_plan]),
        [10, 30, 24, 12, 12, 12, 40, 10, 10, 50, 40, 40]);
    }
  }

  sheet(wb, '개발현황(월)', ['담당자', '제품', '모델', 'Revision', '분류', '업무명', '상태', '진행률(%)', '수행내용', '시험결과', '문제점', '조치', '차월계획', '보고서'],
    d.devWorks.map((w) => [w.user_name, w.product_name, w.product_model, w.revision, w.category_name ?? '', w.title, WORK_STATUS[w.status].label, w.progress, w.work_done, w.test_result, w.issues, w.actions, w.next_plan, w.submitted ? '제출' : '미제출']),
    [10, 20, 14, 10, 12, 28, 10, 10, 50, 40, 36, 36, 36, 8]);
  sheet(wb, '생산이관(월)', ['담당자', '제품', '모델', '개발상태', '이관상태', '예정일', '완료일', '내용', '계획', '보고서'],
    d.transfers.map((t) => [t.user_name, t.product_name, t.product_model, WORK_STATUS[t.dev_status].label, WORK_STATUS[t.transfer_status].label, t.planned_date ?? '', t.completed_date ?? '', t.content, t.plan, t.submitted ? '제출' : '미제출']),
    [10, 20, 14, 10, 10, 12, 12, 50, 40, 8]);
  timelineSheet(wb, '개발현황 24개월', d.year, d.devTimeline);
  timelineSheet(wb, '생산이관 24개월', d.year, d.transferTimeline);

  if (d.sales) {
    const prev = d.sales.prevMonths;
    const qty = (m: { qty: { unit: string; qty: number }[] }) => m.qty.map((q) => `${q.qty.toLocaleString('ko-KR')} ${q.unit}`).join(', ');
    sheet(wb, '월별 매출', ['월', '상태', '건수', '수량(단위별)', '공급가액', '부가세액', '총금액(부가세 포함)', `${d.year - 1}년 동월 총금액`],
      d.sales.months.map((m, i) => [`${m.month}월`, !m.registered ? '미등록' : m.zeroConfirmed ? '0원 확정' : '등록', m.registered ? m.count : null, qty(m), m.supply, m.vat, m.total, prev[i]?.total ?? null]),
      [8, 10, 8, 24, 18, 16, 22, 22]);
    sheet(wb, '최근 5개년 매출', ['연도', '총금액(부가세 포함)', '등록 월수', '직전년도 대비 증감률(%)', '수량(단위별)'],
      d.sales.years.map((y) => [y.year, y.total, y.registeredMonths, y.growth === null ? '-' : Math.round(y.growth * 10) / 10, qty(y)]),
      [8, 22, 10, 22, 30]);
  }
  if (d.attachments.length) sheet(wb, '첨부목록', ['파일명'], d.attachments.map((a) => [a]), [60]);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
