import { type Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import {
  auth,
  growth,
  catalog,
  canAccessProduct,
  type Database,
} from '@guangmo/database';
import {
  COLLECTION_WORKFLOW_VERSION,
  type ResearchEventData,
} from '@guangmo/contracts';
import { research } from '@guangmo/agent';
export interface ResearchJob {
  collectionRunId?: string;
  conversationTurnId?: string;
  snapshotId?: string;
  competitorRunId?: string;
  runId?: string;
  assessmentId?: string;
  scheduleId?: string;
  extractionId?: string;
  generation?: number;
}
export interface ModelConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}
export async function executeResearch(
  db: Database,
  job: Job<ResearchJob>,
  model: ModelConfig,
) {
  const event = async (
    runId: string,
    message: string,
    data?: ResearchEventData,
  ) => {
    await db.insert(growth.runEvents).values({ runId, message, data });
  };
  let runId = job.data.runId;
  if (job.data.scheduleId) {
    const [schedule] = await db
      .select()
      .from(growth.researchSchedules)
      .where(
        and(
          eq(growth.researchSchedules.id, job.data.scheduleId),
          eq(growth.researchSchedules.enabled, true),
        ),
      );
    if (!schedule) return;
    const [owner] = await db
      .select()
      .from(auth.user)
      .where(eq(auth.user.id, schedule.createdBy));
    if (!owner || owner.disabled || !['admin', 'operator'].includes(owner.role))
      return;
    if (
      !(await canAccessProduct(db, schedule.createdBy, schedule.product, true))
    )
      return;
    const [created] = await db
      .insert(growth.researchRuns)
      .values({
        goal: schedule.goal,
        product: schedule.product,
        createdBy: schedule.createdBy,
        queueJobId: job.id,
      })
      .onConflictDoNothing()
      .returning();
    const [existing] = created
      ? [created]
      : await db
          .select()
          .from(growth.researchRuns)
          .where(eq(growth.researchRuns.queueJobId, job.id!));
    runId = existing?.id;
    await job.updateData({ ...job.data, runId });
  }
  if (!runId) throw new Error('Missing run ID');
  const [run] = await db
    .select()
    .from(growth.researchRuns)
    .where(eq(growth.researchRuns.id, runId));
  if (!run || run.status === 'succeeded') return;
  const [owner] = run.createdBy
    ? await db.select().from(auth.user).where(eq(auth.user.id, run.createdBy))
    : [];
  if (!owner || owner.disabled || !['admin', 'operator'].includes(owner.role))
    throw new Error('研究发起成员已无执行权限');
  if (!(await canAccessProduct(db, owner.id, run.product, true)))
    throw new Error('研究产品已归档或产品权限已撤销');
  await db
    .update(growth.researchRuns)
    .set({
      status: 'running',
      attempts: job.attemptsMade + 1,
      error: null,
      result: null,
      completedAt: null,
    })
    .where(eq(growth.researchRuns.id, runId));
  await event(runId, '开始研究');
  if (!model.apiKey || !model.model) throw new Error('模型与搜索服务尚未配置');
  const [product] = await db
    .select()
    .from(catalog.products)
    .where(eq(catalog.products.id, run.product!));
  const result = await research({
    goal: `所属产品：${product!.name}。产品背景：${product!.description}\n研究目标：${run.goal}`,
    apiKey: model.apiKey,
    baseURL: model.baseURL || undefined,
    model: model.model,
    onProgress: (message, data) => event(runId!, message, data),
    onDraft: async (text) => {
      await db
        .update(growth.researchRuns)
        .set({ result: text })
        .where(eq(growth.researchRuns.id, runId!));
    },
  });
  if (!(await canAccessProduct(db, owner.id, run.product, true)))
    throw new Error('产品权限已撤销或产品已归档');
  await db.transaction(async (tx) => {
    await tx
      .update(growth.researchRuns)
      .set({
        status: 'succeeded',
        result: result.text,
        completedAt: new Date(),
      })
      .where(eq(growth.researchRuns.id, runId!));
    await tx
      .insert(growth.runEvents)
      .values({ runId: runId!, message: '研究完成' });
    await tx
      .insert(growth.researchExtractions)
      .values({
        runId: runId!,
        createdBy: run.createdBy!,
        workflowVersion: COLLECTION_WORKFLOW_VERSION,
      })
      .onConflictDoNothing();
  });
}
