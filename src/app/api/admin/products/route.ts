// 제품 관리: 목록, 등록 (관리자 전용)
import { route, readJson } from '@/lib/auth';
import { listProducts } from '@/lib/data';
import { productFields, dupToHttp } from './fields';

export const GET = route({ admin: true }, async ({ db, req }) => {
  const v = req.nextUrl.searchParams.get('includeDeleted');
  const includeDeleted = v === '1' || v === 'true';
  const products = await db((tx) => listProducts(tx, includeDeleted));
  return { products };
});

export const POST = route({ admin: true }, async ({ db, req }) => {
  const f = productFields(await readJson(req));
  try {
    const [p] = await db((tx) => tx`
      insert into products (name, model, family, freq_band, revision, note)
      values (${f.name}, ${f.model}, ${f.family}, ${f.freq_band}, ${f.revision}, ${f.note})
      returning id, name, model, family, freq_band, revision, note, deleted_at, version, updated_at`);
    return { product: p };
  } catch (e) {
    dupToHttp(e, '같은 제품명·모델의 제품이 이미 있습니다.');
  }
});
