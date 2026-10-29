import { execFileSync } from 'node:child_process';
for (const args of [[], ['--software']])
  execFileSync(process.execPath, ['scripts/prepare-paperboat-demo.mjs', ...args], {
    stdio: 'inherit',
    windowsHide: true,
  });
