// 월차보고 첨부파일 (Excel, CSV, PowerPoint, PDF)
// - 다운로드: 작성자와 관리자만 (RLS: report_readable)
// - 추가·삭제: 작성자 + 작성중/반려 상태만 (RLS: report_editable)
// 원본은 서버 PC 의 ATTACHMENT_DIR/<보고서ID>/<무작위 이름> 에, 목록은 DB(report_attachments)에 저장한다.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { route } from '@/lib/auth';
import { HttpError } from '@/lib/db';
import { uuid } from '@/lib/validate';
import { ATTACH_EXT } from '@/lib/constants';
import { attachmentPath, sniffAttachment } from '@/lib/reports';

export const GET = route({}, async ({ params, req, db }) => {
  const rid = uuid(params.id);
  const id = uuid(req.nextUrl.searchParams.get('attachment'));
  const [a] = await db((tx) => tx`select file_name, stored_name, mime_type from report_attachments where id = ${id} and report_id = ${rid}`);
  if (!a) throw new HttpError(404, '첨부파일을 찾을 수 없습니다.');
  let buf: Buffer;
  try {
    buf = await fs.readFile(attachmentPath(rid, a.stored_name));
  } catch {
    throw new HttpError(404, '첨부파일 원본을 찾을 수 없습니다. 관리자에게 문의해 주세요.');
  }
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': a.mime_type,
      'content-length': String(buf.length),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.file_name)}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
});

export const POST = route({}, async ({ user, params, req, db }) => {
  const rid = uuid(params.id);
  let form: FormData;
  try { form = await req.formData(); } catch { throw new HttpError(400, '파일을 읽을 수 없습니다.'); }
  const file = form.get('file');
  if (!(file instanceof File) || !file.name) throw new HttpError(400, '첨부할 파일을 선택해 주세요.');
  const name = path.basename(file.name.replace(/\\/g, '/')).slice(0, 200);
  const ext = path.extname(name).toLowerCase();
  if (!ATTACH_EXT.includes(ext)) throw new HttpError(400, `첨부할 수 없는 형식입니다. (${ATTACH_EXT.join(', ')} 만 가능)`);

  return db(async (tx) => {
    const [s] = await tx`select coalesce((select value from app_settings where key = 'attachment_max_mb'), '30') as mb,
                                report_editable(${rid}) as ok`;
    if (!s.ok) throw new HttpError(403, '작성중 또는 반려 상태의 본인 보고서에만 첨부할 수 있습니다.');
    const maxMb = Math.min(200, Math.max(1, Number(s.mb) || 30));
    if (file.size <= 0) throw new HttpError(400, '빈 파일은 첨부할 수 없습니다.');
    if (file.size > maxMb * 1024 * 1024) throw new HttpError(400, `파일이 너무 큽니다. (최대 ${maxMb}MB)`);
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = sniffAttachment(ext, buf.subarray(0, 512));
    if (!mime) throw new HttpError(400, '파일 내용이 확장자와 맞지 않습니다.');

    const stored = `${crypto.randomUUID()}${ext}`;
    const [row] = await tx`
      insert into report_attachments (report_id, file_name, stored_name, mime_type, size_bytes, uploaded_by)
      values (${rid}, ${name}, ${stored}, ${mime}, ${buf.length}, ${user.id}) returning id, file_name, mime_type, size_bytes, created_at`;
    // 목록 저장이 성공한 뒤 원본을 쓴다. 쓰기에 실패하면 예외로 트랜잭션이 취소된다.
    const dest = attachmentPath(rid, stored);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buf, { flag: 'wx' });
    return row;
  });
});

export const DELETE = route({}, async ({ params, req, db }) => {
  const rid = uuid(params.id);
  const id = uuid(req.nextUrl.searchParams.get('attachment'));
  const [a] = await db(async (tx) => {
    const [ok] = await tx`select report_editable(${rid}) as ok`;
    if (!ok.ok) throw new HttpError(403, '작성중 또는 반려 상태의 본인 보고서에서만 첨부를 삭제할 수 있습니다.');
    return tx`delete from report_attachments where id = ${id} and report_id = ${rid} returning stored_name`;
  });
  if (!a) throw new HttpError(404, '첨부파일을 찾을 수 없습니다.');
  await fs.rm(attachmentPath(rid, a.stored_name), { force: true }).catch(() => {});
  return { ok: true };
});
