import type { NextConfig } from 'next';

const preview = process.env.ACTA_PREVIEW === '1';

const nextConfig: NextConfig = {
  images: { formats: ['image/avif', 'image/webp'] },
  async headers() {
    const base = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ];
    return [{ source: '/:path*', headers: preview ? [...base, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }] : base }];
  },
};

export default nextConfig;
