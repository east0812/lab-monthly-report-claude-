import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['postgres'],
  // 첨부 업로드(최대 200MB 설정 가능)가 proxy 를 지나갈 수 있도록 본문 버퍼 한도를 올린다.
  experimental: { proxyClientMaxBodySize: '210mb' },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
