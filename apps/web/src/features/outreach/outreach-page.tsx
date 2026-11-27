import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  canWrite,
  creatorInput,
  type Creator,
  type CsvBatch,
  type CsvRow,
  type OutreachMailbox,
} from '@guangmo/contracts';
import {
  PageHeading,
  FilterBar,
  EmptyState,
  ErrorState,
  Loading,
} from '@/components/page-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useProducts } from '@/features/products/product-context';
import { api, dateTime, post } from '@/lib/api';
import { memberQuery } from '@/lib/queries';
import { CreatorDetail, MailboxStatus } from './outreach-mail';

export default function OutreachPage() {
  const { active, product } = useProducts();
  const member = useQuery(memberQuery);
  const writable =
    !!member.data &&
    canWrite(member.data.role) &&
    active.some((row) => row.id === product);
  const admin = member.data?.role === 'admin';
  const [params, setParams] = useSearchParams();
  const creatorId = params.get('creator');
  const batchId = params.get('batch');
  const [form, setForm] = useState<'link' | 'csv' | null>(null);
  const base = `/outreach/${product}`;
  const list = useInfiniteQuery({
    queryKey: ['outreach-creators', product],
    queryFn: ({ pageParam }) =>
      api<Creator[]>(
        `${base}/creators${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (page) =>
      page.length === 50 ? page.at(-1)?.id : undefined,
    enabled: !!product,
  });
  const mailbox = useQuery({
    queryKey: ['outreach-mailbox'],
    queryFn: () => api<OutreachMailbox>('/outreach/mailbox'),
    refetchInterval: 10000,
  });
  const batch = useQuery({
    queryKey: ['outreach-batch', product, batchId],
    queryFn: () =>
      api<CsvBatch>(`${base}/batches/${encodeURIComponent(batchId ?? '')}`),
    enabled: !!product && !!batchId,
  });
  const client = useQueryClient();
  function showDetail(key: 'creator' | 'batch', id?: string) {
    const next = new URLSearchParams(params);
    next.delete('batch');
    next.delete('creator');
    if (id) next.set(key, id);
    setParams(next);
    setForm(null);
    window.scrollTo(0, 0);
  }
  const refresh = () =>
    void client.invalidateQueries({ queryKey: ['outreach-creators', product] });
  const rows = list.data?.pages.flat() ?? [];

  return (
    <div className="min-w-0 space-y-3">
      <PageHeading
        title="创作者建联"
        description="管理产品下的创作者资源与 Gmail 试接记录。"
        action={
          <Button variant="outline" asChild>
            <Link to={product ? `/tasks?product=${product}` : '/tasks'}>
              建联任务
            </Link>
          </Button>
        }
      />
      {mailbox.data && <MailboxStatus mailbox={mailbox.data} admin={admin} />}
      {mailbox.error && (
        <ErrorState
          error={mailbox.error}
          retry={() => void mailbox.refetch()}
        />
      )}
      {!product ? (
        <EmptyState
          title="请选择产品"
          description="使用页面顶部的产品切换器查看对应创作者。"
        />
      ) : (
        <>
          <FilterBar className="mb-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-sm font-semibold">创作者资源</h2>
              {writable ? (
                <>
                  <Button
                    variant={form === 'link' ? 'secondary' : 'default'}
                    aria-expanded={form === 'link'}
                    onClick={() => setForm(form === 'link' ? null : 'link')}
                  >
                    手动录入
                  </Button>
                  <Button
                    variant={form === 'csv' ? 'secondary' : 'outline'}
                    aria-expanded={form === 'csv'}
                    onClick={() => setForm(form === 'csv' ? null : 'csv')}
                  >
                    导入 CSV
                  </Button>
                </>
              ) : (
                <Badge variant="neutral">只读</Badge>
              )}
            </div>
          </FilterBar>
          {writable && form === 'link' && (
            <CreatorForm
              base={base}
              onSaved={(id) => {
                refresh();
                showDetail('creator', id);
              }}
            />
          )}
          {writable && form === 'csv' && (
            <ImportForm
              base={base}
              onSaved={(id) => {
                refresh();
                showDetail('batch', id);
              }}
            />
          )}
          {creatorId && (
            <CreatorDetail
              key={creatorId}
              base={base}
              id={creatorId}
              mailbox={mailbox.data}
              writable={writable}
              admin={admin}
              onClose={() => showDetail('creator')}
              onBatch={(id) => showDetail('batch', id)}
            />
          )}
          {batchId && (
            <section
              className="min-w-0 rounded-lg border bg-card p-3"
              aria-label="导入批次"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="min-w-0 text-sm font-semibold break-all">
                  {batch.data?.filename ?? '导入批次'}
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => showDetail('batch')}
                >
                  关闭批次
                </Button>
              </div>
              {batch.isPending && <Loading />}
              {batch.error && <ErrorState error={batch.error} />}
              {batch.data && (
                <>
                  <p className="mb-2 text-xs text-muted-foreground">
                    {dateTime(batch.data.createdAt)}
                  </p>
                  <ImportRows
                    rows={batch.data.rows}
                    onCreator={(id) => showDetail('creator', id)}
                  />
                </>
              )}
            </section>
          )}
          {list.isPending && <Loading />}
          {list.error && (
            <ErrorState error={list.error} retry={() => void list.refetch()} />
          )}
          {list.isSuccess &&
            (rows.length ? (
              <section
                className="min-w-0 rounded-lg border bg-card"
                aria-label="创作者列表"
              >
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="bg-muted/60">
                      <TableHead className="w-1/2">创作者</TableHead>
                      <TableHead>来源</TableHead>
                      <TableHead>邮箱</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-normal">
                          <Button
                            className="h-auto max-w-full justify-start px-0 text-left whitespace-normal break-all"
                            size="sm"
                            variant="link"
                            onClick={() => showDetail('creator', row.id)}
                          >
                            {row.name || row.link}
                          </Button>
                        </TableCell>
                        <TableCell>
                          {row.batchId ? 'CSV' : '手动录入'}
                        </TableCell>
                        <TableCell>
                          {row.email ? (
                            <Badge variant="warning">未核验</Badge>
                          ) : (
                            <span className="text-muted-foreground">
                              未填写
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">已显示 {rows.length} 条</span>
                  {list.hasNextPage && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={list.isFetchingNextPage}
                      onClick={() => void list.fetchNextPage()}
                    >
                      加载更多
                    </Button>
                  )}
                </div>
              </section>
            ) : (
              <EmptyState
                title="暂无创作者"
                description={
                  writable
                    ? '手动录入链接或通过 CSV 导入。'
                    : '有写权限的成员录入后可在此查看。'
                }
              />
            ))}
        </>
      )}
    </div>
  );
}

function CreatorForm({
  base,
  onSaved,
}: {
  base: string;
  onSaved: (id: string) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (input: ReturnType<typeof creatorInput.parse>) =>
      post<{ creator: Creator; duplicate: boolean }>(base + '/creators', input),
    onSuccess: ({ creator, duplicate }) => {
      if (duplicate) setErrors({ link: '产品内已有该链接' });
      else onSaved(creator.id);
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = creatorInput.safeParse(values);
    setErrors(
      parsed.success
        ? {}
        : Object.fromEntries(
            parsed.error.issues.map((issue) => [
              issue.path[0],
              issue.path[0] === 'email' ? '邮箱格式无效' : issue.message,
            ]),
          ),
    );
    if (parsed.success) save.mutate(parsed.data);
  }
  return (
    <form
      noValidate
      onSubmit={submit}
      className="grid min-w-0 gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2"
    >
      {[
        { name: 'link', title: '创作者链接', required: true, type: 'url' },
        { name: 'name', title: '创作者名称', required: false, type: 'text' },
        {
          name: 'email',
          title: '邮箱（录入后为未核验）',
          required: false,
          type: 'email',
        },
      ].map(({ name, title, required, type }) => (
        <div
          key={name}
          className={name === 'link' ? 'sm:col-span-2' : undefined}
        >
          <label
            className="mb-1 block text-xs font-medium"
            htmlFor={`creator-${name}`}
          >
            {title}
          </label>
          <Input
            id={`creator-${name}`}
            name={name}
            required={required}
            type={type}
            aria-invalid={!!errors[name]}
            aria-describedby={errors[name] ? `error-${name}` : undefined}
            onChange={() => {
              if (errors[name])
                setErrors((current) => ({ ...current, [name]: '' }));
            }}
          />
          {errors[name] && (
            <p
              id={`error-${name}`}
              role="alert"
              className="mt-1 text-xs text-status-danger-fg"
            >
              {errors[name]}
            </p>
          )}
        </div>
      ))}
      {save.error && (
        <p role="alert" className="text-xs text-status-danger-fg sm:col-span-2">
          {save.error.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button disabled={save.isPending} type="submit">
          保存创作者
        </Button>
        {save.data?.duplicate && (
          <Button
            type="button"
            variant="outline"
            onClick={() => onSaved(save.data.creator.id)}
          >
            查看已有记录
          </Button>
        )}
      </div>
    </form>
  );
}

function ImportForm({
  base,
  onSaved,
}: {
  base: string;
  onSaved: (id: string) => void;
}) {
  const [file, setFile] = useState<File>();
  const preview = useMutation({
    mutationFn: async (selected: File) => {
      if (selected.size > 48000) throw new Error('CSV 最大支持 48 KB');
      const csv = new TextDecoder('utf-8', { fatal: true }).decode(
        await selected.arrayBuffer(),
      );
      const input = { filename: selected.name, csv };
      const result = await post<{ rows: CsvRow[] }>(
        base + '/batches/preview',
        input,
      );
      return { ...result, input };
    },
  });
  const confirm = useMutation({
    mutationFn: (input: { filename: string; csv: string }) =>
      post<CsvBatch>(base + '/batches', input),
    onSuccess: (batch) => onSaved(batch.id),
  });
  const error = preview.error ?? confirm.error;
  const busy = preview.isPending || confirm.isPending;
  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border bg-card p-3"
      aria-label="导入创作者"
    >
      <div className="flex flex-wrap items-center gap-2">
        <a
          className="text-[13px] text-primary underline"
          download="creators.csv"
          href="data:text/csv;charset=utf-8,link%2Cname%2Cemail%0D%0A"
        >
          下载 CSV 模板
        </a>
        <span className="text-xs text-muted-foreground" id="csv-limit">
          UTF-8，最多 500 条，48 KB
        </span>
      </div>
      <label htmlFor="creator-csv" className="block text-xs font-medium">
        选择 CSV 文件
      </label>
      <Input
        id="creator-csv"
        type="file"
        accept=".csv,text/csv"
        aria-describedby="csv-limit"
        disabled={busy}
        onChange={(event) => {
          setFile(event.currentTarget.files?.[0]);
          preview.reset();
          confirm.reset();
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!file || busy}
          variant="outline"
          onClick={() => file && preview.mutate(file)}
        >
          预览校验
        </Button>
        {preview.data && (
          <Button
            disabled={busy}
            onClick={() => confirm.mutate(preview.data.input)}
          >
            确认导入
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-status-danger-fg">
          {error.message}
        </p>
      )}
      {preview.data && <ImportRows rows={preview.data.rows} />}
    </section>
  );
}

const csvStatus = {
  valid: ['可导入', 'info'],
  created: ['已新增', 'success'],
  duplicate: ['重复', 'warning'],
  failed: ['失败', 'danger'],
} as const;

function ImportRows({
  rows,
  onCreator,
}: {
  rows: CsvRow[];
  onCreator?: (id: string) => void;
}) {
  const count = (status: CsvRow['status']) =>
    rows.filter((row) => row.status === status).length;
  return (
    <>
      <p
        className="mb-2 text-xs text-muted-foreground tabular-nums"
        role="status"
      >
        {onCreator ? `新增 ${count('created')}` : `可导入 ${count('valid')}`} ·
        重复 {count('duplicate')} · 失败 {count('failed')}
      </p>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="bg-muted/60">
            <TableHead className="w-12">行号</TableHead>
            <TableHead className="w-20">状态</TableHead>
            <TableHead>链接与原因</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.line}>
              <TableCell className="tabular-nums">{row.line}</TableCell>
              <TableCell>
                <Badge variant={csvStatus[row.status][1]}>
                  {csvStatus[row.status][0]}
                </Badge>
              </TableCell>
              <TableCell className="whitespace-normal break-all">
                {row.creatorId && onCreator ? (
                  <button
                    type="button"
                    className="text-left break-all text-primary underline"
                    onClick={() => onCreator(row.creatorId!)}
                  >
                    {row.link}
                  </button>
                ) : (
                  row.link
                )}
                {row.reason && (
                  <div className="text-xs text-muted-foreground">
                    {row.reason}
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
