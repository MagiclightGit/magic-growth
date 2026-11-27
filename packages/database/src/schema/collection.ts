import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { CollectionRunStatus } from '@guangmo/contracts';
import { user } from './auth.js';
import { products } from './products.js';

export const feedSources = pgTable(
  'feed_sources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    product: text('product')
      .notNull()
      .references(() => products.id),
    market: text('market').notNull(),
    vertical: text('vertical').notNull(),
    category: text('category').notNull(),
    intervalHours: integer('interval_hours').notNull(),
    permissionNote: text('permission_note').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    revision: integer('revision').notNull().default(0),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    nextRunAt: timestamp('next_run_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('feed_source_url_product').on(t.product, t.canonicalUrl),
    index('feed_source_due')
      .on(t.nextRunAt)
      .where(sql`${t.enabled} = true`),
  ],
);

export const collectionRuns = pgTable(
  'collection_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => feedSources.id),
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id),
    scheduled: boolean('scheduled').notNull(),
    status: text('status')
      .$type<CollectionRunStatus>()
      .default('queued')
      .notNull(),
    attempts: integer('attempts').default(0).notNull(),
    discovered: integer('discovered'),
    added: integer('added'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('collection_source_history').on(t.sourceId, t.createdAt),
    uniqueIndex('collection_one_active_run')
      .on(t.sourceId)
      .where(sql`${t.status} in ('queued','running')`),
  ],
);
