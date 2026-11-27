import { and, eq, ne } from 'drizzle-orm';
import {
  auth,
  growth,
  canAccessProduct,
  requestScore,
  type Database,
} from '@guangmo/database';
import {
  COLLECTION_WORKFLOW_VERSION,
  type ResearchEventData,
} from '@guangmo/contracts';
import { extractCandidates, extractCandidatesWithTime } from '@guangmo/agent';

const extractionHandlers: Record<string, typeof extractCandidates> = {
  'research-to-intelligence/v1': extractCandidates,
  [COLLECTION_WORKFLOW_VERSION]: extractCandidatesWithTime,
};

export interface ExtractionJob {
  extractionId: string;
  generation: number;
}
export function extractionJobId(id: string, generation: number) {
  return `extract-${id}-${generation}`;
}
export async function executeExtraction(
  db: Database,
  job: ExtractionJob,
  attempt: number,
  model: {
    apiKey?: string;
    baseURL?: string;
    model?: string;
  },
) {
  const [stage] = await db
    .select()
    .from(growth.researchExtractions)
    .where(eq(growth.researchExtractions.id, job.extractionId));
  if (
    !stage ||
    stage.generation !== job.generation ||
    stage.status === 'succeeded'
  )
    return;
  const handler = extractionHandlers[stage.workflowVersion];
  if (!handler) throw new Error('不支持此工作流版本');
  const [owner] = await db
    .select()
    .from(auth.user)
    .where(eq(auth.user.id, stage.createdBy));
  if (!owner || owner.disabled || !['admin', 'operator'].includes(owner.role))
    throw new Error('发起成员已无执行权限');
  const [run] = await db
    .select()
    .from(growth.researchRuns)
    .where(eq(growth.researchRuns.id, stage.runId));
  if (!run || run.status !== 'succeeded' || !run.result)
    throw new Error('研究报告尚未完成');
  if (!(await canAccessProduct(db, owner.id, run.product, true)))
    throw new Error('产品已归档或产品权限已撤销');
  await db
    .update(growth.researchExtractions)
    .set({ status: 'running', attempts: attempt, error: null })
    .where(eq(growth.researchExtractions.id, stage.id));
  const events = await db
    .select()
    .from(growth.runEvents)
    .where(eq(growth.runEvents.runId, run.id));
  const sources = events.flatMap(
    ({ data }: { data: ResearchEventData | null }) =>
      data?.kind === 'source' && data.url
        ? [{ url: data.url, title: data.title }]
        : [],
  );
  await db
    .insert(growth.runEvents)
    .values({ runId: run.id, message: `开始整理情报（第 ${attempt} 次）` });
  const candidates = await handler({
    report: run.result,
    goal: `所属产品标识：${run.product}。所有候选均属于此产品。研究目标：${run.goal}`,
    sources,
    apiKey: model.apiKey,
    baseURL: model.baseURL,
    model: model.model,
  });
  if (!(await canAccessProduct(db, owner.id, run.product, true)))
    throw new Error('产品权限已撤销或产品已归档');
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(growth.researchExtractions)
      .where(eq(growth.researchExtractions.id, stage.id))
      .for('update');
    if (
      !current ||
      current.generation !== job.generation ||
      current.status === 'succeeded'
    )
      return;
    if (candidates.length) {
      const inserted = await tx
        .insert(growth.intelligenceCandidates)
        .values(
          candidates.map((payload, position) => ({
            extractionId: stage.id,
            runId: run.id,
            position,
            payload: { ...payload, product: run.product! },
          })),
        )
        .onConflictDoNothing()
        .returning();
      for (const candidate of inserted)
        await requestScore(
          tx as unknown as Database,
          'candidate',
          candidate.id,
          stage.createdBy,
        );
    }
    await tx
      .update(growth.researchExtractions)
      .set({ status: 'succeeded', error: null, completedAt: new Date() })
      .where(eq(growth.researchExtractions.id, stage.id));
    await tx.insert(growth.runEvents).values({
      runId: run.id,
      message: `情报整理完成，共 ${candidates.length} 条候选`,
    });
    await tx.insert(growth.auditLog).values({
      actorId: stage.createdBy,
      objectId: stage.id,
      action: 'extraction.completed',
      details: {
        runId: run.id,
        count: candidates.length,
        workflowVersion: stage.workflowVersion,
      },
    });
  });
}
export async function failExtraction(
  db: Database,
  job: ExtractionJob,
  attempts: number,
  final: boolean,
  error: Error,
) {
  const [stage] = await db
    .update(growth.researchExtractions)
    .set({
      status: final ? 'failed' : 'queued',
      attempts,
      error: error.message.slice(0, 1000),
      completedAt: final ? new Date() : null,
    })
    .where(
      and(
        eq(growth.researchExtractions.id, job.extractionId),
        eq(growth.researchExtractions.generation, job.generation),
        ne(growth.researchExtractions.status, 'succeeded'),
      ),
    )
    .returning();
  if (stage)
    await db.insert(growth.runEvents).values({
      runId: stage.runId,
      message: final
        ? `情报整理未完成（已尝试 ${attempts} 次）`
        : `情报整理中断，准备第 ${attempts + 1} 次尝试`,
    });
}
