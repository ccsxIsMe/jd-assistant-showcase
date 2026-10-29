import { readdir, readFile, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, basename } from 'node:path';
// 检查“将发布的文件”，不是扫描用户磁盘；支持 Git 克隆及不含 .git 的源码 ZIP。
const root = process.cwd();
if (JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).name !== 'jd-assistant')
  throw new Error('Run this check from the showcase project root.');
const ignored =
  /^(?:\.git|node_modules|\.next(?:-verify)?|test-results[^/]*|playwright-report|coverage|out|dist)(?:\/|$)|^docs\/screenshots\//;
const git = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
  windowsHide: true,
});
let files = [];
if (git.status === 0 && resolve(git.stdout.trim()) === resolve(root)) {
  const list = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (list.status !== 0) throw new Error('Cannot inspect Git file list.');
  files = [...new Set(list.stdout.split('\0').filter(Boolean))];
} else {
  async function walk(dir = '') {
    for (const e of await readdir(resolve(root, dir), { withFileTypes: true })) {
      const p = (dir ? dir + '/' : '') + e.name;
      if (ignored.test(p)) continue;
      if (e.isDirectory()) await walk(p);
      else files.push(p);
    }
  }
  await walk();
}
// 仅输出文件名和规则，不打印命中片段。格式扫描不能替代真实配置的私有精确核验。
const issues = [];
for (const file of files) {
  const p = file.replaceAll('\\', '/'),
    name = basename(p),
    info = await lstat(resolve(root, file));
  if (info.isSymbolicLink()) {
    issues.push({ file: p, rule: 'symlink' });
    continue;
  }
  if (
    (name.startsWith('.env') && p !== '.env.example') ||
    /(?:^|\/)(?:private-audit|\.ssh|\.aws|\.codex|\.agents|node_modules|\.next[^/]*|test-results[^/]*)(?:\/|$)/.test(
      p,
    ) ||
    /\.(?:pem|key|p12|pfx|log)$/.test(name) ||
    /^id_(?:rsa|ed25519)/.test(name)
  )
    issues.push({ file: p, rule: 'forbidden-file' });
  if (info.size > 20 * 1024 * 1024) issues.push({ file: p, rule: 'oversized-file' });
  if (!/\.(?:[cm]?[jt]sx?|json|ya?ml|md|txt|html|css|example)$/.test(p) && !name.startsWith('.'))
    continue;
  const text = await readFile(resolve(root, file), 'utf8');
  const rules = [
    ['private-key', /-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/],
    [
      'provider-token',
      /\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b/,
    ],
    ['personal-path', /[A-Z]:\\+(?:Users|MyProject)\\+[A-Za-z]/],
  ];
  for (const [rule, re] of rules) if (re.test(text)) issues.push({ file: p, rule });
  for (const match of text.matchAll(/https?:\/\/[^\s/@:]+:[^\s/@]+@[A-Za-z0-9.-]+/g)) {
    // These exact reserved-domain literals exercise rejection of URL credentials.
    const negativeFixture =
      (p === 'tests/unit/exploration.test.ts' &&
        match[0] === ['https:', '//user:password', '@example.com'].join('')) ||
      (p === 'tests/unit/ai-tasks.test.ts' &&
        match[0] === ['https:', '//username:private-value', '@example.com'].join(''));
    if (!negativeFixture) issues.push({ file: p, rule: 'credential-url' });
  }
  if (p === '.env.example' && !/^DEEPSEEK_API_KEY=\s*$/m.test(text))
    issues.push({ file: p, rule: 'nonempty-example-key' });
}
console.log(
  JSON.stringify({ filesChecked: files.length, passed: issues.length === 0, issues }, null, 2),
);
if (issues.length) process.exitCode = 1;
