// 제품 수정 / 삭제(복원 가능) / 복원 (관리자 전용, 낙관적 잠금)
import { route, readJson } from '@/lib/auth';
import { HttpError, type Tx } from '@/lib/db';
import { int, oneOf, uuid } from '@/lib/validate';
import { productFields, dupToHttp } from '../fields';

const STALE = '다른 화면에서 먼저 수정되었습니다. 새로 고친 뒤 다시 시도해 주세요.';

/** 갱신된 행이 없을 때: 없는 제품(404) / 버전 불일치(409) / 이미 같은 상태(409) 를 구분한다. */
async function explainMiss(tx: Tx, id: string, version: number, sameState: string): Promise<never> {
  const [cur] = await tx`select version from products where id = ${id}`;
  if (!cur) throw new HttpError(404, '제품을 찾을 수 없습니다.');
  if (cur.version !== version) throw new HttpError(409, STALE);
  throw new HttpError(409, sameState);
}

export const PATCH = route({ admin: true }, async ({ db, req, params }) => {
  const id = uuid(params.id, '제품');
  const body = await readJson(req);
  const version = int(body.version, 1, 2147483647, '버전');

  if (body.action !== undefined) {
    const action = oneOf(body.action, ['delete', 'restore'] as const, '요청');
    if (action === 'delete') {
      // 행은 남겨 두므로 기존 보고서·업무 이력은 그대로 보존된다.
      const product = await db(async (tx) => {
        const [p] = await tx`
          update products set deleted_at = now()
          where id = ${id} and version = ${version} and deleted_at is null
          returning id, name, model, family, freq_band, revision, note, deleted_at, version, updated_at`;
        return p ?? explainMiss(tx, id, version, '이미 삭제된 제품입니다.');
      });
      return { product };
    }
    try {
      const product = await db(async (tx) => {
        const [p] = await tx`
          update products set deleted_at = null
          where id = ${id} and version = ${version} and deleted_at is not null
          returning id, name, model, family, freq_band, revision, note, deleted_at, version, updated_at`;
        return p ?? explainMiss(tx, id, version, '삭제된 제품이 아닙니다.');
      });
      return { product };
    } catch (e) {
      dupToHttp(e, '같은 제품명·모델의 제품이 이미 사용 중이어서 복원할 수 없습니다. 제품명이나 모델을 바꾼 뒤 다시 시도해 주세요.');
    }
  }

  const f = productFields(body);
  try {
    const product = await db(async (tx) => {
      const [p] = await tx`
        update products set name = ${f.name}, model = ${f.model}, family = ${f.family},
          freq_band = ${f.freq_band}, revision = ${f.revision}, note = ${f.note}
        where id = ${id} and version = ${version}
        returning id, name, model, family, freq_band, revision, note, deleted_at, version, updated_at`;
      return p ?? explainMiss(tx, id, version, STALE);
    });
    return { product };
  } catch (e) {
    dupToHttp(e, '같은 제품명·모델의 제품이 이미 있습니다.');
  }
});
