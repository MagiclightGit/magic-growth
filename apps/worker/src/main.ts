import {
  executeCollection,
  failCollection,
  reconcileCollection,
} from './workflows/collection.js';
import {
  executeConversation,
  failConversation,
} from './workflows/conversations.js';
import {
  executeCompetitorResearch,
  failCompetitorResearch,
} from './workflows/competitor-research.js';
import { executeWatch, failWatch } from './workflows/competitors.js';
import {
  executeScoring,
  failScoring,
  scoringJobId,
} from './workflows/scoring.js';
import { executeResearch, type ResearchJob } from './workflows/research.js';
import {
  executeExtraction,
  failExtraction,
  extractionJobId,
} from './workflows/extraction.js';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  createDatabase,
  growth,
  generateDailyBriefs,
  marketWatch,
  competitorResearch,
  researchConversations,
  requestCompetitorResearch,
  dueCompetitors,
  dueWatches,
  requestWatchSnapshot,
} from '@guangmo/database';
import {
  RESEARCH_QUEUE,
  redisConnection,
  type ResearchEventData,
} from '@guangmo/contracts';
const env = z
  .object({
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_BASE_URL: z.union([z.url(), z.literal('')]).optional(),
    RESEARCH_MODEL: z.string().optional(),
  })
  .parse(process.env);
