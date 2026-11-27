import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type {
  CsvRow,
  OutreachMailbox,
  OutreachStatus,
} from '@guangmo/contracts';
import { products } from './products.js';

const time = (name: string) => timestamp(name, { withTimezone: true });
export const batches = pgTable(
  'outreach_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    product: text('product')
      .notNull()
      .references(() => products.id),
    filename: text('filename').notNull(),
    actorId: text('actor_id').notNull(),
    rows: jsonb('rows').$type<CsvRow[]>().notNull(),
    createdAt: time('created_at').notNull().defaultNow(),
  },
  (t) => [index('outreach_batch_product_idx').on(t.product, t.createdAt)],
);

export const creators = pgTable(
  'outreach_creators',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    product: text('product')
      .notNull()
      .references(() => products.id),
    link: text('link').notNull(),
    normalizedLink: text('normalized_link').notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    actorId: text('actor_id').notNull(),
    batchId: uuid('batch_id').references(() => batches.id),
    createdAt: time('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('outreach_creator_link_unique').on(t.product, t.normalizedLink),
    index('outreach_creator_product_idx').on(t.product, t.createdAt),
  ],
);

export const mailboxes = pgTable('outreach_mailboxes', {
  address: text('address').primaryKey(),
  status: text('status')
    .$type<OutreachMailbox['status']>()
    .notNull()
    .default('pending'),
  paused: boolean('paused').notNull().default(false),
  error: text('error'),
  checkedAt: time('checked_at'),
});

export const messages = pgTable(
  'outreach_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    product: text('product')
      .notNull()
      .references(() => products.id),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    actorId: text('actor_id').notNull(),
    key: uuid('request_key'),
    parentId: uuid('parent_id').references((): AnyPgColumn => messages.id),
    mailbox: text('mailbox').notNull(),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: text('status').$type<OutreachStatus>().notNull().default('queued'),
    error: text('error'),
    sendAt: time('send_at').notNull().defaultNow(),
    attemptedAt: time('attempted_at'),
    checkedAt: time('checked_at'),
    retryApproved: boolean('retry_approved').notNull().default(false),
    gmailId: text('gmail_id'),
    threadId: text('thread_id'),
    messageId: text('message_id'),
    sentAt: time('sent_at'),
    syncedAt: time('synced_at'),
    createdAt: time('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('outreach_message_request_unique').on(t.product, t.actorId, t.key),
    unique('outreach_message_followup_unique').on(t.parentId),
    unique('outreach_gmail_message_unique').on(t.mailbox, t.gmailId),
    index('outreach_message_creator_idx').on(
      t.product,
      t.creatorId,
      t.createdAt,
    ),
    index('outreach_message_queue_idx').on(t.mailbox, t.status, t.sendAt),
    index('outreach_message_thread_sync_idx')
      .on(t.mailbox, t.syncedAt)
      .where(sql`${t.parentId} is null and ${t.threadId} is not null`),
    index('outreach_message_recipient_idx').on(t.mailbox, t.recipient),
  ],
);

export const replies = pgTable(
  'outreach_replies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    rootId: uuid('root_id')
      .notNull()
      .references(() => messages.id),
    gmailId: text('gmail_id').notNull(),
    sender: text('sender').notNull(),
    body: text('body').notNull(),
    receivedAt: time('received_at').notNull(),
  },
  (t) => [unique('outreach_reply_unique').on(t.rootId, t.gmailId)],
);

export const unsubscribes = pgTable(
  'outreach_unsubscribes',
  {
    mailbox: text('mailbox').notNull(),
    recipient: text('recipient').notNull(),
    createdAt: time('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.mailbox, t.recipient] })],
);
