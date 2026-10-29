import { z } from 'zod';
import { resumeEvidenceTask } from '@/lib/ai/tasks/resume-evidence';
import { newReviewSession, prepareResumeRequest, standardFromJd } from '@/lib/resume/domain';
import { mockResumeReview } from '@/lib/resume/mock';
export function GET() {
  const session = newReviewSession(standardFromJd('负责活动页面与报名表单实现，并提供验收样例。'));
  session.material.text = '虚构测试经历：负责活动页面与报名表单实现，并提供验收样例。';
  const input = prepareResumeRequest(session, true);
  return Response.json(
    {
      tasks: [
        {
          name: resumeEvidenceTask.name,
          promptVersion: resumeEvidenceTask.promptVersion,
          system: resumeEvidenceTask.system,
          inputSchema: z.toJSONSchema(resumeEvidenceTask.inputSchema),
          outputSchema: z.toJSONSchema(resumeEvidenceTask.outputSchema),
          example: { input, output: mockResumeReview(input) },
          notice: '固定无敏感示例，不读取配置、不调用模型。',
        },
      ],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
