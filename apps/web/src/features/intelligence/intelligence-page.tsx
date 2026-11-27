import { ProductName } from '@/features/products/product-context';
import { ProductField } from '@/features/products/product-context';
import { ChoiceSelect } from '@/components/choice-select';
import { intelligenceAssigneesQuery } from './owner-assignment';
import { ScoreSummary } from '@/components/opportunity-score';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  informationDateLabel,
  InformationTimes,
} from '@/components/information-times';
import { EvidenceAndTasks } from './evidence-and-tasks';
import { IntelligenceSourceHealth } from './source-health';
import { useDeferredValue, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  canWrite,
  categoryLabels,
  claimTypeLabels,
  verticalLabels,
  type Candidate,
  type IntelligenceItem,
  type IntelligenceListItem,
  intelligenceListFilters,
  marketLabels,
  taskStatusLabels,
} from '@guangmo/contracts';
import { intelligenceQuery, memberQuery } from '@/lib/queries';
import { api, post, dateTime } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  PageHeading,
  FilterBar,
  Loading,
  ErrorState,
  EmptyState,
} from '@/components/page-state';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const statusLabel = {
  pending: '待确认',
  verified: '已确认',
  irrelevant: '不相关',
};
const statusVariant = {
  pending: 'warning' as const,
  verified: 'success' as const,
  irrelevant: 'neutral' as const,
};
const views = {
  today: '今日重点',
  industry: '行业资讯',
  competitor: '竞品变化',
  social: '内容机会',
  history: '全部记录',
} as const;
const verticalOptions = Object.entries(verticalLabels).map(
  ([value, label]) => ({ value, label }),
);

