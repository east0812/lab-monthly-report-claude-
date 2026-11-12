// 시스템 설정 조회·저장 (관리자 전용). 키·접속 주소 같은 비밀 값은 다루지 않는다.
import { route, readJson } from '@/lib/auth';
import { HttpError, type Tx } from '@/lib/db';
import { emailResetEnabled } from '@/lib/ratelimit';
import { int, reqStr, text } from '@/lib/validate';

const KEYS = ['lab_name', 'admin_contact', 'attachment_max_mb'] as const;

async function load(tx: Tx) {
  const rows = await tx`select key, value from app_settings where key in ${tx([...KEYS])}`;
  const m = Object.fromEntries(rows.map((r) => [r.key as string, r.value as string]));
  const mb = Number(m.attachment_max_mb);
  return {
    lab_name: m.lab_name ?? '',
    admin_contact: m.admin_contact ?? '',
    attachment_max_mb: Number.isInteger(mb) && mb >= 1 && mb <= 200 ? mb : 30,
  };
}

/** 환경 설정 상태. 값 자체는 내보내지 않고 설정 여부만 알려 준다. */
function envStatus() {
  return {
    email_reset_enabled: emailResetEnabled(),
    app_base_url_set: !!process.env.APP_BASE_URL,
    attachment_dir_set: !!process.env.ATTACHMENT_DIR,
  };
}

export const GET = route({ admin: true }, async ({ db }) => {
  return { settings: await db(load), status: envStatus() };
});

export const PUT = route({ admin: true }, async ({ db, req, user }) => {
  const body = await readJson(req);
  const next: Record<string, string> = {};
  if (body.lab_name !== undefined) next.lab_name = reqStr(body.lab_name, 50, '연구소 이름');
  if (body.admin_contact !== undefined) next.admin_contact = text(body.admin_contact, 1000, '관리자 문의 방법').trim();
  if (body.attachment_max_mb !== undefined) next.attachment_max_mb = String(int(body.attachment_max_mb, 1, 200, '첨부 최대 크기(MB)'));
  const entries = Object.entries(next);
  if (!entries.length) throw new HttpError(400, '변경할 내용이 없습니다.');

  const settings = await db(async (tx) => {
    for (const [key, value] of entries) {
      await tx`
        insert into app_settings (key, value, updated_by) values (${key}, ${value}, ${user.id})
        on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by`;
    }
    return load(tx);
  });
  return { settings, status: envStatus() };
});
