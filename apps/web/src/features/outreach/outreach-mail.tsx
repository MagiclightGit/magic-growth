import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Creator,
  OutreachMailbox,
  OutreachMessage,
  OutreachReply,
} from '@guangmo/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ErrorState, Loading } from '@/components/page-state';
import { api, dateTime, post } from '@/lib/api';

const mailboxStatus = {
  unconfigured: ['未配置', 'neutral'],
  pending: ['待检查', 'info'],
  connected: ['已连接', 'success'],
  failed: ['失败', 'danger'],
} as const;

const mailStatus = {
  queued: ['待处理', 'warning'],
  sending: ['正在发送', 'info'],
  sent: ['已发送', 'success'],
  stopped: ['已停发', 'neutral'],
  failed: ['失败', 'danger'],
  uncertain: ['待核对', 'warning'],
} as const;

export function MailboxStatus({
  mailbox,
  admin,
}: {
  mailbox: OutreachMailbox;
  admin: boolean;
}) {
  const client = useQueryClient();
  const pause = useMutation({
    mutationFn: () =>
      post<OutreachMailbox>('/outreach/mailbox/pause', {
        paused: !mailbox.paused,
      }),
    onSuccess: (data) => client.setQueryData(['outreach-mailbox'], data),
  });
  return (
    <section
      className="min-w-0 rounded-lg border bg-card p-3"
      aria-label="Gmail 试接邮箱"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Gmail 试接</h2>
        <Badge variant={mailboxStatus[mailbox.status][1]}>
          {mailboxStatus[mailbox.status][0]}
        </Badge>
        {mailbox.paused && <Badge variant="warning">已暂停</Badge>}
        {mailbox.address && (
          <span className="min-w-0 text-xs break-all text-muted-foreground">
            {mailbox.address}
          </span>
        )}
        {admin && mailbox.address && mailbox.recipients.length > 0 && (
          <Button
            className="ml-auto"
            variant="outline"
            size="sm"
            disabled={pause.isPending}
            onClick={() => pause.mutate()}
          >
            {mailbox.paused ? '恢复发信' : '暂停发信'}
          </Button>
        )}
      </div>
      {(mailbox.error || mailbox.status === 'unconfigured') && (
        <p className="mt-2 text-xs text-muted-foreground">
          {mailbox.error ?? '请联系管理员配置试接邮箱与受控收件地址。'}
        </p>
      )}
      {mailbox.paused && (
        <p className="mt-2 text-xs text-muted-foreground">
          待发邮件已保留，恢复时会重新检查回复和退订。
        </p>
      )}
      {pause.error && (
        <p role="alert" className="mt-2 text-xs text-status-danger-fg">
          {pause.error.message}
        </p>
      )}
    </section>
  );
}

type Detail = {
  creator: Creator;
  messages: OutreachMessage[];
  replies: (OutreachReply & { rootId: string })[];
};

