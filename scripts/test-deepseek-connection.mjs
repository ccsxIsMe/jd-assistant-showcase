const response = await fetch('http://127.0.0.1:3000/api/ai/connection', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ confirm: true }),
  signal: AbortSignal.timeout(25000),
});
const result = await response.json();
console.log(JSON.stringify({ status: response.status, ...result }, null, 2));
if (!response.ok || !result.ok) process.exitCode = 1;
