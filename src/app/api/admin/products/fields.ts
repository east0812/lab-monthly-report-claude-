// 제품 입력 검증과 오류 안내 (제품 관리 API 공용)
import { HttpError } from '@/lib/db';
import { reqStr, str, text } from '@/lib/validate';

export function productFields(body: Record<string, unknown>) {
  return {
    name: reqStr(body.name, 100, '제품명'),
    model: str(body.model, 100, '모델'),
    family: str(body.family, 100, '제품군'),
    freq_band: str(body.freq_band, 100, '주파수대역'),
    revision: str(body.revision, 50, 'Revision'),
    note: text(body.note, 1000, '비고').trim(),
  };
}

/** 사용 중인 제품의 제품명+모델 중복(23505)을 알기 쉬운 409 로 바꾼다. */
export function dupToHttp(e: unknown, message: string): never {
  if ((e as { code?: string })?.code === '23505') throw new HttpError(409, message);
  throw e;
}
