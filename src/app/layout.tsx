import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: '연구소 월차보고', description: '연구소 월차보고 관리' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
