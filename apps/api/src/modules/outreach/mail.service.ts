import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, asc, eq, isNotNull, lt, or } from 'drizzle-orm';
import { outreach } from '@guangmo/database';
import {
  gmailPilotConfig,
  type OutreachMailbox,
  type outreachFollowupInput,
  type outreachSendInput,
} from '@guangmo/contracts';
import type { z } from 'zod';
import { DatabaseService } from '../../platform/database.module.js';

const { creators, mailboxes, messages, replies, unsubscribes } = outreach;
const config = gmailPilotConfig(process.env);

@Injectable()
export class MailService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async mailbox(showRecipients: boolean): Promise<OutreachMailbox> {
    const { address, recipients } = config;
    const [row] = address
      ? await this.database.db
          .select()
          .from(mailboxes)
          .where(eq(mailboxes.address, address))
      : [];
    const stale =
      row?.status === 'connected' &&
      (!row.checkedAt || Date.now() - row.checkedAt.getTime() > 120000);
    return {
      address,
      recipients: showRecipients ? recipients : [],
      paused: row?.paused ?? false,
      status:
        !address || !recipients.length
          ? 'unconfigured'
          : stale
            ? 'pending'
            : (row?.status ?? 'pending'),
      error: stale
        ? 'Worker 最近未完成 Gmail 检查，请检查后台服务'
        : (row?.error ?? null),
    };
  }

  async pause(paused: boolean) {
    const address = this.address();
    await this.database.db
      .insert(mailboxes)
      .values({ address, paused })
      .onConflictDoUpdate({ target: mailboxes.address, set: { paused } });
    return this.mailbox(true);
  }

  private address() {
    if (!config.address || !config.recipients.length)
      throw new ServiceUnavailableException(
        '请先配置 Gmail 试接邮箱和受控收件地址',
      );
    return config.address;
  }

  async list(product: string, creatorId: string) {
    const db = this.database.db;
    const [creator] = await db
      .select()
      .from(creators)
      .where(and(eq(creators.product, product), eq(creators.id, creatorId)));
    if (!creator) throw new NotFoundException('创作者记录不存在');
    const rows = await db
      .select()
      .from(messages)
      .where(
        and(eq(messages.product, product), eq(messages.creatorId, creatorId)),
      )
      .orderBy(asc(messages.createdAt));
    const messageReplies = await db
      .select({
        id: replies.id,
        rootId: replies.rootId,
        sender: replies.sender,
        body: replies.body,
        receivedAt: replies.receivedAt,
      })
      .from(replies)
      .innerJoin(messages, eq(replies.rootId, messages.id))
      .where(
        and(eq(messages.product, product), eq(messages.creatorId, creatorId)),
      )
      .orderBy(asc(replies.receivedAt));
    return {
      creator,
      messages: rows.map(
        ({
          id,
          creatorId,
          parentId,
          mailbox,
          recipient,
          subject,
          body,
          status,
          error,
          sendAt,
          gmailId,
          threadId,
          sentAt,
          checkedAt,
        }) => ({
          id,
          creatorId,
          parentId,
          mailbox,
          recipient,
          subject,
          body,
          status,
          error,
          sendAt,
          gmailId,
          threadId,
          sentAt,
          checkedAt,
        }),
      ),
      replies: messageReplies,
    };
  }

  async enqueue(
    product: string,
    actorId: string,
    input: z.infer<typeof outreachSendInput>,
  ) {
    const db = this.database.db;
    return db.transaction(async (tx) => {
      const condition = and(
        eq(messages.product, product),
        eq(messages.actorId, actorId),
        eq(messages.key, input.key),
      );
      const reuse = (existing: typeof messages.$inferSelect) => {
        if (
          existing.creatorId !== input.creatorId ||
          existing.recipient !== input.recipient ||
          existing.subject !== input.subject ||
          existing.body !== input.body
        )
          throw new ConflictException('此请求标识已用于另一封邮件');
        return { id: existing.id, status: existing.status };
      };
      const [existing] = await tx.select().from(messages).where(condition);
      if (existing) return reuse(existing);
      const mailbox = this.address();
      if (!config.recipients.includes(input.recipient))
        throw new ConflictException('收件地址未获准用于 Gmail 试接');
      const [creator] = await tx
        .select({ id: creators.id })
        .from(creators)
        .where(
          and(eq(creators.product, product), eq(creators.id, input.creatorId)),
        );
      if (!creator) throw new NotFoundException('创作者记录不存在');
      const [row] = await tx
        .insert(messages)
        .values({ ...input, product, actorId, mailbox })
        .onConflictDoNothing({
          target: [messages.product, messages.actorId, messages.key],
        })
        .returning({ id: messages.id, status: messages.status });
      if (row) return row;
      const [duplicate] = await tx.select().from(messages).where(condition);
      return reuse(duplicate!);
    });
  }

  async followup(
    product: string,
    id: string,
    actorId: string,
    input: z.infer<typeof outreachFollowupInput>,
  ) {
    const sendAt = new Date(input.sendAt);
    const db = this.database.db;
    const [root] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.product, product), eq(messages.id, id)));
    if (!root) throw new NotFoundException('邮件记录不存在');
    if (
      root.parentId ||
      root.status !== 'sent' ||
      !root.threadId ||
      !root.messageId ||
      root.mailbox !== this.address()
    )
      throw new ConflictException(
        '原信须已在当前试接邮箱发送，且有 Gmail 线程标识',
      );
    const [existing] = await db
      .select()
      .from(messages)
      .where(eq(messages.parentId, id));
    if (existing) return { id: existing.id };
    if (sendAt.getTime() <= Date.now())
      throw new ConflictException('跟进时间须晚于当前时间');
    const [row] = await db
      .insert(messages)
      .values({
        product,
        actorId,
        creatorId: root.creatorId,
        parentId: id,
        mailbox: root.mailbox,
        recipient: root.recipient,
        subject: root.subject,
        body: input.body,
        sendAt,
      })
      .onConflictDoNothing({ target: messages.parentId })
      .returning({ id: messages.id });
    if (row) return row;
    const [duplicate] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.parentId, id));
    return duplicate!;
  }

  async unsubscribe(product: string, id: string) {
    const db = this.database.db;
    const [row] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.product, product), eq(messages.id, id)));
    if (!row) throw new NotFoundException('邮件记录不存在');
    await db.transaction(async (tx) => {
      await tx
        .select()
        .from(mailboxes)
        .where(eq(mailboxes.address, row.mailbox))
        .for('update');
      await tx
        .insert(unsubscribes)
        .values({ mailbox: row.mailbox, recipient: row.recipient })
        .onConflictDoNothing();
    });
    return { unsubscribed: true };
  }

  async retry(product: string, id: string) {
    const db = this.database.db;
    const [row] = await db
      .update(messages)
      .set({ retryApproved: true })
      .where(
        and(
          eq(messages.product, product),
          eq(messages.id, id),
          eq(messages.mailbox, this.address()),
          or(
            eq(messages.status, 'failed'),
            and(
              eq(messages.status, 'uncertain'),
              isNotNull(messages.checkedAt),
              lt(messages.attemptedAt, new Date(Date.now() - 120000)),
            ),
          ),
        ),
      )
      .returning({ id: messages.id });
    if (!row)
      throw new ConflictException(
        '当前邮件无法重试。发送结果未知时，请等待 Worker 核对 Gmail 已发送邮件',
      );
    return row;
  }
}
