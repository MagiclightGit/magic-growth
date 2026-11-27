import { z } from 'zod';

const messageHeaders = z
  .array(z.object({ name: z.string(), value: z.string() }))
  .default([]);
const gmailMessage = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  labelIds: z.array(z.string()).default([]),
  snippet: z.string().default(''),
  internalDate: z.coerce.number().int().nonnegative().optional(),
  payload: z.object({ headers: messageHeaders }).optional(),
});
export type GmailMessage = z.infer<typeof gmailMessage>;

export class GmailError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const gmailUrl = 'https://gmail.googleapis.com/gmail/v1/users/me';

export async function googleToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(12000),
    redirect: 'error',
  });
  if (!response.ok)
    throw new GmailError(
      response.status,
      response.status < 500
        ? 'Gmail 授权更新失败，请检查 OAuth 配置或重新授权'
        : 'Google OAuth 暂不可用，后台将继续检查',
    );
  return z
    .object({ access_token: z.string().min(1) })
    .parse(await response.json()).access_token;
}

export class Gmail {
  constructor(private readonly token: string) {}

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: { raw: string; threadId?: string },
  ) {
    const response = await fetch(gmailUrl + path, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      method: body ? 'POST' : 'GET',
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12000),
      redirect: 'error',
    });
    if (!response.ok)
      throw new GmailError(
        response.status,
        [401, 403].includes(response.status)
          ? `Gmail 拒绝请求（HTTP ${response.status}），请检查授权范围及 Workspace 策略`
          : `Gmail API 请求失败（HTTP ${response.status}）`,
      );
    return schema.parse(await response.json());
  }

  async address() {
    const profile = await this.request(
      '/profile',
      z.object({ emailAddress: z.email() }),
    );
    return profile.emailAddress.toLowerCase();
  }

  async thread(id: string) {
    const thread = await this.request(
      `/threads/${encodeURIComponent(id)}?format=full`,
      z.object({ messages: z.array(gmailMessage) }),
    );
    return thread.messages;
  }

  async findSent(messageId: string) {
    const query = new URLSearchParams({
      q: `in:sent rfc822msgid:${messageId.slice(1, -1)}`,
      maxResults: '2',
    });
    const result = await this.request(
      `/messages?${query}`,
      z.object({
        messages: z.array(z.object({ id: z.string() })).default([]),
        nextPageToken: z.string().optional(),
      }),
    );
    if (result.messages.length > 1 || result.nextPageToken)
      throw new Error('Gmail 已发送邮件中存在多个匹配项');
    const match = result.messages[0];
    if (!match) return null;
    const message = await this.request(
      `/messages/${encodeURIComponent(match.id)}?format=metadata`,
      gmailMessage,
    );
    if (
      !message.labelIds.includes('SENT') ||
      header(message, 'message-id') !== messageId
    )
      throw new Error('Gmail 已发送邮件的标识无法确认');
    return message;
  }

  send(raw: string, threadId?: string) {
    return this.request('/messages/send', gmailMessage, { raw, threadId });
  }
}

export function header(message: GmailMessage, name: string) {
  return (
    message.payload?.headers
      .find((item) => item.name.toLowerCase() === name)
      ?.value.trim() ?? ''
  );
}

export function replyAddress(from: string) {
  return (from.match(/<([^<>]+)>\s*$/)?.[1] ?? from).trim().toLowerCase();
}

export function isUnsubscribe(snippet: string) {
  return (
    /^(unsubscribe|stop|退订|取消订阅)[.!。！]?$/iu.test(snippet.trim()) ||
    /^(?:please unsubscribe me|please stop (?:emailing|contacting) me)[.!]?$/iu.test(
      snippet.trim(),
    )
  );
}

export function gmailRaw(
  mail: { mailbox: string; recipient: string; subject: string; body: string },
  messageId: string,
  parentMessageId?: string,
) {
  // UTF-8 chunks keep each RFC 2047 encoded word within its 75-character limit.
  const chunks: string[] = [];
  let chunk = '';
  for (const letter of mail.subject) {
    if (Buffer.byteLength(chunk + letter) > 42) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += letter;
  }
  chunks.push(chunk);
  const subject = chunks
    .map((word) => `=?UTF-8?B?${Buffer.from(word).toString('base64')}?=`)
    .join('\r\n ');
  const body =
    Buffer.from(mail.body.replace(/\r\n?|\n/g, '\r\n'))
      .toString('base64')
      .match(/.{1,76}/g)
      ?.join('\r\n') ?? '';
  const lines = [
    `From: ${mail.mailbox}`,
    `To: ${mail.recipient}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    ...(parentMessageId
      ? [`In-Reply-To: ${parentMessageId}`, `References: ${parentMessageId}`]
      : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ];
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}
