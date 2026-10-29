import { readConfig, PublicError } from '@/lib/ai/config';
export const dynamic = 'force-dynamic';
export function GET() {
  try {
    return Response.json({ mode: readConfig().mode }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { error: error instanceof PublicError ? error.message : '配置读取失败。' },
      { status: 503 },
    );
  }
}
