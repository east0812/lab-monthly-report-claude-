// 월차보고 내역: 연도·상태·제품·업무 분류로 지난 보고서를 찾아 연다.
import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { ReportList } from '@/components/reports/ReportList';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const me = await requireUser();
  const rows = await withUser(me.id, (tx) => tx`
    select r.id, r.year, r.month, r.status, r.summary, r.submitted_at, r.updated_at,
      (select count(*) from report_items i where i.report_id = r.id)
        + (select count(*) from dev_project_monthly m where m.report_id = r.id)
        + (select count(*) from dev_works d where d.user_id = r.user_id and d.year = r.year and d.month = r.month)
        + (select count(*) from transfers t where t.user_id = r.user_id and t.year = r.year and t.month = r.month) as work_count,
      (select count(*) from report_attachments a where a.report_id = r.id) as attach_count,
      coalesce((select array_agg(distinct x.label) from (
          select p.name || case when p.model <> '' then ' (' || p.model || ')' else '' end as label
            from report_items i join products p on p.id = i.product_id where i.report_id = r.id
          union select p.name || case when p.model <> '' then ' (' || p.model || ')' else '' end
            from dev_works d join products p on p.id = d.product_id where d.user_id = r.user_id and d.year = r.year and d.month = r.month
          union select p.name || case when p.model <> '' then ' (' || p.model || ')' else '' end
            from transfers t join products p on p.id = t.product_id where t.user_id = r.user_id and t.year = r.year and t.month = r.month
          union select p.name || case when p.model <> '' then ' (' || p.model || ')' else '' end
            from dev_project_monthly m join dev_projects j on j.id = m.project_id join products p on p.id = j.product_id where m.report_id = r.id
        ) x), '{}') as products,
      coalesce((select array_agg(distinct x.name) from (
          select c.name from report_items i join work_categories c on c.id = i.category_id where i.report_id = r.id
          union select c.name from dev_works d join work_categories c on c.id = d.category_id where d.user_id = r.user_id and d.year = r.year and d.month = r.month
          union select c.name from dev_project_monthly m join dev_projects j on j.id = m.project_id join work_categories c on c.id = j.category_id where m.report_id = r.id
        ) x), '{}') as categories
    from monthly_reports r where r.user_id = ${me.id}
    order by r.year desc, r.month desc`);
  return <ReportList rows={rows.map((r) => ({ ...r })) as never} />;
}
