// 입력 검증 유틸 (서버)
import { HttpError } from './db';

export const ADMIN_PASSWORD_MIN = 6; // 관리자가 초기 발급·재설정하는 비밀번호
export const SELF_PASSWORD_MIN = 12; // 직원이 직접 변경하는 비밀번호

function password(pw: unknown, confirm: unknown, min: number): string {
  const p = typeof pw === 'string' ? pw : '';
  if (p.length < min) throw new HttpError(400, `비밀번호는 ${min}자 이상이어야 합니다.`);
  if (p.length > 72) throw new HttpError(400, '비밀번호는 72자 이하여야 합니다.');
  if (p !== confirm) throw new HttpError(400, '비밀번호 확인이 일치하지 않습니다.');
  return p;
}
export const validateSelfPassword = (pw: unknown, confirm: unknown) => password(pw, confirm, SELF_PASSWORD_MIN);
export const validateAdminPassword = (pw: unknown, confirm: unknown) => password(pw, confirm, ADMIN_PASSWORD_MIN);

export function str(v: unknown, max = 200, name = '값'): string {
  const s = v === null || v === undefined ? '' : String(v).trim();
  if (s.length > max) throw new HttpError(400, `${name}: ${max}자 이하로 입력해 주세요.`);
  return s;
}
export function text(v: unknown, max = 5000, name = '내용'): string {
  const s = v === null || v === undefined ? '' : String(v).replace(/\r\n/g, '\n').trimEnd();
  if (s.length > max) throw new HttpError(400, `${name}: ${max}자 이하로 입력해 주세요.`);
  return s;
}
export function reqStr(v: unknown, max: number, name: string): string {
  const s = str(v, max, name);
  if (!s) throw new HttpError(400, `${name}: 값을 입력해 주세요.`);
  return s;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(v: unknown, name = '식별자'): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(400, `${name}: 값이 올바르지 않습니다.`);
  return v;
}
export function optUuid(v: unknown, name = '식별자'): string | null {
  if (v === null || v === undefined || v === '') return null;
  return uuid(v, name);
}
export function int(v: unknown, min: number, max: number, name: string): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (v === '' || v === null || v === undefined || !Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name}: 값이 올바르지 않습니다.`);
  return n;
}
export function optNum(v: unknown, name: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n) || Math.abs(n) > 1e15) throw new HttpError(400, `${name}: 숫자가 올바르지 않습니다.`);
  return n;
}
export function num(v: unknown, name: string): number {
  const n = optNum(v, name);
  if (n === null) throw new HttpError(400, `${name}: 값을 입력해 주세요.`);
  return n;
}
export function oneOf<T extends string>(v: unknown, list: readonly T[], name: string): T {
  if (typeof v !== 'string' || !list.includes(v as T)) throw new HttpError(400, `${name}: 값이 올바르지 않습니다.`);
  return v as T;
}
export function optDate(v: unknown, name: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(`${s}T00:00:00Z`))) throw new HttpError(400, `${name}: 날짜 형식이 올바르지 않습니다. (예: 2026-11-11)`);
  return s;
}
export function emailStr(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) || s.length > 200) throw new HttpError(400, '이메일 형식이 올바르지 않습니다.');
  return s;
}
