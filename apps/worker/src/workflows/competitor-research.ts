import { and, eq, ne } from 'drizzle-orm';
import {
  auth,
  competitorResearch as c,
  canAccessProduct,
  type Database,
} from '@guangmo/database';
import {
  analyzeCompetitorReport,
  competitorResearchGoal,
  research,
} from '@guangmo/agent';
import { canonicalizeUrl, type ResearchEventData } from '@guangmo/contracts';
import type { ModelConfig } from './research.js';
export async function executeCompetitorResearch(
  db: Database,
  id: string,
  generation: number,
  attempt: number,
  model: ModelConfig,
) {
  // Model calls execute only in this durable Worker, independently of the browser.
  const [run] = await db
    .select()
    .from(c.competitorResearchRuns)
    .where(eq(c.competitorResearchRuns.id, id));
  if (!run || run.status === 'succeeded' || run.generation !== generation)
    return;
  const [profile] = await db
    .select()
    .from(c.competitorProfiles)
    .where(eq(c.competitorProfiles.id, run.competitorId));
  async function authorize() {
    const [owner] = await db
      .select()
      .from(auth.user)
      .where(eq(auth.user.id, run!.createdBy));
    if (
      !profile ||
      !owner ||
      owner.disabled ||
      !['admin', 'operator'].includes(owner.role) ||
      !(await canAccessProduct(db, owner.id, profile.product, true))
    )
      throw new Error('竞品研究成员失权或产品已归档');
  }
  await authorize();
  if (!model.apiKey || !model.model) throw new Error('模型与搜索服务尚未配置');
  const event = async (message: string, data?: ResearchEventData) => {
    await db
      .insert(c.competitorResearchEvents)
      .values({ runId: id, message, data });
  };
  await db
    .update(c.competitorResearchRuns)
    .set({
      status: 'running',
      attempts: attempt,
      error: null,
      model: model.model,
      completedAt: null,
    })
    .where(eq(c.competitorResearchRuns.id, id));
  const [previous] = run.previousRunId
    ? await db
        .select()
        .from(c.competitorResearchRuns)
        .where(
          and(
            eq(c.competitorResearchRuns.id, run.previousRunId),
            eq(c.competitorResearchRuns.competitorId, run.competitorId),
            eq(c.competitorResearchRuns.status, 'succeeded'),
          ),
        )
    : [];
  const previousFindings = previous?.findings
    ? canonicalizeUrl(previous.config.website) ===
        canonicalizeUrl(run.config.website) &&
      previous.config.market === run.config.market
      ? previous.findings
      : previous.findings.map((f) => ({
          ...f,
          availability: 'unknown' as const,
          summary: '官网或市场配置已变更，历史记录不可直接比较。',
        }))
    : null;
  let report = run.report;
  if (run.stage === 'research') {
    await event('开始六维竞品研究');
    const result = await research({
      goal: competitorResearchGoal(run.config, previousFindings),
      readPublicPages: true,
      apiKey: model.apiKey,
      baseURL: model.baseURL,
      model: model.model,
      onProgress: event,
      onDraft: async (text) => {
        await db
          .update(c.competitorResearchRuns)
          .set({ report: text })
          .where(eq(c.competitorResearchRuns.id, id));
      },
    });
    await authorize();
    report = result.text;
    await db
      .update(c.competitorResearchRuns)
      .set({ stage: 'analysis', report })
      .where(eq(c.competitorResearchRuns.id, id));
    await event('研究报告已保存，开始整理变化卡片');
  } else await event('从已保存报告恢复整理，不重复搜索');
  if (!report) throw new Error('研究报告为空');
  const events = await db
    .select()
    .from(c.competitorResearchEvents)
    .where(eq(c.competitorResearchEvents.runId, id));
  const sources = events
    .filter((e) => e.data?.kind === 'source' && e.data.url)
    .map((e) => ({ url: e.data!.url!, title: e.data?.title }));
  const result = await analyzeCompetitorReport({
    report,
    sources,
    previous: previousFindings,
    apiKey: model.apiKey,
    baseURL: model.baseURL,
    model: model.model,
  });
  await authorize();
  await db.transaction(async (tx) => {
    await tx
      .update(c.competitorResearchRuns)
      .set({
        status: 'succeeded',
        findings: result.findings,
        error: null,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(c.competitorResearchRuns.id, id),
          eq(c.competitorResearchRuns.generation, generation),
        ),
      );
    await tx
      .insert(c.competitorResearchEvents)
      .values({ runId: id, message: '六维研究与变化卡片已保存，待人工核实' });
  });
}
export async function failCompetitorResearch(
  db: Database,
  id: string,
  generation: number,
  attempts: number,
  final: boolean,
  error: Error,
) {
  await db
    .update(c.competitorResearchRuns)
    .set({
      status: final ? 'failed' : 'queued',
      attempts,
      error: error.message.slice(0, 1500),
      completedAt: final ? new Date() : null,
    })
    .where(
      and(
        eq(c.competitorResearchRuns.id, id),
        eq(c.competitorResearchRuns.generation, generation),
        ne(c.competitorResearchRuns.status, 'succeeded'),
      ),
    );
  await db.insert(c.competitorResearchEvents).values({
    runId: id,
    message: final
      ? '研究未完成，可重试；已完成报告将保留'
      : '本次执行失败，准备重试',
  });
}