export default function IntelligencePage() {
  const [open, setOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const parsed = intelligenceListFilters.safeParse(
    Object.fromEntries(
      [...params].filter(([key, value]) => key !== 'item' && !!value),
    ),
  );
  const filters = parsed.success
    ? parsed.data
    : intelligenceListFilters.parse({});
  const search = params.get('search') ?? '';
  const deferred = useDeferredValue(search);
  const view = filters.view ?? (filters.status ? 'history' : 'today');
  const dateField =
    filters.dateField ?? (view === 'history' ? 'collected' : 'published');
  const navigate = useNavigate();
  const status = filters.status ?? '';
  const category = filters.category ?? '';
  function setFilter(key: string, value: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value && value !== 'all') next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: key === 'search' },
    );
  }
  const selectedId = params.get('item');
  const detail = useQuery({
    queryKey: ['intelligence-detail', selectedId],
    queryFn: () => api<IntelligenceListItem>(`/intelligence/${selectedId}`),
    enabled: !!selectedId,
  });
  const selected = detail.data;
  const setSelected = (item: IntelligenceItem | null) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (item) next.set('item', item.id);
      else next.delete('item');
      return next;
    });
  const client = useQueryClient();
  const member = useQuery(memberQuery);
  const query = useQuery(
    intelligenceQuery({ ...filters, view, dateField, search: deferred }),
  );
  const assignees = useQuery(intelligenceAssigneesQuery);
  const writable = canWrite(member.data?.role ?? 'viewer');
  const create = useMutation({
    mutationFn: (body: unknown) => post<Candidate>('/candidates', body),
    onSuccess: (candidate) => {
      setOpen(false);
      toast.success('线索已保存');
      void client.invalidateQueries({ queryKey: ['candidates'] });
      navigate(
        '/candidates?' +
          new URLSearchParams({
            status: candidate.status,
            ...(filters.product ? { product: filters.product } : {}),
          }),
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api<IntelligenceItem>(`/intelligence/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: (item) => {
      setSelected(item);
      toast.success('情报状态已更新');
      void client.invalidateQueries({ queryKey: ['intelligence-detail'] });
      void client.invalidateQueries({ queryKey: ['intelligence'] });
      void client.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (error) => toast.error(error.message),
  });
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    create.mutate({
      ...form,
      publishedAt: form.publishedAt || null,
      vertical: form.vertical || undefined,
    });
  }
  return (
    <>
      <PageHeading
        title="情报收件箱"
        description="阅读已核实的市场动态，查看来源和下一步行动。"
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link
                to={
                  filters.product
                    ? '/briefs?' +
                      new URLSearchParams({ product: filters.product })
                    : '/briefs'
                }
              >
                查看今日简报
              </Link>
            </Button>
            {writable && (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="size-4" />
                    补充线索
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90svh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>补充线索</DialogTitle>
                    <DialogDescription>
                      保存到候选情报，由团队核实后入库。
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="title">标题</Label>
                      <Input
                        id="title"
                        name="title"
                        minLength={2}
                        maxLength={200}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="summary">摘要</Label>
                      <Textarea
                        id="summary"
                        name="summary"
                        minLength={5}
                        maxLength={12000}
                        rows={4}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sourceUrl">来源链接</Label>
                      <Input
                        id="sourceUrl"
                        name="sourceUrl"
                        type="url"
                        placeholder="https://"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="category">类型</Label>
                        <Select name="category" defaultValue="industry">
                          <SelectTrigger
                            id="category"
                            className="w-full min-w-0"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent position="popper" sideOffset={4}>
                            {Object.entries(categoryLabels).map(([k, v]) => (
                              <SelectItem key={k} value={k}>
                                {v}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <ProductField />
                      <div className="space-y-2">
                        <Label htmlFor="market">市场</Label>
                        <Select name="market" defaultValue="US">
                          <SelectTrigger id="market" className="w-full min-w-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent position="popper" sideOffset={4}>
                            <SelectItem value="US">美国</SelectItem>
                            <SelectItem value="UK">英国</SelectItem>
                            <SelectItem value="EU">欧洲</SelectItem>
                            <SelectItem value="Global">全球</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <ChoiceSelect
                          label="所属行业"
                          name="vertical"
                          defaultValue=""
                          options={verticalOptions}
                        />
                      </div>
                      <div className="space-y-2">
                        <ChoiceSelect
                          label="信息性质"
                          name="claimType"
                          defaultValue="fact"
                          options={Object.entries(claimTypeLabels).map(
                            ([value, label]) => ({ value, label }),
                          )}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lead-date">原始发布时间</Label>
                        <Input id="lead-date" name="publishedAt" type="date" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lead-evidence">原文摘录</Label>
                      <Textarea
                        id="lead-evidence"
                        name="evidence"
                        maxLength={2000}
                        rows={2}
                        placeholder="暂缺摘录时可先保存待补证"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lead-action">建议行动</Label>
                      <Input
                        id="lead-action"
                        name="suggestedAction"
                        maxLength={2000}
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setOpen(false)}
                      >
                        取消
                      </Button>
                      <Button disabled={create.isPending}>
                        {create.isPending ? '保存中…' : '保存线索'}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        }
      />
      <IntelligenceSourceHealth product={filters.product} />
      <nav
        aria-label="情报视图"
        className="mb-3 flex flex-wrap gap-1 border-b bg-card px-3 pt-1 rounded-t-lg border-x border-t"
      >
        {Object.entries(views).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-current={view === value ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors',
              view === value
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() =>
              setParams((current) => {
                const next = new URLSearchParams(current);
                for (const key of ['category', 'status', 'range', 'dateField'])
                  next.delete(key);
                next.set('view', value);
                return next;
              })
            }
          >
            {label}
          </button>
        ))}
      </nav>
      <FilterBar className="-mt-3 rounded-t-none border-t-0">
        <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap">
          <div className="sm:w-32">
            <ChoiceSelect
              label="按市场筛选"
              value={filters.market ?? 'all'}
              onValueChange={(value) => setFilter('market', value)}
              options={[
                { value: 'all', label: '全部市场' },
                ...Object.entries(marketLabels).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
          </div>
          <div className="sm:w-36">
            <ChoiceSelect
              label="时间范围"
              value={
                view === 'today' && filters.range === 'all'
                  ? '24h'
                  : filters.range
              }
              onValueChange={(value) => setFilter('range', value)}
              options={[
                ...(view === 'today'
                  ? []
                  : [{ value: 'all', label: '全部时间' }]),
                { value: '24h', label: '最近24小时' },
                { value: '7d', label: '最近7天' },
                { value: '30d', label: '最近30天' },
                { value: '90d', label: '最近90天' },
              ]}
            />
          </div>
          <div className="sm:w-36">
            <ChoiceSelect
              label="时间依据"
              value={dateField}
              onValueChange={(value) => setFilter('dateField', value)}
              options={[
                { value: 'published', label: '原始发布时间' },
                { value: 'collected', label: '收集时间' },
              ]}
            />
          </div>
          <div className="sm:w-40">
            <ChoiceSelect
              label="行业"
              value={filters.vertical ?? 'all'}
              onValueChange={(value) => setFilter('vertical', value)}
              options={[
                { value: 'all', label: '全部行业' },
                ...verticalOptions,
              ]}
            />
          </div>
          <div className="sm:w-40">
            <ChoiceSelect
              label="按负责人筛选"
              value={filters.owner ?? 'all'}
              onValueChange={(value) => setFilter('owner', value)}
              options={[
                { value: 'all', label: '全部负责人' },
                { value: 'unassigned', label: '未分配' },
                ...(filters.owner &&
                filters.owner !== 'unassigned' &&
                !assignees.data?.some((member) => member.id === filters.owner)
                  ? [{ value: filters.owner, label: '已选负责人（不可分配）' }]
                  : []),
                ...(assignees.data ?? []).map((member) => ({
                  value: member.id,
                  label: member.name,
                })),
              ]}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="搜索情报"
              placeholder="搜索标题、摘要或跟进负责人…"
              className="pl-8"
              value={search}
              onChange={(e) => setFilter('search', e.target.value)}
            />
          </div>
          {view === 'history' && (
            <Select
              value={category || 'all'}
              onValueChange={(value) => setFilter('category', value)}
            >
              <SelectTrigger
                aria-label="按类型筛选"
                className="w-auto min-w-32"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={4}>
                <SelectItem value="all">全部类型</SelectItem>
                {Object.entries(categoryLabels).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {view === 'history' && (
            <Select
              value={status || 'all'}
              onValueChange={(value) => setFilter('status', value)}
            >
              <SelectTrigger
                aria-label="按状态筛选"
                className="w-auto min-w-32"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={4}>
                <SelectItem value="all">全部状态</SelectItem>
                {Object.entries(statusLabel).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {params.size > 0 &&
            [...params.keys()].some(
              (key) => !['item', 'product', 'view'].includes(key),
            ) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setParams({
                    view,
                    ...(selectedId ? { item: selectedId } : {}),
                    ...(filters.product ? { product: filters.product } : {}),
                  })
                }
              >
                清除筛选
              </Button>
            )}
        </div>
        <p className="text-xs text-muted-foreground">
          {dateField === 'published'
            ? '按原始发布时间排列。限定时间范围时，仅显示有原始日期的情报。'
            : '按收集时间排列。'}
        </p>
      </FilterBar>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !query.data.length ? (
        <EmptyState
          title={view === 'today' ? '当前范围暂无已核实情报' : '没有匹配的情报'}
          description={
            view === 'today'
              ? '可切换到行业资讯或全部记录，查看其他日期的情报。'
              : '试试调整筛选条件。'
          }
        />
      ) : (
        <Card className="gap-0 overflow-hidden py-0 shadow-none">
          <Table className="min-w-[1080px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">名称 / 任务</TableHead>
                <TableHead>产品 · 市场</TableHead>
                <TableHead>渠道 / 类型</TableHead>
                <TableHead>进展 / 表现</TableHead>
                <TableHead>负责人</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="pr-5 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((item) => (
                <IntelligenceRow
                  key={item.id}
                  item={item}
                  dateField={dateField}
                  writable={writable}
                  onDetail={() => setSelected(item)}
                  onStatus={(next) =>
                    update.mutate({ id: item.id, status: next })
                  }
                  updating={update.isPending}
                />
              ))}
            </TableBody>
          </Table>
          <div className="border-t px-5 py-3 text-xs text-muted-foreground">
            显示最新 {query.data.length} 条 · 最多 100 条
          </div>
        </Card>
      )}
      <Dialog
        open={Boolean(selectedId)}
        onOpenChange={(value) => {
          if (!value) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
          {detail.isPending && selectedId && (
            <>
              <DialogHeader>
                <DialogTitle>情报详情</DialogTitle>
                <DialogDescription className="sr-only">
                  正在加载情报
                </DialogDescription>
              </DialogHeader>
              <Loading />
            </>
          )}
          {detail.error && (
            <>
              <DialogHeader>
                <DialogTitle>情报详情</DialogTitle>
                <DialogDescription className="sr-only">
                  加载失败
                </DialogDescription>
              </DialogHeader>
              <ErrorState error={detail.error} />
            </>
          )}
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="leading-7">
                  {selected.title}
                </DialogTitle>
                <DialogDescription>
                  <ProductName id={selected.product} /> · {selected.market} ·{' '}
                  {dateTime(selected.createdAt)}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap gap-2">
                <Badge variant="info">
                  {categoryLabels[selected.category]}
                </Badge>
                {selected.metadata?.claimType && (
                  <Badge variant="neutral">
                    {claimTypeLabels[selected.metadata.claimType]}
                  </Badge>
                )}
                <Badge variant={statusVariant[selected.status]}>
                  {statusLabel[selected.status]}
                </Badge>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-7">
                {selected.summary}
              </p>
              <InformationTimes
                primaryUrl={selected.sourceUrl}
                value={selected.metadata ?? { publishedAt: null }}
                collectedAt={selected.createdAt}
              />
              {selected.metadata?.suggestedAction && (
                <div className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">建议行动</p>
                  <p className="mt-1 whitespace-pre-wrap">
                    {selected.metadata.suggestedAction}
                  </p>
                </div>
              )}
              <a
                className="flex w-fit items-center gap-2 break-all text-sm underline underline-offset-4"
                href={selected.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="size-4 shrink-0" />
                查看原始来源
              </a>
              <EvidenceAndTasks id={selected.id} writable={writable} />
              {writable && (
                <div className="mt-3 flex flex-wrap justify-end gap-2 border-t pt-4">
                  {selected.status !== 'pending' && (
                    <Button
                      variant="outline"
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate({ id: selected.id, status: 'pending' })
                      }
                    >
                      恢复待确认
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={
                      update.isPending || selected.status === 'irrelevant'
                    }
                    onClick={() =>
                      update.mutate({ id: selected.id, status: 'irrelevant' })
                    }
                  >
                    标记不相关
                  </Button>
                  <Button
                    disabled={
                      update.isPending || selected.status === 'verified'
                    }
                    onClick={() =>
                      update.mutate({ id: selected.id, status: 'verified' })
                    }
                  >
                    确认有效
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function IntelligenceRow({
  item,
  dateField,
  writable,
  onDetail,
  onStatus,
  updating,
}: {
  item: IntelligenceListItem;
  dateField: 'published' | 'collected';
  writable: boolean;
  onDetail: () => void;
  onStatus: (status: string) => void;
  updating: boolean;
}) {
  const tasks = item.taskSummary;
  const channels = [...new Set(tasks.map((task) => task.channel))];
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const latestResult = tasks.find((task) => task.result)?.result;
  return (
    <TableRow>
      <TableCell className="w-[28%] min-w-64 max-w-96 py-4 pl-5 whitespace-normal">
        <button
          className="text-left font-medium hover:underline"
          onClick={onDetail}
        >
          {item.title}
        </button>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
          {item.summary}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {dateField === 'collected'
            ? `收集于 ${dateTime(item.createdAt)}`
            : `发布时间 ${item.metadata?.publishedAt ? informationDateLabel(item.metadata.publishedAt) : '未知'}`}
        </p>
        {tasks.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {tasks.map((task) => (
              <Link
                key={task.id}
                to={`/tasks?task=${task.id}`}
                className="line-clamp-1 text-xs text-primary hover:underline"
              >
                {task.kind === 'content' ? '选题' : '建联'}：{task.title}
              </Link>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="text-xs">
        <p>
          <ProductName id={item.product} />
        </p>
        <p className="mt-1 text-muted-foreground">
          {marketLabels[item.market]}
        </p>
      </TableCell>
      <TableCell className="max-w-36 whitespace-normal">
        <Badge variant="info">{categoryLabels[item.category]}</Badge>
        {item.metadata?.vertical && (
          <p className="mt-1 text-xs text-muted-foreground">
            {verticalLabels[item.metadata.vertical]}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {channels.join('、') || '暂无执行渠道'}
        </p>
      </TableCell>
      <TableCell className="min-w-40 max-w-56 whitespace-normal">
        <ScoreSummary score={item.scoring} />
        <p className="mt-2 text-xs text-muted-foreground">
          {tasks.length
            ? `关联任务 ${tasks.length} · 完成 ${completed}`
            : '尚未转任务'}
        </p>
        {latestResult && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            结果：{latestResult}
          </p>
        )}
      </TableCell>
      <TableCell className="min-w-28 max-w-40 whitespace-normal">
        <p className="text-sm">{item.owner?.name ?? '未分配'}</p>
        {item.owner &&
          (item.owner.disabled ||
            !['admin', 'operator'].includes(item.owner.role)) && (
            <p className="mt-1 text-xs text-muted-foreground">当前不可分配</p>
          )}
        {writable && (
          <button
            className="mt-2 text-xs text-primary hover:underline"
            onClick={onDetail}
          >
            {item.ownerId ? '更换负责人' : '分配负责人'}
          </button>
        )}
      </TableCell>
      <TableCell className="min-w-28">
        <Badge variant={statusVariant[item.status]}>
          {statusLabel[item.status]}
        </Badge>
        {tasks.length > 0 && (
          <div className="mt-2 space-y-1">
            {tasks.map((task) => (
              <p key={task.id} className="text-xs text-muted-foreground">
                {task.kind === 'content' ? '选题' : '建联'} ·{' '}
                {taskStatusLabels[task.status]}
              </p>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="pr-5 text-right">
        <div className="flex flex-col items-end gap-1">
          <Button size="sm" variant="ghost" onClick={onDetail}>
            查看详情
          </Button>
          {writable && item.status === 'pending' && (
            <Button
              size="sm"
              variant="ghost"
              disabled={updating}
              onClick={() => onStatus('verified')}
            >
              确认有效
            </Button>
          )}
          {writable && item.status === 'verified' && (
            <Button size="sm" variant="ghost" onClick={onDetail}>
              {tasks.length ? '查看 / 新建任务' : '转为任务'}
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
