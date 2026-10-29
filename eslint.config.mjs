import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    '.next-verify/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
    'public/pdf.worker.min.mjs',
    'public/pdf-cmaps/**',
    'public/pdf-fonts/**',
  ]),
]);