export function CreatorDetail({
  base,
  id,
  mailbox,
  writable,
  admin,
  onClose,
  onBatch,
}: {
  base: string;
  id: string;
  mailbox?: OutreachMailbox;
  writable: boolean;
  admin: boolean;
  onClose: () => void;
  onBatch: (id: string) => void;
}) {
  const [composing, setComposing] = useState(false);
  const [notice, setNotice] = useState('');
  const detail = useQuery({
    queryKey: ['outreach-detail', base, id],
    queryFn: () => api<Detail>(`${base}/creators/${encodeURIComponent(id)}`),
    refetchInterval: 10000,
  });
  const { creator, messages, replies } = detail.data ?? {};
  const refresh = (message: string) => {
    setNotice(message);
    void detail.refetch();
  };
  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border bg-card p-3"
      aria-label="创作者详情"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-sm font-semibold break-all">
          {creator?.name || '创作者详情'}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          关闭详情
        </Button>
      </div>
      {detail.isPending && <Loading />}
      {detail.error && (
        <ErrorState error={detail.error} retry={() => void detail.refetch()} />
      )}
      {creator && (
        <>
          <dl className="space-y-2 text-[13px]">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                原始链接
              </dt>
              <dd className="break-all">{creator.link}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                录入来源
              </dt>
              <dd>
                {creator.batchId ? (
                  <Button
                    className="h-auto px-0"
                    variant="link"
                    size="sm"
                    onClick={() => onBatch(creator.batchId!)}
                  >
                    查看 CSV 导入批次
                  </Button>
                ) : (
                  '手动录入'
                )}
              </dd>
            </div>
            {creator.email && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  联系邮箱
                </dt>
                <dd className="flex flex-wrap items-center gap-2 break-all">
                  <span className="min-w-0">{creator.email}</span>
                  <Badge variant="warning">未核验</Badge>
                </dd>
              </div>
            )}
          </dl>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <h3 className="text-sm font-semibold">邮件记录</h3>
            {writable && !!mailbox?.recipients.length && (
              <Button
                variant="outline"
                size="sm"
                aria-expanded={composing}
                onClick={() => setComposing(!composing)}
              >
                {composing ? '关闭发信表单' : '新建测试邮件'}
              </Button>
            )}
          </div>
          {writable && composing && !!mailbox?.recipients.length && (
            <Compose
              base={base}
              id={id}
              recipients={mailbox.recipients}
              onSent={() => {
                setComposing(false);
                refresh('邮件已入队，可在此查看发送结果。');
              }}
            />
          )}
          {notice && (
            <p role="status" className="text-xs text-status-info-fg">
              {notice}
            </p>
          )}
          {!messages?.length && (
            <p className="text-xs text-muted-foreground">暂无邮件记录</p>
          )}
          {messages?.map((mail) => (
            <MailRecord
              key={mail.id}
              base={base}
              mail={mail}
              admin={admin && writable}
              writable={writable}
              currentMailbox={mailbox?.address === mail.mailbox}
              hasFollowup={messages.some((item) => item.parentId === mail.id)}
              replies={
                replies?.filter((reply) => reply.rootId === mail.id) ?? []
              }
              onChange={refresh}
            />
          ))}
        </>
      )}
    </section>
  );
}

function Compose({
  base,
  id,
  recipients,
  onSent,
}: {
  base: string;
  id: string;
  recipients: string[];
  onSent: () => void;
}) {
  const [key] = useState(() => crypto.randomUUID());
  const send = useMutation({
    mutationFn: (input: FormData) =>
      post(base + '/messages', {
        ...Object.fromEntries(input),
        key,
        creatorId: id,
      }),
    onSuccess: onSent,
  });
  return (
    <form
      className="space-y-2 rounded-md border p-3 text-[13px]"
      onSubmit={(event) => {
        event.preventDefault();
        send.mutate(new FormData(event.currentTarget));
      }}
    >
      <label className="block" htmlFor="outreach-recipient">
        受控测试地址
      </label>
      <select
        className="h-8 w-full rounded-md border border-input bg-card px-2.5"
        required
        name="recipient"
        id="outreach-recipient"
        defaultValue=""
      >
        <option value="">请选择收件地址</option>
        {recipients.map((recipient) => (
          <option key={recipient}>{recipient}</option>
        ))}
      </select>
      <label className="block" htmlFor="outreach-subject">
        主题
      </label>
      <Input id="outreach-subject" name="subject" required maxLength={120} />
      <label className="block" htmlFor="outreach-body">
        正文
      </label>
      <Textarea id="outreach-body" name="body" required maxLength={10000} />
      {send.error && (
        <p role="alert" className="text-xs text-status-danger-fg">
          {send.error.message}
        </p>
      )}
      <Button type="submit" disabled={send.isPending}>
        提交测试发信
      </Button>
    </form>
  );
}

