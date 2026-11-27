import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import {
  calculateScore,
  SCORING_VERSION,
  scoreContext,
  scoreWindowEnded,
  type OpportunityScore,
  type ScoreContext,
  type ScoreInput,
  type ScoreSubject,
  type ScoreTarget,
} from '@guangmo/contracts';
import type { Database } from './index.js';
import * as growth from './schema/growth.js';

export async function scoreSubject(
  db: Database,
  type: ScoreTarget,
  id: string,
): Promise<ScoreSubject | null> {
  if (type === 'candidate') {
    const [row] = await db
      .select()
      .from(growth.intelligenceCandidates)
      .where(eq(growth.intelligenceCandidates.id, id));
    if (!row) return null;
    return {
      ...row.payload,
      suggestedAction: row.payload.suggestedAction,
      eventStartsAt: row.payload.eventStartsAt ?? null,
      eventEndsAt: row.payload.eventEndsAt ?? null,
      status: row.status,
    };
  }
  const [row] = await db
    .select()
    .from(growth.intelligence)
    .where(eq(growth.intelligence.id, id));
  if (!row) return null;
  const sources = await db
    .select()
    .from(growth.intelligenceEvidence)
    .where(eq(growth.intelligenceEvidence.intelligenceId, id))
    .orderBy(growth.intelligenceEvidence.canonicalUrl);
  return {
    title: row.title,
    summary: row.summary,
    product: row.product,
    market: row.market,
    category: row.category,
    status: row.status,
    suggestedAction: row.metadata?.suggestedAction ?? '',
    claimType: row.metadata?.claimType ?? null,
    sourceTimes: row.metadata?.sourceTimes,
    publishedAt: row.metadata?.publishedAt ?? null,
    eventStartsAt: row.metadata?.eventStartsAt ?? null,
    eventEndsAt: row.metadata?.eventEndsAt ?? null,
    sources: sources.map((s) => ({
      url: s.url,
      title: s.title,
      evidence: s.evidence,
    })),
  };
}
export function subjectFingerprint(subject: ScoreSubject) {
  // Select fields explicitly so transport-only metadata or property ordering cannot stale a score.
  return createHash('sha256')
    .update(
      JSON.stringify({
        title: subject.title,
        summary: subject.summary,
        product: subject.product,
        market: subject.market,
        category: subject.category,
        status: subject.status,
        suggestedAction: subject.suggestedAction,
        claimType: subject.claimType ?? null,
        sourceTimes: subject.sourceTimes ?? [],
        publishedAt: subject.publishedAt,
        eventStartsAt: subject.eventStartsAt,
        eventEndsAt: subject.eventEndsAt,
        sources: subject.sources
          .map((s) => ({ url: s.url, title: s.title, evidence: s.evidence }))
          .sort((a, b) => a.url.localeCompare(b.url)),
      }),
    )
    .digest('hex');
}
export async function requestScore(
  db: Database,
  type: ScoreTarget,
  id: string,
  actorId: string,
  context: ScoreContext = scoreContext.parse({}),
) {
  // Lock the target so concurrent clicks and background extraction cannot create duplicate assessments.
  return db.transaction(async (tx) => {
    const table =
      type === 'candidate'
        ? growth.intelligenceCandidates
        : growth.intelligence;
    const [target] = await tx
      .select({ id: table.id })
      .from(table)
      .where(eq(table.id, id))
      .for('update');
    if (!target) return null;
    const subject = await scoreSubject(tx as unknown as Database, type, id);
    if (!subject) return null;
    const history = await tx
      .select({
        title: growth.intelligence.title,
        summary: growth.intelligence.summary,
      })
      .from(growth.intelligence)
      .where(
        and(
          eq(growth.intelligence.product, subject.product),
          eq(growth.intelligence.market, subject.market),
          type === 'intelligence' ? ne(growth.intelligence.id, id) : undefined,
        ),
      )
      .orderBy(desc(growth.intelligence.createdAt))
      .limit(50);
    const input: ScoreInput = {
      subject,
      context,
      history,
      assessedAt: new Date().toISOString(),
    };
    // Bucket by UTC day to permit refreshed evidence assessment without overwriting historical snapshots.
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          subject: subjectFingerprint(subject),
          context,
          version: SCORING_VERSION,
          date: input.assessedAt.slice(0, 10),
        }),
      )
      .digest('hex');
    const targetColumn =
      type === 'candidate'
        ? growth.opportunityAssessments.candidateId
        : growth.opportunityAssessments.intelligenceId;
    const [existing] = await tx
      .select()
      .from(growth.opportunityAssessments)
      .where(
        and(
          eq(targetColumn, id),
          eq(growth.opportunityAssessments.fingerprint, fingerprint),
        ),
      );
    if (existing && existing.status !== 'failed') {
      const [reused] = await tx
        .update(growth.opportunityAssessments)
        .set({ requestedAt: new Date() })
        .where(eq(growth.opportunityAssessments.id, existing.id))
        .returning();
      return reused!;
    }
    const [row] = existing
      ? await tx
          .update(growth.opportunityAssessments)
          .set({
            status: 'queued',
            error: null,
            attempts: 0,
            completedAt: null,
            generation: existing.generation + 1,
            createdBy: actorId,
            input,
          })
          .where(eq(growth.opportunityAssessments.id, existing.id))
          .returning()
      : await tx
          .insert(growth.opportunityAssessments)
          .values({
            [type === 'candidate' ? 'candidateId' : 'intelligenceId']: id,
            version: SCORING_VERSION,
            fingerprint,
            input,
            createdBy: actorId,
          })
          .returning();
    await tx.insert(growth.auditLog).values({
      actorId,
      objectId: row!.id,
      action: 'scoring.requested',
      details: {
        type,
        targetId: id,
        version: SCORING_VERSION,
        generation: row!.generation,
      },
    });
    return row!;
  });
}
export function transportScore(
  row: typeof growth.opportunityAssessments.$inferSelect,
  subject: ScoreSubject,
): OpportunityScore {
  const due = row.completedAt
    ? new Date(
        row.completedAt.getTime() +
          (subject.category === 'competitor' ? 7 : 3) * 86400000,
      )
    : null;
  const proposal = row.status === 'succeeded' ? row.proposal : null;
  return {
    id: row.id,
    status: row.status as OpportunityScore['status'],
    version: row.version,
    context: row.input.context,
    proposal,
    calculation: proposal ? calculateScore(proposal.dimensions) : null,
    evaluatedAt: row.completedAt?.toISOString() ?? null,
    reviewDueAt: due?.toISOString() ?? null,
    stale:
      subjectFingerprint(subject) !== subjectFingerprint(row.input.subject) ||
      row.version !== SCORING_VERSION ||
      (!!due && due.getTime() < Date.now()),
    windowEnded: scoreWindowEnded(subject),
    excluded:
      ['irrelevant', 'rejected'].includes(subject.status) ||
      proposal?.dimensions.actionability.value === 0 ||
      proposal?.dimensions.timing.value === 0 ||
      proposal?.dimensions.novelty.value === 0,
    error: row.error,
  };
}
export async function attachScores<T extends { id: string }>(
  db: Database,
  type: ScoreTarget,
  rows: T[],
  subjects: ScoreSubject[],
) {
  if (!rows.length) return [];
  const column =
    type === 'candidate'
      ? growth.opportunityAssessments.candidateId
      : growth.opportunityAssessments.intelligenceId;
  const scores = await db
    .select()
    .from(growth.opportunityAssessments)
    .where(
      inArray(
        column,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(desc(growth.opportunityAssessments.requestedAt));
  const latest = new Map<string, (typeof scores)[number]>();
  for (const score of scores) {
    const id = type === 'candidate' ? score.candidateId : score.intelligenceId;
    if (id && !latest.has(id)) latest.set(id, score);
  }
  return rows.map((row, i) => ({
    ...row,
    scoring: latest.has(row.id)
      ? transportScore(latest.get(row.id)!, subjects[i]!)
      : null,
  }));
}
export async function attachIntelligenceScores<
  T extends typeof growth.intelligence.$inferSelect,
>(db: Database, rows: T[]) {
  if (!rows.length) return [];
  const evidence = await db
    .select()
    .from(growth.intelligenceEvidence)
    .where(
      inArray(
        growth.intelligenceEvidence.intelligenceId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(growth.intelligenceEvidence.canonicalUrl);
  const subjects = rows.map((row) => ({
    title: row.title,
    summary: row.summary,
    product: row.product,
    market: row.market,
    category: row.category,
    status: row.status,
    suggestedAction: row.metadata?.suggestedAction ?? '',
    claimType: row.metadata?.claimType ?? null,
    sourceTimes: row.metadata?.sourceTimes,
    publishedAt: row.metadata?.publishedAt ?? null,
    eventStartsAt: row.metadata?.eventStartsAt ?? null,
    eventEndsAt: row.metadata?.eventEndsAt ?? null,
    sources: evidence
      .filter((s) => s.intelligenceId === row.id)
      .map((s) => ({ url: s.url, title: s.title, evidence: s.evidence })),
  }));
  return attachScores(db, 'intelligence', rows, subjects);
}
