// The admin app proxies /api/* to the Express API so the session cookie stays
// first-party and httpOnly. API_URL is server-side only (never sent to the browser).
const API_URL = process.env.API_URL || 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // website/ also has a package.json (Firebase tooling); keep tracing scoped to this app.
  outputFileTracingRoot: import.meta.dirname,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