function MailRecord({
  base,
  mail,
  admin,
  writable,
  currentMailbox,
  hasFollowup,
  replies,
  onChange,
}: {
  base: string;
  mail: OutreachMessage;
  admin: boolean;
  writable: boolean;
  currentMailbox: boolean;
  hasFollowup: boolean;
  replies: OutreachReply[];
  onChange: (message: string) => void;
}) {
  const [action, setAction] = useState<'followup' | 'unsubscribe' | 'retry'>();
  const operation = useMutation({
    mutationFn: ({ kind, body }: { kind: string; body: object }) =>
      post(`${base}/messages/${mail.id}/${kind}`, body),
    onSuccess: (_, { kind }) => {
      setAction(undefined);
      onChange(
        kind === 'unsubscribe'
          ? '已登记退订，试接邮箱将停止向此地址发送。'
          : kind === 'retry'
            ? '已申请重试，Worker 将重新检查发送条件。'
            : '已安排同线程跟进。',
      );
    },
  });
  function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    operation.mutate({
      kind: 'followup',
      body: {
        body: form.get('body'),
        sendAt: new Date(String(form.get('when'))).toISOString(),
      },
    });
  }
  const showRetry =
    admin &&
    currentMailbox &&
    (mail.status === 'failed' ||
      (mail.status === 'uncertain' && !!mail.checkedAt));
  return (
    <article className="min-w-0 space-y-2 rounded-md border p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={mailStatus[mail.status][1]}>
          {mailStatus[mail.status][0]}
        </Badge>
        {mail.parentId && <Badge variant="info">跟进</Badge>}
        <h4 className="min-w-0 font-medium break-all">{mail.subject}</h4>
      </div>
      <p className="text-xs break-all text-muted-foreground">
        {mail.recipient} · {mail.sentAt ? '发送于' : '计划发送于'}{' '}
        {dateTime(mail.sentAt ?? mail.sendAt)}
      </p>
      {mail.error && (
        <p className="text-xs text-status-warning-fg">{mail.error}</p>
      )}
      {mail.gmailId && (
        <p className="text-xs break-all text-muted-foreground">
          Gmail 邮件 {mail.gmailId} · 线程 {mail.threadId}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          邮件正文
        </summary>
        <p className="mt-1 whitespace-pre-wrap break-words">{mail.body}</p>
      </details>
      {replies.map((reply) => (
        <div key={reply.id} className="border-t pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">已收到回复</Badge>
            <span className="min-w-0 text-xs break-all text-muted-foreground">
              {reply.sender} · {dateTime(reply.receivedAt)}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words">
            {reply.body || '无可显示的文本'}
          </p>
        </div>
      ))}
      {writable && (
        <div className="flex flex-wrap gap-2">
          {!mail.parentId &&
            currentMailbox &&
            mail.status === 'sent' &&
            !hasFollowup &&
            !replies.length && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAction('followup')}
              >
                安排跟进
              </Button>
            )}
          {!mail.parentId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAction('unsubscribe')}
            >
              登记退订
            </Button>
          )}
          {showRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAction('retry')}
            >
              申请重试
            </Button>
          )}
        </div>
      )}
      {action === 'followup' && (
        <form className="grid gap-2" onSubmit={schedule}>
          <label className="grid gap-1">
            发送时间（本地时间）
            <Input type="datetime-local" name="when" required />
          </label>
          <label className="grid gap-1">
            跟进正文
            <Textarea name="body" required maxLength={10000} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={operation.isPending}>
              确认安排
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAction(undefined)}
            >
              取消
            </Button>
          </div>
        </form>
      )}
      {(action === 'unsubscribe' || action === 'retry') && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {action === 'unsubscribe'
              ? '退订适用于该邮箱发往此地址的所有建联。'
              : mail.status === 'uncertain'
                ? '请在 Gmail 已发送中确认邮件未发出，再授权 Worker 重试。'
                : 'Worker 将复查权限、回复和退订后重试。'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={operation.isPending}
              onClick={() => operation.mutate({ kind: action, body: {} })}
            >
              {action === 'unsubscribe' ? '确认退订' : '确认重试'}
            </Button>
            <Button variant="ghost" onClick={() => setAction(undefined)}>
              取消
            </Button>
          </div>
        </div>
      )}
      {operation.error && (
        <p role="alert" className="text-xs text-status-danger-fg">
          {operation.error.message}
        </p>
      )}
    </article>
  );
}
