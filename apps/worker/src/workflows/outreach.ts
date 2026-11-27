import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import {
  auth,
  canAccessProduct,
  catalog,
  outreach,
  type Database,
} from '@guangmo/database';
import { gmailPilotConfig } from '@guangmo/contracts';
import {
  Gmail,
  GmailError,
  gmailRaw,
  googleToken,
  header,
  isUnsubscribe,
  replyAddress,
  type GmailMessage,
} from './gmail.js';

const { mailboxes, messages, replies, unsubscribes } = outreach;
const config = gmailPilotConfig(process.env);
type Mail = typeof messages.$inferSelect;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function reconcileOutreach(db: Database) {
  const { address, recipients } = config;
  if (!address) return;
  await db.transaction(async (lock) => {
    // A transaction-scoped advisory lock elects one executor across Worker processes.
    // Outbox transitions commit separately before and after the external send.
    const { rows } = await lock.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${'gmail-pilot:' + address}, 0)) as acquired`,
    );
    if (!rows[0]?.acquired) return;

    const updateMailbox = async (
      status: typeof mailboxes.$inferSelect.status,
      error: string | null,
    ) => {
      const state = { status, error, checkedAt: new Date() };
      await db
        .insert(mailboxes)
        .values({ address, ...state })
        .onConflictDoUpdate({ target: mailboxes.address, set: state });
    };
    const {
      GMAIL_PILOT_CLIENT_ID,
      GMAIL_PILOT_CLIENT_SECRET,
      GMAIL_PILOT_REFRESH_TOKEN,
    } = process.env;
    if (
      !recipients.length ||
      !GMAIL_PILOT_CLIENT_ID ||
      !GMAIL_PILOT_CLIENT_SECRET ||
      !GMAIL_PILOT_REFRESH_TOKEN
    ) {
      await updateMailbox(
        'unconfigured',
        '请联系管理员配置受控收件地址及 Gmail OAuth 授权',
      );
      return;
    }
    try {
      const gmail = new Gmail(
        await googleToken(
          GMAIL_PILOT_CLIENT_ID,
          GMAIL_PILOT_CLIENT_SECRET,
          GMAIL_PILOT_REFRESH_TOKEN,
        ),
      );
      if ((await gmail.address()) !== address) {
        await updateMailbox(
          'failed',
          'Gmail 授权账号与试接邮箱地址不一致，请重新授权',
        );
        return;
      }
      await updateMailbox('connected', null);
      // A crashed process may have left a committed send intent without a Gmail response.
      await db.transaction(async (tx) => {
        await tx
          .select({ address: mailboxes.address })
          .from(mailboxes)
          .where(eq(mailboxes.address, address))
          .for('update');
        await tx
          .update(messages)
          .set({
            status: 'uncertain',
            error: '发送结果未知，等待核对 Gmail 已发送邮件',
          })
          .where(
            and(eq(messages.mailbox, address), eq(messages.status, 'sending')),
          );
      });
      await reconcileUnknown(db, gmail, address);
      await pollReplies(db, gmail, address);
      const [mailbox] = await db
        .select()
        .from(mailboxes)
        .where(eq(mailboxes.address, address));
      if (mailbox?.paused) return;
      const [job] = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.mailbox, address),
            lte(messages.sendAt, new Date()),
            or(
              eq(messages.status, 'queued'),
              and(
                or(
                  eq(messages.status, 'failed'),
                  and(
                    eq(messages.status, 'uncertain'),
                    isNotNull(messages.checkedAt),
                  ),
                ),
                eq(messages.retryApproved, true),
              ),
            ),
          ),
        )
        .orderBy(asc(messages.sendAt), asc(messages.id))
        .limit(1);
      if (job) await dispatch(db, gmail, job);
    } catch (error) {
      await updateMailbox(
        'failed',
        error instanceof GmailError
          ? error.message
          : 'Gmail 同步未完成，后台将继续检查。持续失败时请检查网络及 Worker',
      );
    }
  });
}

function messageIdFor(job: Mail) {
  return `<${job.id}@${job.mailbox.split('@')[1]}>`;
}

async function recordSent(
  db: Pick<Database, 'update'>,
  job: Mail,
  result: GmailMessage,
) {
  const messageId = header(result, 'message-id');
  await db
    .update(messages)
    .set({
      status: 'sent',
      gmailId: result.id,
      threadId: result.threadId,
      messageId: /^<[^<>\s]+@[^<>\s]+>$/.test(messageId)
        ? messageId
        : messageIdFor(job),
      sentAt: result.internalDate ? new Date(result.internalDate) : new Date(),
      error: null,
      retryApproved: false,
    })
    .where(eq(messages.id, job.id));
}

async function reconcileUnknown(db: Database, gmail: Gmail, address: string) {
  const pending = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.mailbox, address),
        eq(messages.status, 'uncertain'),
        or(
          isNull(messages.checkedAt),
          lte(messages.checkedAt, new Date(Date.now() - 60000)),
        ),
      ),
    )
    .orderBy(
      sql`${messages.checkedAt} asc nulls first`,
      asc(messages.attemptedAt),
    )
    .limit(4);
  for (const job of pending) {
    const match = await gmail.findSent(messageIdFor(job));
    if (match) {
      await recordSent(db, job, match);
      continue;
    }
    const checkedAt = new Date();
    const settled =
      checkedAt.getTime() - (job.attemptedAt?.getTime() ?? Date.now()) >=
      120000;
    await db
      .update(messages)
      .set({
        checkedAt,
        error: settled
          ? 'Gmail 已发送邮件中未找到。管理员核对邮箱后可确认重试'
          : '等待 Gmail 发送记录可查询，后台会继续核对',
      })
      .where(eq(messages.id, job.id));
  }
}

async function pollReplies(db: Database, gmail: Gmail, address: string) {
  const roots = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.mailbox, address),
        isNull(messages.parentId),
        isNotNull(messages.threadId),
        or(
          isNull(messages.syncedAt),
          lte(messages.syncedAt, new Date(Date.now() - 30000)),
        ),
      ),
    )
    .orderBy(sql`${messages.syncedAt} asc nulls first`, asc(messages.createdAt))
    .limit(6);
  for (const root of roots) {
    try {
      await syncThread(db, gmail, root);
    } catch (error) {
      // A missing thread should neither starve the other threads nor clear prior replies.
      if (!(error instanceof GmailError) || error.status !== 404) throw error;
      await db
        .update(messages)
        .set({
          syncedAt: new Date(),
          error: 'Gmail 线程不可访问，请检查邮箱中的原信',
        })
        .where(eq(messages.id, root.id));
    }
  }
}

async function syncThread(db: Database, gmail: Gmail, root: Mail) {
  const thread = await gmail.thread(root.threadId!);
  const original = thread.find((message) => message.id === root.gmailId);
  if (!original) throw new GmailError(404, 'Gmail 线程中找不到原信');
  const candidates = thread
    .slice(thread.indexOf(original) + 1)
    .filter(
      (message) =>
        !message.labelIds.includes('SENT') &&
        !message.labelIds.includes('DRAFT') &&
        replyAddress(header(message, 'from')) === root.recipient,
    );
  const received = candidates.map((message) => ({
    rootId: root.id,
    gmailId: message.id,
    sender: root.recipient,
    body: message.snippet,
    receivedAt: new Date(message.internalDate ?? Date.now()),
  }));
  await db.transaction(async (tx) => {
    if (received.length) {
      await tx.insert(replies).values(received).onConflictDoNothing();
      await tx
        .update(messages)
        .set({
          status: 'stopped',
          error: '原线程已收到回复',
          retryApproved: false,
        })
        .where(
          and(
            eq(messages.parentId, root.id),
            inArray(messages.status, ['queued', 'failed']),
          ),
        );
    }
    if (received.some((message) => isUnsubscribe(message.body)))
      await tx
        .insert(unsubscribes)
        .values({ mailbox: root.mailbox, recipient: root.recipient })
        .onConflictDoNothing();
    await tx
      .update(messages)
      .set({ syncedAt: new Date(), error: null })
      .where(eq(messages.id, root.id));
  });
  return original;
}

async function hasWriteAccess(
  tx: Transaction,
  actorId: string,
  product: string,
) {
  const [actor] = await tx
    .select()
    .from(auth.user)
    .where(eq(auth.user.id, actorId))
    .for('share');
  if (!actor || !['admin', 'operator'].includes(actor.role)) return false;
  await tx
    .select({ id: catalog.products.id })
    .from(catalog.products)
    .where(eq(catalog.products.id, product))
    .for('share');
  return canAccessProduct(tx, actorId, product, true);
}

async function dispatch(db: Database, gmail: Gmail, job: Mail) {
  if (job.status === 'uncertain') {
    const match = await gmail.findSent(messageIdFor(job));
    if (match) {
      await recordSent(db, job, match);
      return;
    }
  }
  const isRecipientAllowed = config.recipients.includes(job.recipient);
  let parent: Mail | undefined;
  let parentMessageId: string | undefined;
  if (isRecipientAllowed) {
    // Poll every tracked thread for this recipient immediately before a potential send.
    const roots = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.mailbox, job.mailbox),
          eq(messages.recipient, job.recipient),
          isNull(messages.parentId),
          isNotNull(messages.threadId),
        ),
      );
    for (const root of roots) {
      if (root.id === job.parentId) parent = root;
      try {
        const original = await syncThread(db, gmail, root);
        if (root.id === job.parentId)
          parentMessageId = header(original, 'message-id');
      } catch (error) {
        if (!(error instanceof GmailError) || error.status !== 404) throw error;
      }
    }
  }

  const claimed = await db
    .update(messages)
    .set({
      status: 'sending',
      attemptedAt: new Date(),
      checkedAt: null,
      retryApproved: false,
      error: null,
    })
    .where(and(eq(messages.id, job.id), eq(messages.status, job.status)))
    .returning({ id: messages.id });
  if (!claimed.length) return;

  const providerError = await db.transaction(async (tx) => {
    const [mailbox] = await tx
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.address, job.mailbox))
      .for('update');
    const [intent] = await tx
      .select({ status: messages.status })
      .from(messages)
      .where(eq(messages.id, job.id))
      .for('update');
    if (intent?.status !== 'sending') return;
    const update = (status: Mail['status'], error: string) =>
      tx
        .update(messages)
        .set({ status, error, retryApproved: false })
        .where(eq(messages.id, job.id));
    if (mailbox?.paused) {
      await tx
        .update(messages)
        .set({
          status: job.status,
          error: job.error,
          retryApproved: job.retryApproved,
          attemptedAt: job.attemptedAt,
          checkedAt: job.checkedAt,
        })
        .where(eq(messages.id, job.id));
      return;
    }
    if (
      !isRecipientAllowed ||
      !(await hasWriteAccess(tx, job.actorId, job.product)) ||
      (parent &&
        parent.actorId !== job.actorId &&
        !(await hasWriteAccess(tx, parent.actorId, parent.product)))
    ) {
      await update('stopped', '发信权限已撤回、产品已归档或收件地址已移除');
      return;
    }
    const [optOut] = await tx
      .select()
      .from(unsubscribes)
      .where(
        and(
          eq(unsubscribes.mailbox, job.mailbox),
          eq(unsubscribes.recipient, job.recipient),
        ),
      );
    if (optOut) {
      await update('stopped', '此联系人已在试接邮箱退订');
      return;
    }
    if (job.parentId) {
      const [reply] = await tx
        .select({ id: replies.id })
        .from(replies)
        .where(eq(replies.rootId, job.parentId))
        .limit(1);
      if (reply) {
        await update('stopped', '原线程已收到回复');
        return;
      }
      if (
        !parent ||
        !parentMessageId ||
        !/^<[^<>\s]+@[^<>\s]+>$/.test(parentMessageId)
      ) {
        await update(
          'failed',
          '无法确认原信的 Gmail 线程或 Message-ID，请检查邮箱后重试',
        );
        return;
      }
    }
    try {
      const result = await gmail.send(
        gmailRaw(job, messageIdFor(job), parentMessageId),
        parent?.threadId ?? undefined,
      );
      await recordSent(tx, job, result);
    } catch (error) {
      if (
        error instanceof GmailError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408
      ) {
        const retryable = [401, 429].includes(error.status);
        await update(retryable ? 'queued' : 'failed', error.message);
        return error;
      } else {
        await update('uncertain', '发送结果未知，等待核对 Gmail 已发送邮件');
      }
    }
  });
  if (providerError) throw providerError;
}
