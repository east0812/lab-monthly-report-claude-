'use client';
// 월차보고 내역 표 + 작성 시작 화면
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api, Button, Card, PageHeader, ReportBadge, Select, useToast } from '../ui';
import { DataTable, type Column } from '../DataTable';
import { fmtDateTime, REPORT_STATUS, type ReportStatus } from '@/lib/constants';

type Row = {
  id: string; year: number; month: number; status: ReportStatus; summary: string; submitted_at: string | null; updated_at: string;
  work_count: number; attach_count: number; products: string[]; categories: string[];
};

export function ReportList({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [year, setYear] = useState('');
  const [status, setStatus] = useState('');
  const [product, setProduct] = useState('');
  const [category, setCategory] = useState('');
  const years = useMemo(() => [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a), [rows]);
  const products = useMemo(() => [...new Set(rows.flatMap((r) => r.products))].sort((a, b) => a.localeCompare(b, 'ko')), [rows]);
  const categories = useMemo(() => [...new Set(rows.flatMap((r) => r.categories))].sort((a, b) => a.localeCompare(b, 'ko')), [rows]);
  const view = rows.filter((r) => (!year || r.year === Number(year)) && (!status || r.status === status) && (!product || r.products.includes(product)) && (!category || r.categories.includes(category)));

  const columns: Column<Row>[] = [
    { key: 'ym', label: '보고 연월', width: 110, value: (r) => `${r.year}-${String(r.month).padStart(2, '0')}`, render: (r) => <span className="font-medium">{r.year}년 {r.month}월</span> },
    { key: 'status', label: '상태', width: 110, value: (r) => REPORT_STATUS[r.status].label, render: (r) => <ReportBadge status={r.status} /> },
    { key: 'summary', label: '요약', width: 360, value: (r) => r.summary.replace(/\s+/g, ' ') },
    { key: 'work_count', label: '업무 건수', width: 90, align: 'right' },
    { key: 'products', label: '제품', width: 220, value: (r) => r.products.join(', '), sortable: false },
    { key: 'categories', label: '업무 분류', width: 150, value: (r) => r.categories.join(', '), sortable: false },
    { key: 'attach_count', label: '첨부', width: 64, align: 'right' },
    { key: 'submitted_at', label: '제출일시', width: 140, value: (r) => fmtDateTime(r.submitted_at) },
    { key: 'updated_at', label: '최근 수정', width: 140, value: (r) => fmtDateTime(r.updated_at) },
  ];
  return (
    <div>
      <PageHeader title="월차보고 내역" desc="지난 보고서를 연도·상태·제품·업무 분류로 찾아 열 수 있습니다." actions={<Link href="/reports/write"><Button variant="primary">월차보고 작성</Button></Link>} />
      <Card>
        <DataTable id="my-reports" rows={view} columns={columns} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/reports/${r.id}`)} empty="조건에 맞는 보고서가 없습니다."
          searchPlaceholder="요약·제품 검색"
          toolbar={<>
            <Select aria-label="연도" value={year} onChange={(e) => setYear(e.target.value)} className="!h-8 !w-auto text-xs"><option value="">연도: 전체</option>{years.map((y) => <option key={y} value={y}>{y}년</option>)}</Select>
            <Select aria-label="상태" value={status} onChange={(e) => setStatus(e.target.value)} className="!h-8 !w-auto text-xs"><option value="">상태: 전체</option>{(Object.keys(REPORT_STATUS) as ReportStatus[]).map((s) => <option key={s} value={s}>{REPORT_STATUS[s].label}</option>)}</Select>
            <Select aria-label="제품" value={product} onChange={(e) => setProduct(e.target.value)} className="!h-8 !w-auto max-w-48 text-xs"><option value="">제품: 전체</option>{products.map((p) => <option key={p} value={p}>{p}</option>)}</Select>
            <Select aria-label="업무 분류" value={category} onChange={(e) => setCategory(e.target.value)} className="!h-8 !w-auto text-xs"><option value="">업무 분류: 전체</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
          </>} />
      </Card>
    </div>
  );
}

export function ReportStart({ year, month, existingId, recent }: { year: number; month: number; existingId: string | null; recent: { id: string; year: number; month: number; status: ReportStatus }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [y, setY] = useState(year);
  const [m, setM] = useState(month);
  const [busy, setBusy] = useState(false);
  const found = recent.find((r) => r.year === y && r.month === m) ?? (y === year && m === month && existingId ? { id: existingId } : null);
  const years = [year + 1, year, year - 1, year - 2].filter((v, i, a) => a.indexOf(v) === i);
  const start = async () => {
    setBusy(true);
    try {
      const r = await api<{ id: string }>('POST', '/api/reports', { year: y, month: m });
      router.push(`/reports/${r.id}`);
    } catch (e) { toast((e as Error).message, 'err'); setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="월차보고 작성" desc="보고 연월을 선택해 작성을 시작합니다. 직원별·월별로 보고서는 한 건입니다." />
      <Card title="보고 연월 선택">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-600">연도
            <Select value={y} onChange={(e) => setY(Number(e.target.value))} className="mt-1 !w-28">{years.map((v) => <option key={v} value={v}>{v}년</option>)}</Select>
          </label>
          <label className="text-xs font-medium text-slate-600">월
            <Select value={m} onChange={(e) => setM(Number(e.target.value))} className="mt-1 !w-24">{Array.from({ length: 12 }, (_, i) => i + 1).map((v) => <option key={v} value={v}>{v}월</option>)}</Select>
          </label>
          {found ? <Link href={`/reports/${found.id}`}><Button variant="primary">작성된 보고서 열기</Button></Link> : <Button variant="primary" disabled={busy} onClick={start}>{busy ? '만드는 중…' : '작성 시작'}</Button>}
        </div>
        <p className="mt-3 text-xs text-slate-500">개발현황과 생산이관은 각 전용 메뉴에서 기록하면 같은 달 보고서에 함께 표시됩니다.</p>
      </Card>
      {recent.length > 0 && (
        <Card title="최근 보고서" className="mt-4" pad={false}>
          <ul className="divide-y divide-slate-100">
            {recent.slice(0, 6).map((r) => (
              <li key={r.id}><Link href={`/reports/${r.id}`} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-50"><span>{r.year}년 {r.month}월</span><ReportBadge status={r.status} /></Link></li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
