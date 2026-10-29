import 'server-only';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { generateText, Output, streamText } from 'ai';
import { z } from 'zod';
import { outputs, jdOutput, type Task } from '../schemas';
import { PublicError, readConfig } from './config';
import { systemPrompt, dataPrompt } from './prompts';
import { mockResult } from './mock';
function options(task: Task, data: unknown, signal: AbortSignal) {
  const cfg = readConfig();
  return {
    model: createDeepSeek({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })(cfg.model!),
    system: systemPrompt(task),
    prompt: dataPrompt(data),
    abortSignal: signal,
    maxRetries: 0,
    maxOutputTokens: 8000,
    providerOptions: { deepseek: { thinking: { type: 'disabled' } } },
  };
}
export async function structured(
  task: Exclude<Task, 'generate'>,
  data: unknown,
  signal: AbortSignal,
) {
  const cfg = readConfig();
  if (cfg.mode === 'mock') return outputs[task].parse(mockResult(task, data));
  const schema = outputs[task] as z.ZodType;
  const { output } = await generateText({
    ...options(task, data, signal),
    output: Output.object({ schema }),
  });
  return schema.parse(output);
}
export async function* generateJD(data: unknown, signal: AbortSignal) {
  if (readConfig().mode === 'mock') {
    yield jdOutput.parse(mockResult('generate', data));
    return;
  }
  const result = streamText({ ...options('generate', data, signal), onError: () => {} });
  let complete = '';
  for await (const part of result.fullStream) {
    if (part.type === 'error') throw part.error;
    if (part.type === 'abort') throw new PublicError('模型生成已取消或超时，请重试。', 408);
    if (part.type === 'text-delta') {
      complete += part.text;
      if (complete.length > 50000) throw new Error('Output too long');
      yield part.text;
    }
  }
  if (signal.aborted) throw new PublicError('模型生成已取消或超时，请重试。', 408);
  if ((await result.finishReason) !== 'stop')
    throw new PublicError('模型输出未完整结束，请重试。', 502);
  jdOutput.parse(complete);
}