const { db, pool } = createDatabase(env.DATABASE_URL);
const connection = new Redis({
  ...redisConnection(env.REDIS_URL),
  maxRetriesPerRequest: null,
});
const queueConnection = new Redis({
  ...redisConnection(env.REDIS_URL),
  maxRetriesPerRequest: 1,
});
connection.on('error', (error) =>
  console.error('Worker Redis:', error.message),
);
queueConnection.on('error', (error) =>
  console.error('Queue Redis:', error.message),
);
const queue = new Queue(RESEARCH_QUEUE, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});
queue.on('error', (error) => console.error('Queue connection:', error.message));
async function event(runId: string, message: string, data?: ResearchEventData) {
  await db.insert(growth.runEvents).values({ runId, message, data });
}
const worker = new Worker<ResearchJob>(
  RESEARCH_QUEUE,
  async (job) => {
    if (job.data.collectionRunId) {
      try {
        return await executeCollection(
          db,
          job.data.collectionRunId,
          job.attemptsMade + 1,
        );
      } catch (error) {
        await failCollection(
          db,
          job.data.collectionRunId,
          job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
          error instanceof Error ? error : new Error(),
        );
        throw error;
      }
    }
    if (job.data.conversationTurnId)
      return executeConversation(
        db,
        job.data.conversationTurnId,
        job.data.generation ?? 0,
        job.attemptsMade + 1,
        {
          apiKey: env.OPENAI_API_KEY,
          baseURL: env.OPENAI_BASE_URL || undefined,
          model: env.RESEARCH_MODEL,
        },
      );
    if (job.data.competitorRunId)
      return executeCompetitorResearch(
        db,
        job.data.competitorRunId,
        job.data.generation ?? 0,
        job.attemptsMade + 1,
        {
          apiKey: env.OPENAI_API_KEY,
          baseURL: env.OPENAI_BASE_URL || undefined,
          model: env.RESEARCH_MODEL,
        },
      );
    if (job.data.snapshotId)
      return executeWatch(db, job.data.snapshotId, job.attemptsMade + 1);
    if (job.data.assessmentId)
      return executeScoring(
        db,
        job.data.assessmentId,
        job.data.generation ?? 0,
        job.attemptsMade + 1,
        {
          apiKey: env.OPENAI_API_KEY,
          baseURL: env.OPENAI_BASE_URL || undefined,
          model: env.RESEARCH_MODEL,
        },
      );
    if (job.data.extractionId)
      return executeExtraction(
        db,
        {
          extractionId: job.data.extractionId,
          generation: job.data.generation ?? 0,
        },
        job.attemptsMade + 1,
        {
          apiKey: env.OPENAI_API_KEY,
          baseURL: env.OPENAI_BASE_URL || undefined,
          model: env.RESEARCH_MODEL,
        },
      );
    return executeResearch(db, job, {
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL || undefined,
      model: env.RESEARCH_MODEL,
    });
  },
  { connection, concurrency: 2 },
);
worker.on('error', (error) => console.error('Worker:', error.message));
worker.on('failed', (job: Job<ResearchJob> | undefined, error: Error) => {
  void (async () => {
    if (!job || job.data.collectionRunId) return;
    if (job.data.conversationTurnId) {
      await failConversation(
        db,
        job.data.conversationTurnId,
        job.data.generation ?? 0,
        job.attemptsMade,
        job.attemptsMade >= (job.opts.attempts ?? 1),
        error,
      );
      return;
    }
    if (job.data.competitorRunId) {
      await failCompetitorResearch(
        db,
        job.data.competitorRunId,
        job.data.generation ?? 0,
        job.attemptsMade,
        job.attemptsMade >= (job.opts.attempts ?? 1),
        error,
      );
      return;
    }
    if (job.data.snapshotId) {
      await failWatch(
        db,
        job.data.snapshotId,
        job.attemptsMade,
        job.attemptsMade >= (job.opts.attempts ?? 1),
        error,
      );
      return;
    }
    if (job.data.assessmentId) {
      await failScoring(
        db,
        job.data.assessmentId,
        job.data.generation ?? 0,
        job.attemptsMade,
        job.attemptsMade >= (job.opts.attempts ?? 1),
        error,
      );
      return;
    }
    if (job.data.extractionId) {
      await failExtraction(
        db,
        {
          extractionId: job.data.extractionId,
          generation: job.data.generation ?? 0,
        },
        job.attemptsMade,
        job.attemptsMade >= (job.opts.attempts ?? 1),
        error,
      );
      return;
    }
    if (!job.data.runId) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    await db
      .update(growth.researchRuns)
      .set({
        status: final ? 'failed' : 'queued',
        error: error.message.slice(0, 1000),
        completedAt: final ? new Date() : null,
      })
      .where(eq(growth.researchRuns.id, job.data.runId));
    await event(job.data.runId, final ? '研究未完成' : '连接中断，准备重试');
  })().catch((err: unknown) =>
    console.error('Failed to save job failure', err),
  );
});
let reconciling = false;
let nextBriefCheck = 0;
async function reconcile() {
  if (reconciling) return;
  reconciling = true;
  try {
    if (Date.now() >= nextBriefCheck) {
      nextBriefCheck = Date.now() + 60000;
      await generateDailyBriefs(db).catch((error: unknown) =>
        console.error(
          'Daily brief generation failed',
          error instanceof Error ? error.name : 'UnknownError',
        ),
      );
    }
    await reconcileCollection(db, queue).catch((error: unknown) =>
      console.error(
        'Collection reconciliation failed',
        error instanceof Error ? error.name : 'UnknownError',
      ),
    );
    const conversationTurns = await db
      .select()
      .from(researchConversations.conversationTurns)
      .where(
        inArray(researchConversations.conversationTurns.status, [
          'queued',
          'running',
        ]),
      )
      .limit(100);
    for (const turn of conversationTurns) {
      const jobId = `conversation-${turn.id}-${turn.generation}`;
      if (!(await queue.getJob(jobId)))
        await queue.add(
          'conversation',
          { conversationTurnId: turn.id, generation: turn.generation },
          { jobId },
        );
    }
    for (const profile of await dueCompetitors(db))
      await requestCompetitorResearch(db, profile.id, profile.createdBy, true);
    const competitorRuns = await db
      .select()
      .from(competitorResearch.competitorResearchRuns)
      .where(
        inArray(competitorResearch.competitorResearchRuns.status, [
          'queued',
          'running',
        ]),
      )
      .limit(100);
    for (const run of competitorRuns) {
      const jobId = `competitor-${run.id}-${run.generation}`;
      if (!(await queue.getJob(jobId)))
        await queue.add(
          'research-competitor',
          { competitorRunId: run.id, generation: run.generation },
          { jobId },
        );
    }
    for (const watch of await dueWatches(db))
      await requestWatchSnapshot(db, watch.id, watch.createdBy, true);
    const snapshots = await db
      .select()
      .from(marketWatch.competitorSnapshots)
      .where(
        and(
          eq(marketWatch.competitorSnapshots.method, 'web'),
          inArray(marketWatch.competitorSnapshots.status, [
            'queued',
            'running',
          ]),
        ),
      )
      .limit(100);
    for (const snapshot of snapshots) {
      const jobId = `watch-${snapshot.id}`;
      if (!(await queue.getJob(jobId)))
        await queue.add(
          'collect-competitor',
          { snapshotId: snapshot.id },
          { jobId },
        );
    }
    const pending = await db
      .select()
      .from(growth.researchRuns)
      .where(and(eq(growth.researchRuns.status, 'queued')))
      .limit(100);
    for (const run of pending) {
      if (run.queueJobId) continue;
      const job = await queue.getJob(run.id);
      if (!job)
        await queue.add('research', { runId: run.id }, { jobId: run.id });
    }
    const stages = await db
      .select()
      .from(growth.researchExtractions)
      .where(inArray(growth.researchExtractions.status, ['queued', 'running']))
      .limit(100);
    for (const stage of stages) {
      const jobId = extractionJobId(stage.id, stage.generation);
      if (!(await queue.getJob(jobId)))
        await queue.add(
          'extract-candidates',
          { extractionId: stage.id, generation: stage.generation },
          { jobId },
        );
    }
    const assessments = await db
      .select()
      .from(growth.opportunityAssessments)
      .where(
        inArray(growth.opportunityAssessments.status, ['queued', 'running']),
      )
      .limit(100);
    for (const row of assessments) {
      const jobId = scoringJobId(row.id, row.generation);
      if (!(await queue.getJob(jobId)))
        await queue.add(
          'score-opportunity',
          { assessmentId: row.id, generation: row.generation },
          { jobId },
        );
    }
    const schedules = await db.select().from(growth.researchSchedules);
    for (const schedule of schedules) {
      if (!schedule.enabled) {
        await queue.removeJobScheduler(schedule.id);
        continue;
      }
      await queue.upsertJobScheduler(
        schedule.id,
        {
          pattern: `${schedule.minute} ${schedule.hour} * * *`,
          tz: schedule.timezone,
        },
        {
          name: 'scheduled-research',
          data: { scheduleId: schedule.id },
          opts: { attempts: 2, backoff: { type: 'exponential', delay: 5000 } },
        },
      );
    }
    // If Redis was restored without jobs, recover running manual jobs as well.
    const running = await db
      .select()
      .from(growth.researchRuns)
      .where(inArray(growth.researchRuns.status, ['running']))
      .limit(100);
    for (const run of running)
      if (!run.queueJobId && !(await queue.getJob(run.id)))
        await queue.add('research', { runId: run.id }, { jobId: run.id });
  } finally {
    reconciling = false;
  }
}
const timer = setInterval(() => {
  void reconcile().catch((error: unknown) =>
    console.error('Reconciliation:', error),
  );
}, 15000);
void reconcile().catch((error: unknown) =>
  console.error('Initial reconciliation:', error),
);
console.log('Guangmo research worker started.');
async function shutdown() {
  clearInterval(timer);
  await worker.close();
  await queue.close();
  connection.disconnect();
  queueConnection.disconnect();
  await pool.end();
}
process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});
