// 출력 응답 공통 처리: format=xlsx | html(mode=slides|doc) | print
import { HttpError } from '../db';
import { buildWorkbook } from './excel';
import { renderHtml } from './html';
import type { ExportData } from './data';

const disposition = (kind: 'attachment' | 'inline', name: string) => `${kind}; filename*=UTF-8''${encodeURIComponent(name)}`;

export function exportResponse(d: ExportData, sp: URLSearchParams): Response {
  const format = sp.get('format') ?? 'html';
  const base = `${d.labName}_${d.year}-${String(d.month).padStart(2, '0')}_${d.kind === 'compile' ? '전체취합' : d.summaries[0]?.name ?? '월차보고'}`.replace(/[\\/:*?"<>|\s]+/g, '_');
  const common = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
  if (format === 'xlsx') {
    const buf = buildWorkbook(d);
    return new Response(new Uint8Array(buf), { headers: { ...common, 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': disposition('attachment', `${base}.xlsx`) } });
  }
  if (format === 'print') {
    // A4 인쇄/PDF: 문서형 HTML 을 새 탭에 열고 인쇄 대화상자를 띄운다.
    return new Response(renderHtml(d, 'doc', { autoPrint: true }), { headers: { ...common, 'content-type': 'text/html; charset=utf-8', 'content-disposition': disposition('inline', `${base}.html`) } });
  }
  if (format === 'html') {
    const mode = sp.get('mode') === 'doc' ? 'doc' : 'slides';
    const name = `${base}_${mode === 'doc' ? '자료열람용' : '회의발표용'}.html`;
    return new Response(renderHtml(d, mode), { headers: { ...common, 'content-type': 'text/html; charset=utf-8', 'content-disposition': disposition(sp.get('inline') === '1' ? 'inline' : 'attachment', name) } });
  }
  throw new HttpError(400, '출력 형식이 올바르지 않습니다.');
}
