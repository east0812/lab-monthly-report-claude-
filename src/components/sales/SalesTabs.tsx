'use client';
// 매출현황 탭 전환 (쿼리 tab 을 바꾼다. 연·월 선택은 유지)
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from '@/components/ui';

export type SalesTab = 'list' | 'chart';

export function SalesTabs({ tab }: { tab: SalesTab }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (
    <Tabs<SalesTab>
      value={tab}
      tabs={[{ key: 'list', label: '개별 매출내역' }, { key: 'chart', label: '연간 그래프' }]}
      onChange={(k) => {
        const q = new URLSearchParams(sp.toString());
        q.set('tab', k);
        router.push(`${path}?${q.toString()}`);
      }}
    />
  );
}
