import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const path = resolve('.env.local');
try {
  await writeFile(
    path,
    'AI_MODE=mock\nDEEPSEEK_API_KEY=\nDEEPSEEK_BASE_URL=https://api.deepseek.com\nDEEPSEEK_MODEL=deepseek-flash\n',
    { flag: 'wx' },
  );
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
console.log(`Configuration file: ${path} (existing contents preserved; key not displayed)`);
