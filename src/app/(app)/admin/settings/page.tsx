// 시스템 설정 (관리자 전용)
import { requireAdmin } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { emailResetEnabled } from '@/lib/ratelimit';
import { SettingsForm } from '@/components/admin/SettingsForm';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  const me = await requireAdmin();
  const rows = await withUser(me.id, (tx) => tx`
    select key, value from app_settings where key in ('lab_name', 'admin_contact', 'attachment_max_mb')`);
  const m = Object.fromEntries(rows.map((r) => [r.key as string, r.value as string]));
  const mb = Number(m.attachment_max_mb);
  return (
    <SettingsForm
      settings={{
        lab_name: m.lab_name ?? '',
        admin_contact: m.admin_contact ?? '',
        attachment_max_mb: Number.isInteger(mb) && mb >= 1 && mb <= 200 ? mb : 30,
      }}
      // 값 자체(주소·경로·키)는 화면으로 보내지 않고 설정 여부만 전달한다.
      status={{
        email_reset_enabled: emailResetEnabled(),
        app_base_url_set: !!process.env.APP_BASE_URL,
        attachment_dir_set: !!process.env.ATTACHMENT_DIR,
      }}
    />
  );
}
