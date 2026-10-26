/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: '/world/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
          { key: 'Access-Control-Allow-Origin', value: '*' }
        ]
      }
    ];
  }
};

export default nextConfig;
