import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  ConversationContext,
  ResearchEventData,
} from '@guangmo/contracts';
import { products } from './products.js';
import { user } from './auth.js';
export const conversations = pgTable(
  'research_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id),
    product: text('product')
      .notNull()
      .references(() => products.id),
    sourceKind: text('source_kind').notNull(),
    sourceId: uuid('source_id').notNull(),
    requestId: uuid('request_id').notNull(),
    title: text('title').notNull(),
    context: jsonb('context').$type<ConversationContext>().notNull(),
    memory: jsonb('memory').$type<{ text: string; throughSequence: number }>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('conversation_create_once').on(t.ownerId, t.requestId),
    index('conversation_owner_source').on(t.ownerId, t.sourceKind, t.sourceId),
  ],
);
export const conversationTurns = pgTable(
  'research_conversation_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id').notNull(),
    sequence: integer('sequence').notNull(),
    question: text('question').notNull(),
    mode: text('mode').notNull(),
    status: text('status').notNull().default('queued'),
    answer: text('answer'),
    error: text('error'),
    generation: integer('generation').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('conversation_turn_once').on(t.conversationId, t.requestId),
    uniqueIndex('conversation_turn_order').on(t.conversationId, t.sequence),
    index('conversation_turn_pending').on(t.status),
  ],
);
export const conversationEvents = pgTable(
  'research_conversation_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    turnId: uuid('turn_id')
      .notNull()
      .references(() => conversationTurns.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    data: jsonb('data').$type<ResearchEventData>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('conversation_events_turn').on(t.turnId, t.createdAt)],
);
// Sharing copies only the selected result; it never exposes the private thread.
export const sharedSupplements = pgTable(
  'research_shared_supplements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    turnId: uuid('turn_id')
      .notNull()
      .references(() => conversationTurns.id),
    product: text('product')
      .notNull()
      .references(() => products.id),
    sourceKind: text('source_kind').notNull(),
    sourceId: uuid('source_id').notNull(),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id),
    sources: jsonb('sources')
      .$type<{ url: string; title?: string }[]>()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('conversation_share_once').on(t.turnId),
    index('supplement_source').on(t.sourceKind, t.sourceId),
  ],
);
