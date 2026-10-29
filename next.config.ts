import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['@ai-sdk/deepseek'],
  distDir: process.env.NEXT_VERIFY_BUILD === '1' ? '.next-verify' : '.next',
};
export default config;
