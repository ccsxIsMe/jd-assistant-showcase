import { mkdir, writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
const baseURL = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname))
  throw new Error('Only local test servers are allowed');
const response = await fetch(`${baseURL}/api/ai/tasks`);
if (!response.ok) throw new Error('Task registry unavailable');
const { tasks } = await response.json();
const lab = await fetch(`${baseURL}/api/lab/tasks`);
if (!lab.ok) throw new Error('Lab task registry unavailable');
tasks.push(...(await lab.json()).tasks);
const resume = await fetch(`${baseURL}/api/resume/tasks`);
if (!resume.ok) throw new Error('Resume task registry unavailable');
tasks.push(...(await resume.json()).tasks);
await mkdir('docs/ai-tasks', { recursive: true });
const formatOptions = await resolveConfig('package.json');
for (const task of tasks)
  await writeFile(
    `docs/ai-tasks/${task.name}.json`,
    await format(JSON.stringify(task), { ...formatOptions, parser: 'json' }),
  );
console.log(
  `Exported ${tasks.length} synthetic task examples; no configuration or user data included.`,
);
