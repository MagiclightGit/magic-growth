import { collectionRuns } from './collection.js';
import { products } from './products.js';
import { sql } from 'drizzle-orm';
import type { ResearchEventData } from '@guangmo/contracts';
import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
export const intelligence = pgTable(
  'intelligence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    sourceUrl: text('source_url').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    ownerId: text('owner_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    ownerRevision: integer('owner_revision').notNull().default(0),
    metadata:
      jsonb('metadata').$type<
        Pick<
          import('@guangmo/contracts').CandidateInput,
          | 'vertical'
          | 'claimType'
          | 'publishedAt'
          | 'language'
          | 'tags'
          | 'suggestedAction'
          | 'eventStartsAt'
          | 'eventEndsAt'
          | 'sourceTimes'
        >
      >(),
    category: text('category').notNull(),
    product: text('product')
      .notNull()
      .references(() => products.id),
    market: text('market').notNull(),
    status: text('status').notNull().default('pending'),
    createdBy: text('created_by').references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('intelligence_source_unique').on(t.canonicalUrl, t.product),
    index('intelligence_created_idx').on(t.createdAt),
    index('intelligence_owner_idx').on(t.ownerId),
  ],
);
export const researchRuns = pgTable(
  'research_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    product: text('product').references(() => products.id),
    queueJobId: text('queue_job_id').unique(),
    goal: text('goal').notNull(),
    status: text('status').notNull().default('queued'),
    result: text('result'),
    error: text('error'),
    createdBy: text('created_by').references(() => user.id),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('research_runs_status_idx').on(t.status)],
);
export const runEvents = pgTable(
  'run_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => researchRuns.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    data: jsonb('data').$type<ResearchEventData>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('run_events_run_idx').on(t.runId)],
);
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: text('actor_id').references(() => user.id),
  action: text('action').notNull(),
  objectId: text('object_id').notNull(),
  details: jsonb('details'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const researchSchedules = pgTable('research_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  product: text('product').references(() => products.id),
  goal: text('goal').notNull(),
  hour: integer('hour').notNull(),
  minute: integer('minute').notNull(),
  timezone: text('timezone').notNull().default('Asia/Shanghai'),
  enabled: boolean('enabled').notNull().default(true),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Versioned extraction is a durable checkpoint separate from the research report.
export const researchExtractions = pgTable(
  'research_extractions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .unique()
      .references(() => researchRuns.id, { onDelete: 'cascade' }),
    workflowVersion: text('workflow_version').notNull(),
    status: text('status').notNull().default('queued'),
    generation: integer('generation').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('extraction_status_idx').on(t.status)],
);
export const intelligenceCandidates = pgTable(
  'intelligence_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    extractionId: uuid('extraction_id').references(
      () => researchExtractions.id,
      { onDelete: 'cascade' },
    ),
    runId: uuid('run_id').references(() => researchRuns.id, {
      onDelete: 'cascade',
    }),
    position: integer('position').notNull().default(0),
    payload: jsonb('payload')
      .$type<import('@guangmo/contracts').CandidateInput>()
      .notNull(),
    status: text('status').notNull().default('pending'),
    intelligenceId: uuid('intelligence_id').references(() => intelligence.id),
    revision: integer('revision').notNull().default(0),
    reviewedBy: text('reviewed_by').references(() => user.id),
    reviewReason: text('review_reason'),
    manualSourceKey: text('manual_source_key'),
    collectionRunId: uuid('collection_run_id').references(
      () => collectionRuns.id,
    ),
    feedItemKey: text('feed_item_key'),
    originKey: text('origin_key').unique(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('candidate_extraction_position').on(t.extractionId, t.position),
    index('candidate_status_idx').on(t.status),
    uniqueIndex('candidate_feed_item_unique').on(
      sql`(${t.payload}->>'product')`,
      t.feedItemKey,
    ),
    uniqueIndex('candidate_manual_source_unique').on(
      sql`(${t.payload}->>'product')`,
      t.manualSourceKey,
    ),
    check(
      'candidate_research_origin',
      sql`(${t.runId} IS NULL) = (${t.extractionId} IS NULL)`,
    ),
  ],
);
export const intelligenceEvidence = pgTable(
  'intelligence_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    intelligenceId: uuid('intelligence_id')
      .notNull()
      .references(() => intelligence.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => researchRuns.id, {
      onDelete: 'set null',
    }),
    url: text('url').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    title: text('title').notNull(),
    evidence: text('evidence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('evidence_item_url').on(t.intelligenceId, t.canonicalUrl),
  ],
);
export const workflowTasks = pgTable(
  'workflow_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    intelligenceId: uuid('intelligence_id')
      .notNull()
      .references(() => intelligence.id),
    title: text('title').notNull(),
    kind: text('kind').notNull(),
    channel: text('channel').notNull(),
    assigneeId: text('assignee_id')
      .notNull()
      .references(() => user.id),
    product: text('product')
      .notNull()
      .references(() => products.id),
    market: text('market').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    priority: text('priority').notNull(),
    status: text('status').notNull().default('pending'),
    result: text('result'),
    brief: text('brief'),
    revision: integer('revision').notNull().default(0),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('task_item_kind').on(t.intelligenceId, t.kind),
    index('task_status_idx').on(t.status),
  ],
);

export const opportunityAssessments = pgTable(
  'opportunity_assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: uuid('candidate_id').references(
      () => intelligenceCandidates.id,
      { onDelete: 'cascade' },
    ),
    intelligenceId: uuid('intelligence_id').references(() => intelligence.id, {
      onDelete: 'cascade',
    }),
    version: text('version').notNull(),
    fingerprint: text('fingerprint').notNull(),
    input: jsonb('input')
      .$type<import('@guangmo/contracts').ScoreInput>()
      .notNull(),
    proposal:
      jsonb('proposal').$type<import('@guangmo/contracts').ScoreProposal>(),
    status: text('status').notNull().default('queued'),
    generation: integer('generation').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    model: text('model'),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'assessment_one_target',
      sql`(${t.candidateId} IS NOT NULL)::int + (${t.intelligenceId} IS NOT NULL)::int = 1`,
    ),
    uniqueIndex('assessment_candidate_input').on(t.candidateId, t.fingerprint),
    uniqueIndex('assessment_intelligence_input').on(
      t.intelligenceId,
      t.fingerprint,
    ),
    index('assessment_status_idx').on(t.status),
  ],
);
