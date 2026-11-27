import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { ArrowUpIcon, MessageSquareIcon, LoaderCircleIcon } from 'lucide-react';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageActions,
} from '@/components/ai-elements/message';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  canWrite,
  type ConversationDetail,
  type ConversationSource,
  type ConversationTurn,
  type ResearchConversation,
  type SharedResearchSupplement,
} from '@guangmo/contracts';
import { api, post, dateTime } from '@/lib/api';
import { memberQuery, integrationQuery } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ResearchReport } from '@/components/research-report';
import { ErrorState, Loading } from '@/components/page-state';
import { Tool, ToolContent, ToolHeader } from '@/components/ai-elements/tool';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
const statusLabels = {
  queued: '等待回答',
  running: '回答中',
  succeeded: '已完成',
  failed: '回答未完成',
};
export function ReportFollowUps(
  props: ConversationSource & { compact?: boolean },
) {
  return <FollowUps key={`${props.sourceKind}-${props.sourceId}`} {...props} />;
}
function FollowUps({
  compact,
  ...source
}: ConversationSource & { compact?: boolean }) {
  const [tab, setTab] = useState<'mine' | 'shared'>('mine');
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'discuss' | 'research'>('discuss');
  const [sharing, setSharing] = useState<ConversationTurn | null>(null);
  const submission = useRef<{
    requestId: string;
    createId: string;
    conversationId?: string;
    text: string;
    mode: string;
  } | null>(null);
  const client = useQueryClient();
  const member = useQuery(memberQuery);
  const integration = useQuery(integrationQuery);
  const writable = canWrite(member.data?.role ?? 'viewer');
  const ready =
    integration.data?.agentConfigured && integration.data.queueAvailable;
  const params = new URLSearchParams(source).toString();
  const list = useQuery({
    queryKey: ['private-conversations', source],
    queryFn: () =>
      api<ResearchConversation[]>(`/research-conversations?${params}`),
  });
  const id = selected === 'new' ? undefined : (selected ?? list.data?.[0]?.id);
  const detail = useQuery({
    queryKey: ['private-conversation', id],
    queryFn: () => api<ConversationDetail>(`/research-conversations/${id}`),
    enabled: !!id,
    refetchInterval: (q) =>
      q.state.data?.turns.some((t) => ['queued', 'running'].includes(t.status))
        ? 2500
        : false,
  });
  const shared = useQuery({
    queryKey: ['shared-supplements', source],
    queryFn: () =>
      api<SharedResearchSupplement[]>(
        `/research-conversations/shared?${params}`,
      ),
    enabled: tab === 'shared',
  });
  const active =
    detail.data?.turns.some((t) => ['queued', 'running'].includes(t.status)) ??
    false;
  const failed = detail.data?.turns.some((t) => t.status === 'failed') ?? false;
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['private-conversations', source] }),
      client.invalidateQueries({ queryKey: ['private-conversation'] }),
      client.invalidateQueries({ queryKey: ['shared-supplements', source] }),
    ]);
  };
  const send = useMutation({
    mutationFn: async () => {
      let pending = submission.current;
      if (
        !pending ||
        pending.text !== text ||
        pending.mode !== mode ||
        (id && pending.conversationId !== id)
      )
        pending = {
          requestId: crypto.randomUUID(),
          createId: crypto.randomUUID(),
          conversationId: id,
          text,
          mode,
        };
      submission.current = pending;
      if (!pending.conversationId) {
        const c = await post<{ id: string }>('/research-conversations', {
          ...source,
          requestId: pending.createId,
        });
        pending.conversationId = c.id;
      }
      await post(`/research-conversations/${pending.conversationId}/messages`, {
        requestId: pending.requestId,
        text: pending.text,
        mode: pending.mode,
      });
      return pending.conversationId;
    },
    onSuccess: async (conversationId) => {
      setSelected(conversationId);
      setText('');
      submission.current = null;
      await refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const action = useMutation({
    mutationFn: ({
      turnId,
      action,
    }: {
      turnId: string;
      action: 'retry' | 'share';
    }) =>
      post(`/research-conversations/${id}/messages/${turnId}/${action}`, {}),
    onSuccess: async () => {
      setSharing(null);
      await refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <section
      className={cn(
        'min-w-0 space-y-4 rounded-xl border bg-card p-4',
        compact && 'flex h-full min-h-0 flex-col space-y-2 overflow-hidden p-3',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">与 Agent 讨论报告</h3>
          {!compact && (
            <p className="mt-1 text-xs text-muted-foreground">
              基于本次报告继续提问，也可以联网补充研究。
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={tab === 'mine' ? 'secondary' : 'outline'}
            onClick={() => setTab('mine')}
          >
            我的追问
          </Button>
          <Button
            size="sm"
            variant={tab === 'shared' ? 'secondary' : 'outline'}
            onClick={() => {
              setTab('shared');
              void shared.refetch();
            }}
          >
            团队补充
          </Button>
        </div>
      </div>
      {tab === 'shared' ? (
        <div className="min-h-0 space-y-4 overflow-y-auto">
          {shared.isPending ? (
            <Loading />
          ) : shared.error ? (
            <ErrorState error={shared.error} />
          ) : !shared.data.length ? (
            <p className="text-sm text-muted-foreground">
              还没有分享的补充研究。
            </p>
          ) : (
            shared.data.map((s) => (
              <article
                key={s.id}
                className="space-y-3 rounded-lg bg-muted/30 p-4"
              >
                <p className="text-xs text-muted-foreground">
                  {s.authorName} · {dateTime(s.createdAt)} · AI 回答，待核实
                </p>
                <h4 className="whitespace-pre-wrap text-sm font-medium">
                  {s.question}
                </h4>
                <ResearchReport>{s.answer}</ResearchReport>
              </article>
            ))
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            仅自己可见 · 可主动分享给团队
          </p>
          {list.isPending ? (
            <Loading />
          ) : list.error ? (
            <ErrorState error={list.error} />
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-0 flex-1 space-y-1 text-xs">
                  <span>我的会话</span>
                  <select
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={id ?? 'new'}
                    disabled={send.isPending}
                    onChange={(e) => {
                      setSelected(e.target.value);
                      setText('');
                      submission.current = null;
                    }}
                  >
                    <option value="new">新会话</option>
                    {list.data.map((c) => (
                      <option key={c.id} value={c.id}>
                        {dateTime(c.createdAt)} · {c.title}
                      </option>
                    ))}
                  </select>
                </label>
                {writable && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={send.isPending}
                    onClick={() => {
                      setSelected('new');
                      setText('');
                      submission.current = null;
                    }}
                  >
                    新建会话
                  </Button>
                )}
              </div>
              <div
                className={cn(
                  'flex h-[min(680px,75svh)] min-h-96 flex-col overflow-hidden rounded-xl border bg-background',
                  compact && 'h-auto min-h-0 flex-1',
                )}
              >
                <Conversation
                  key={id ?? 'new'}
                  className="min-h-0"
                  aria-label="个人追问记录"
                  aria-live="polite"
                >
                  <ConversationContent className="gap-6">
                    {!id && (
                      <ConversationEmptyState
                        icon={<MessageSquareIcon className="size-8" />}
                        title="从这份报告开始聊"
                        description="解读结论、寻找机会，或继续核实缺失的证据。"
                      >
                        <MessageSquareIcon className="size-8 text-muted-foreground" />
                        <p className="font-medium">从这份报告开始聊</p>
                        <p className="text-sm text-muted-foreground">
                          解读结论、寻找机会，或继续核实缺失的证据。
                        </p>
                        {writable && (
                          <div className="mt-2 flex flex-wrap justify-center gap-2">
                            {[
                              '这份报告有哪些值得行动的机会？',
                              '哪些结论还缺少证据？',
                            ].map((question) => (
                              <Button
                                key={question}
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-auto whitespace-normal py-2"
                                onClick={() => setText(question)}
                              >
                                {question}
                              </Button>
                            ))}
                          </div>
                        )}
                      </ConversationEmptyState>
                    )}
                    {id &&
                      (detail.isPending ? (
                        <Loading />
                      ) : detail.error ? (
                        <ErrorState error={detail.error} />
                      ) : (
                        detail.data && (
                          <>
                            <p className="text-xs text-muted-foreground">
                              报告版本：
                              {dateTime(detail.data.context.collectedAt)}
                            </p>
                            <div className="space-y-6">
                              {detail.data.turns.map((turn) => (
                                <article key={turn.id} className="space-y-3">
                                  <Message from="user">
                                    <MessageContent>
                                      <p className="mb-1 text-xs text-muted-foreground">
                                        我 ·{' '}
                                        {turn.mode === 'research'
                                          ? '继续研究'
                                          : '解读报告'}{' '}
                                        · {dateTime(turn.createdAt)}
                                      </p>
                                      <p className="whitespace-pre-wrap text-sm">
                                        {turn.question}
                                      </p>
                                    </MessageContent>
                                  </Message>
                                  <Message
                                    from="assistant"
                                    className="max-w-full"
                                  >
                                    <MessageContent className="w-full space-y-2">
                                      <p className="text-xs text-muted-foreground">
                                        Agent · {statusLabels[turn.status]}
                                      </p>
                                      {!turn.answer &&
                                        ['queued', 'running'].includes(
                                          turn.status,
                                        ) && (
                                          <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
                                            {turn.status === 'queued'
                                              ? '已收到，等待后台执行…'
                                              : '正在整理回答…'}
                                          </p>
                                        )}
                                      {turn.answer && (
                                        <ResearchReport
                                          streaming={turn.status === 'running'}
                                        >
                                          {turn.answer}
                                        </ResearchReport>
                                      )}
                                      {turn.error && (
                                        <p
                                          role="alert"
                                          className="break-words text-sm text-destructive"
                                        >
                                          {turn.error}
                                        </p>
                                      )}
                                      {turn.events.length > 0 && (
                                        <Tool>
                                          <ToolHeader
                                            title={
                                              turn.events.at(-1)?.message ??
                                              '执行过程'
                                            }
                                            type="tool-research"
                                            state={
                                              turn.status === 'succeeded'
                                                ? 'output-available'
                                                : turn.status === 'failed'
                                                  ? 'output-error'
                                                  : turn.status === 'queued'
                                                    ? 'input-streaming'
                                                    : 'input-available'
                                            }
                                          />
                                          <ToolContent>
                                            <ul className="max-h-48 space-y-2 overflow-y-auto px-3 pb-3 text-xs">
                                              {turn.events.map((e) => (
                                                <li key={e.id}>
                                                  <span className="mr-2 text-muted-foreground">
                                                    {dateTime(e.createdAt)}
                                                  </span>
                                                  {e.data?.kind === 'source' &&
                                                  e.data.url ? (
                                                    <a
                                                      href={e.data.url}
                                                      target="_blank"
                                                      rel="noreferrer"
                                                      className="break-all underline"
                                                    >
                                                      {e.message}
                                                    </a>
                                                  ) : (
                                                    e.message
                                                  )}
                                                </li>
                                              ))}
                                            </ul>
                                          </ToolContent>
                                        </Tool>
                                      )}
                                      <MessageActions className="flex-wrap">
                                        {writable &&
                                          turn.status === 'failed' && (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              disabled={
                                                active ||
                                                action.isPending ||
                                                !ready
                                              }
                                              onClick={() =>
                                                action.mutate({
                                                  turnId: turn.id,
                                                  action: 'retry',
                                                })
                                              }
                                            >
                                              重试这轮回答
                                            </Button>
                                          )}
                                        {turn.status === 'succeeded' &&
                                          (turn.sharedId ? (
                                            <p className="text-xs text-muted-foreground">
                                              本轮回答已分享给有该产品权限的团队成员。
                                            </p>
                                          ) : (
                                            writable && (
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => setSharing(turn)}
                                              >
                                                预览并分享本轮结果
                                              </Button>
                                            )
                                          ))}
                                      </MessageActions>
                                    </MessageContent>
                                  </Message>
                                </article>
                              ))}
                            </div>
                          </>
                        )
                      ))}
                  </ConversationContent>
                  <ConversationScrollButton aria-label="回到最新消息" />
                </Conversation>
                {writable && (
                  <form
                    className="shrink-0 space-y-3 border-t bg-background p-3"
                    aria-label="发送追问"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (
                        !send.isPending &&
                        !active &&
                        !failed &&
                        ready &&
                        !detail.error &&
                        !(id && detail.isPending) &&
                        text.trim().length >= 2
                      )
                        send.mutate();
                    }}
                  >
                    <label className="flex flex-wrap items-center gap-2 text-xs">
                      <span>追问方式</span>
                      <select
                        className="h-9 rounded-md border bg-background px-2 text-sm"
                        value={mode}
                        onChange={(e) => setMode(e.target.value as typeof mode)}
                        disabled={send.isPending || active}
                      >
                        <option value="discuss">解读报告 · 使用已有资料</option>
                        <option value="research">
                          继续研究 · 联网补充证据
                        </option>
                      </select>
                    </label>
                    <Textarea
                      aria-label="追问内容"
                      placeholder="例如：为什么广告维度仍然未知？或继续核实英国用户评价。"
                      rows={2}
                      className="max-h-36 min-h-20 resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
                      onKeyDown={(e) => {
                        if (
                          e.key === 'Enter' &&
                          !e.shiftKey &&
                          !e.nativeEvent.isComposing &&
                          e.keyCode !== 229
                        ) {
                          e.preventDefault();
                          e.currentTarget.form?.requestSubmit();
                        }
                      }}
                      maxLength={4000}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      disabled={
                        send.isPending ||
                        active ||
                        failed ||
                        !!detail.error ||
                        (!!id && detail.isPending)
                      }
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        {failed
                          ? '请先重试失败回答，或新建会话。'
                          : active
                            ? '后台处理中，关闭页面仍会继续。'
                            : !ready
                              ? '请先配置模型与后台服务。'
                              : mode === 'research'
                                ? '将调用模型和搜索服务，结果默认仅自己可见。'
                                : '基于已有报告解读，不核实最新信息。'}
                      </p>
                      <Button
                        size="icon"
                        className="rounded-full"
                        aria-label="发送追问"
                        disabled={
                          send.isPending ||
                          active ||
                          failed ||
                          !ready ||
                          text.trim().length < 2 ||
                          !!detail.error ||
                          (!!id && detail.isPending)
                        }
                      >
                        {send.isPending || active ? (
                          <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
                        ) : (
                          <ArrowUpIcon className="size-4" />
                        )}
                      </Button>
                    </div>
                    {!compact && (
                      <p className="text-[11px] text-muted-foreground">
                        Enter 发送 · Shift+Enter 换行 · 仅自己可见
                      </p>
                    )}
                  </form>
                )}
              </div>
            </>
          )}
        </>
      )}
      <Dialog
        open={!!sharing}
        onOpenChange={(open) => {
          if (!open) setSharing(null);
        }}
      >
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>分享本轮结果</DialogTitle>
            <DialogDescription>
              以下问题和完整回答将对有该产品权限的团队成员可见。回答可能引用此前的个人追问，请检查后分享；其余会话记录不会公开。
            </DialogDescription>
          </DialogHeader>
          {sharing && (
            <>
              <p className="whitespace-pre-wrap text-sm font-medium">
                {sharing.question}
              </p>
              <ResearchReport>{sharing.answer ?? ''}</ResearchReport>
              <Button
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({ turnId: sharing.id, action: 'share' })
                }
              >
                确认分享给团队
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
