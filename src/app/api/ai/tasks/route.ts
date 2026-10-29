import { taskRegistry } from '@/lib/ai/tasks';
export function GET() {
  return Response.json({
    tasks: Object.values(taskRegistry).map((task) => ({
      name: task.name,
      promptVersion: task.promptVersion,
      inputExample: task.exampleInput,
      outputExample: task.exampleOutput,
    })),
  });
}
