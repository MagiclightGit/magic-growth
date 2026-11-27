import { and, eq, ne } from 'drizzle-orm';
import {
  auth,
  growth,
  canAccessProduct,
  type Database,
} from '@guangmo/database';
import { SCORING_VERSION } from '@guangmo/contracts';
import { proposeScore } from '@guangmo/agent';

export const scoringJobId = (id: string, generation: number) =>
  `score-${id}-${generation}`;
export async function executeScoring(
  db: Database,
  id: string,
  generation: number,
  attempt: number,
  model: { apiKey?: string; model?: string; baseURL?: string },
) {
  const [row] = await db
    .select()
    .from(growth.opportunityAssessments)
    .where(eq(growth.opportunityAssessments.id, id));
  if (!row || row.generation !== generation || row.status === 'succeeded')
    return;
  if (row.version !== SCORING_VERSION) throw new Error('不支持此评分规则版本');
  const [owner] = await db
    .select()
    .from(auth.user)
    .where(eq(auth.user.id, row.createdBy));
  if (!owner || owner.disabled || !['admin', 'operator'].includes(owner.role))
    throw new Error('发起成员已无评分权限');
  if (!(await canAccessProduct(db, owner.id, row.input.subject.product, true)))
    throw new Error('产品已归档或产品权限已撤销');
  if (!model.apiKey || !model.model) throw new Error('评分服务尚未配置');
  await db
    .update(growth.opportunityAssessments)
    .set({ status: 'running', attempts: attempt, error: null })
    .where(eq(growth.opportunityAssessments.id, id));
  const proposal = await proposeScore(row.input, {
    apiKey: model.apiKey,
    model: model.model,
    baseURL: model.baseURL,
  });
  if (!(await canAccessProduct(db, owner.id, row.input.subject.product, true)))
    throw new Error('产品权限已撤销或产品已归档');
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(growth.opportunityAssessments)
      .where(eq(growth.opportunityAssessments.id, id))
      .for('update');
    if (
      !current ||
      current.generation !== generation ||
      current.status === 'succeeded'
    )
      return;
    await tx
      .update(growth.opportunityAssessments)
      .set({
        status: 'succeeded',
        proposal,
        error: null,
        completedAt: new Date(),
        model: model.model,
      })
      .where(eq(growth.opportunityAssessments.id, id));
    await tx.insert(growth.auditLog).values({
      actorId: row.createdBy,
      objectId: id,
      action: 'scoring.completed',
      details: { version: row.version, model: model.model, generation },
    });
  });
}
export async function failScoring(
  db: Database,
  id: string,
  generation: number,
  attempts: number,
  final: boolean,
  error: Error,
) {
  await db
    .update(growth.opportunityAssessments)
    .set({
      status: final ? 'failed' : 'queued',
      attempts,
      error: error.message.slice(0, 1000),
      completedAt: final ? new Date() : null,
    })
    .where(
      and(
        eq(growth.opportunityAssessments.id, id),
        eq(growth.opportunityAssessments.generation, generation),
        ne(growth.opportunityAssessments.status, 'succeeded'),
      ),
    );
}
