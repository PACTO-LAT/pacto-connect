/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/examples/react',
  transpilePackages: ['@pacto-connect/core', '@pacto-connect/react'],
  reactStrictMode: true,
};

export default nextConfig;
