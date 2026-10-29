import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
// Load local configuration only for in-process equality checks. Never print its values.
const require = createRequire(import.meta.url),
  fromNext = createRequire(require.resolve('next/package.json'));
fromNext('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const key = process.env.DEEPSEEK_API_KEY?.trim();
const root = path.resolve(
  process.env.NEXT_VERIFY_BUILD === '1' ? '.next-verify/static' : '.next/static',
);
let files = 0,
  uiNameReferences = 0,
  keyLeak = false,
  runtimeRead = false;
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await scan(file);
    else if (/\.(js|map|json|html)$/.test(entry.name)) {
      const text = await readFile(file, 'utf8');
      files++;
      if (text.includes('DEEPSEEK_API_KEY')) uiNameReferences++;
      if (
        key &&
        key.length >= 12 &&
        (text.includes(key) || text.includes(Buffer.from(key).toString('base64')))
      )
        keyLeak = true;
      if (/process\.env(?:\.DEEPSEEK_API_KEY|\[['"]DEEPSEEK_API_KEY['"]\])/.test(text))
        runtimeRead = true;
    }
  }
}
try {
  await scan(root);
  console.log(
    JSON.stringify({
      filesChecked: files,
      configurationKeyPresent: !!key,
      uiVariableNameReferences: uiNameReferences,
      keyFoundInClient: keyLeak,
      clientRuntimeKeyRead: runtimeRead,
    }),
  );
  if (keyLeak || runtimeRead) process.exitCode = 1;
} catch {
  console.error('Client-boundary check could not complete; no configuration values logged.');
  process.exitCode = 1;
}
