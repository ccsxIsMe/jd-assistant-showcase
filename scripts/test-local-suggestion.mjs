// Fixed fictional fixture only. Run explicitly: this makes one real model request.
const baseURL = 'http://127.0.0.1:3000';
const tasksResponse = await fetch(baseURL + '/api/ai/tasks');
if (!tasksResponse.ok) throw new Error('Cannot load public task fixtures');
const { tasks } = await tasksResponse.json();
const sample = tasks.find((task) => task.name === 'proposeLocalChanges').inputExample;
const started = performance.now();
const response = await fetch(baseURL + '/api/workbench', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'suggest',
    mode: 'real',
    targetId: sample.target.id,
    scope: 'selected',
    intent: sample.intent,
    context: {
      id: 'fixed-diagnostic-sample',
      revision: 1,
      title: sample.title,
      sources: sample.sources,
      items: sample.items,
      questions: [],
      decisions: [],
    },
  }),
  signal: AbortSignal.timeout(70000),
});
let result;
try {
  result = await response.json();
} catch {
  result = { code: 'INVALID_RESPONSE' };
}
console.log(
  JSON.stringify({
    status: response.status,
    code: result.code,
    error: response.ok ? undefined : result.error,
    requestId: result.requestId,
    task: result.task,
    groups: result.data?.groups?.length,
    elapsedSeconds: Math.round((performance.now() - started) / 10) / 100,
  }),
);
if (!response.ok) process.exitCode = 1;
