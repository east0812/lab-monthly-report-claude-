// 관리자: 개발현황·생산이관의 "선택한 월 기록"의 상태만 변경.
// DB 함수 admin_set_month_status 가 상태 칸만 바꾸므로 다른 월·담당자·상세 내용·이관일은 그대로 보존된다.
import { route, readJson } from '@/lib/auth';
import { uuid, int, oneOf } from '@/lib/validate';
import { WORK_STATUS_KEYS } from '@/lib/constants';

export const POST = route({ admin: true }, async ({ req, db }) => {
  const b = await readJson(req);
  const kind = oneOf(b.kind, ['dev', 'transfer'] as const, '구분');
  const id = uuid(b.id);
  const status = oneOf(b.status, WORK_STATUS_KEYS, '상태');
  const version = int(b.version, 1, 1e9, '버전');
  const [r] = await db((tx) => tx`select admin_set_month_status(${kind}, ${id}, ${status}, ${version}) as version`);
  return { version: r.version };
});
