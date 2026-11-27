import { z } from 'zod';

export function normalizeCreatorLink(raw: string) {
  try {
    const url = new URL(raw);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname.includes('.') ||
      /\s/.test(raw) ||
      [...raw].some((char) => char.charCodeAt(0) < 32)
    )
      return null;
    url.hash = '';
    url.hostname = url.hostname.replace(/\.$/, '');
    if (!url.port) url.protocol = 'https:';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.*|fbclid|gclid|igsh|si)$/i.test(key))
        url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.href.length <= 2000 ? url.href : null;
  } catch {
    return null;
  }
}

export const outreachEmail = z
  .email({ error: '邮箱格式无效' })
  .max(254)
  .transform((value) => value.toLowerCase());
export const creatorInput = z.object({
  link: z
    .string()
    .trim()
    .max(2000, '创作者链接最多 2000 字符')
    .refine(
      (value) => normalizeCreatorLink(value) !== null,
      '创作者链接须为有效的 HTTP 或 HTTPS 网址，且不得包含账号信息',
    ),
  name: z
    .string()
    .trim()
    .max(200, '名称最多 200 字符')
    .refine((value) => !value.includes('\0'), '名称含无效字符')
    .default(''),
  email: z.union([outreachEmail, z.literal('')]).default(''),
});
export const creatorCsv = z.object({
  csv: z
    .string()
    .min(1, '请选择 CSV 文件')
    .max(48000, 'CSV 内容过大')
    .refine(
      (value) => !value.includes('\0'),
      'CSV 包含无效字符，请另存为 UTF-8',
    ),
  filename: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((value) => !value.includes('\0'), '文件名含无效字符'),
});
export const outreachSendInput = z.object({
  key: z.uuid(),
  creatorId: z.uuid(),
  recipient: outreachEmail,
  subject: z
    .string()
    .trim()
    .min(1, '请输入主题')
    .max(120)
    .refine(
      (value) => [...value].every((char) => char.charCodeAt(0) >= 32),
      '主题不得包含控制字符',
    ),
  body: z
    .string()
    .trim()
    .min(1, '请输入正文')
    .max(10000)
    .refine((value) => !value.includes('\0'), '正文含无效字符'),
});
export const outreachFollowupInput = z.object({
  body: outreachSendInput.shape.body,
  sendAt: z.iso.datetime(),
});

export type Creator = {
  id: string;
  link: string;
  name: string;
  email: string;
  batchId: string | null;
  createdAt: string;
};
export type CsvRow = {
  line: number;
  link: string;
  status: 'valid' | 'created' | 'duplicate' | 'failed';
  reason?: string;
  creatorId?: string;
};
export type CsvBatch = {
  id: string;
  filename: string;
  rows: CsvRow[];
  createdAt: string;
};
export type OutreachStatus =
  'queued' | 'sending' | 'sent' | 'stopped' | 'failed' | 'uncertain';
export type OutreachMessage = {
  id: string;
  creatorId: string;
  parentId: string | null;
  mailbox: string;
  recipient: string;
  subject: string;
  body: string;
  status: OutreachStatus;
  error: string | null;
  sendAt: string;
  gmailId: string | null;
  threadId: string | null;
  sentAt: string | null;
  checkedAt: string | null;
};
export type OutreachReply = {
  id: string;
  sender: string;
  body: string;
  receivedAt: string;
};
export type OutreachMailbox = {
  address: string | null;
  status: 'unconfigured' | 'pending' | 'connected' | 'failed';
  paused: boolean;
  error: string | null;
  recipients: string[];
};

export function gmailPilotConfig(env: Record<string, string | undefined>) {
  const address = outreachEmail.safeParse(env.GMAIL_PILOT_ADDRESS?.trim());
  const recipients = (env.GMAIL_PILOT_RECIPIENTS ?? '')
    .split(',')
    .map((value) => outreachEmail.safeParse(value.trim()))
    .flatMap((result) => (result.success ? [result.data] : []));
  return {
    address: address.success ? address.data : null,
    recipients: [...new Set(recipients)].filter(
      (value) => value !== address.data,
    ),
  };
}
