import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  CompetitorFinding,
  ResearchEventData,
  CompetitorProfileInput,
} from '@guangmo/contracts';
import { products } from './products.js';
import { user } from './auth.js';
import { intelligence } from './growth.js';
export const competitorProfiles = pgTable(
  'competitor_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    product: text('product')
      .notNull()
      .references(() => products.id),
    name: text('name').notNull(),
    website: text('website').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    market: text('market').notNull(),
    relationship: text('relationship')
      .$type<NonNullable<CompetitorProfileInput['relationship']>>()
      .notNull()
      .default('unclassified'),
    focus: text('focus').notNull().default(''),
    sources: jsonb('sources').$type<string[]>().notNull().default([]),
    intervalHours: integer('interval_hours').notNull().default(24),
    enabled: boolean('enabled').notNull().default(true),
    revision: integer('revision').notNull().default(0),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    nextRunAt: timestamp('next_run_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('competitor_product_website').on(t.product, t.canonicalUrl),
    index('competitor_due').on(t.enabled, t.nextRunAt),
  ],
);
export const competitorResearchRuns = pgTable(
  'competitor_research_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    competitorId: uuid('competitor_id')
      .notNull()
      .references(() => competitorProfiles.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('queued'),
    stage: text('stage').notNull().default('research'),
    attempts: integer('attempts').notNull().default(0),
    generation: integer('generation').notNull().default(0),
    config: jsonb('config').$type<CompetitorProfileInput>().notNull(),
    report: text('report'),
    findings: jsonb('findings').$type<CompetitorFinding[]>(),
    previousRunId: uuid('previous_run_id'),
    error: text('error'),
    model: text('model'),
    workflowVersion: text('workflow_version')
      .notNull()
      .default('competitor-research/v1'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('competitor_run_history').on(t.competitorId, t.createdAt),
    index('competitor_run_pending').on(t.status),
  ],
);
export const competitorResearchEvents = pgTable(
  'competitor_research_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => competitorResearchRuns.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    data: jsonb('data').$type<ResearchEventData>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('competitor_events_run').on(t.runId, t.createdAt)],
);
export const competitorResearchPublications = pgTable(
  'competitor_research_publications',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => competitorResearchRuns.id, { onDelete: 'cascade' }),
    dimension: text('dimension').notNull(),
    intelligenceId: uuid('intelligence_id')
      .notNull()
      .references(() => intelligence.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('competitor_publication_once').on(t.runId, t.dimension)],
);
