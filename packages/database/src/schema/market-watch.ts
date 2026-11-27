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
  DramaInput,
  ObservationInput,
  PriceObservation,
} from '@guangmo/contracts';
import { products } from './products.js';
import { user } from './auth.js';
import { intelligence } from './growth.js';
export const competitorWatches = pgTable(
  'competitor_watches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    product: text('product')
      .notNull()
      .references(() => products.id),
    name: text('name').notNull(),
    market: text('market').notNull(),
    kind: text('kind').notNull(),
    url: text('url').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
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
    uniqueIndex('watch_product_url_kind').on(t.product, t.canonicalUrl, t.kind),
    index('watch_due_idx').on(t.enabled, t.nextRunAt),
  ],
);
export const competitorSnapshots = pgTable(
  'competitor_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    watchId: uuid('watch_id')
      .notNull()
      .references(() => competitorWatches.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    content: text('content'),
    previousContent: text('previous_content'),
    price: jsonb('price').$type<PriceObservation>(),
    previousPrice: jsonb('previous_price').$type<PriceObservation>(),
    change: text('change').notNull().default('unknown'),
    claimType: text('claim_type').notNull().default('fact'),
    method: text('method').notNull().default('web'),
    note: text('note').notNull().default(''),
    error: text('error'),
    sourceUrl: text('source_url').notNull(),
    intelligenceId: uuid('intelligence_id').references(() => intelligence.id, {
      onDelete: 'set null',
    }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('snapshot_watch_time_idx').on(t.watchId, t.createdAt),
    index('snapshot_status_idx').on(t.status),
  ],
);
export const dramas = pgTable(
  'dramas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    product: text('product')
      .notNull()
      .references(() => products.id),
    title: text('title').notNull(),
    platform: text('platform').notNull(),
    market: text('market').notNull(),
    data: jsonb('data').$type<DramaInput>().notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    revision: integer('revision').notNull().default(0),
    intelligenceId: uuid('intelligence_id').references(() => intelligence.id, {
      onDelete: 'set null',
    }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('drama_product_source').on(t.product, t.canonicalUrl, t.title),
    index('drama_product_time').on(t.product, t.createdAt),
  ],
);
export const dramaObservations = pgTable(
  'drama_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dramaId: uuid('drama_id')
      .notNull()
      .references(() => dramas.id, { onDelete: 'cascade' }),
    data: jsonb('data').$type<ObservationInput>().notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('drama_observation_idx').on(t.dramaId, t.createdAt)],
);
