// 월차보고 생성: 직원·연·월별 한 건
import { route, readJson } from '@/lib/auth';
import { int } from '@/lib/validate';

export const POST = route({}, async ({ user, req, db }) => {
  const b = await readJson(req);
  const year = int(b.year, 2000, 2100, '연도');
  const month = int(b.month, 1, 12, '월');
  return db(async (tx) => {
    const [made] = await tx`
      insert into monthly_reports (user_id, year, month) values (${user.id}, ${year}, ${month})
      on conflict (user_id, year, month) do nothing returning id`;
    if (made) return { id: made.id, created: true };
    const [old] = await tx`select id from monthly_reports where user_id = ${user.id} and year = ${year} and month = ${month}`;
    return { id: old.id, created: false };
  });
});
