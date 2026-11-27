import { LegacyProduct } from '@/features/products/legacy-product';
import { ProductName } from '@/features/products/product-context';
import { ProductField } from '@/features/products/product-context';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Clock3 } from 'lucide-react';
import { toast } from 'sonner';
import { canWrite } from '@guangmo/contracts';
import { memberQuery, scheduleQuery, integrationQuery } from '@/lib/queries';
import { api, post } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  EmptyState,
  Loading,
  ErrorState,
  PageHeading,
} from '@/components/page-state';
export default function SchedulesPage() {
  const [open, setOpen] = useState(false);
  const q = useQuery(scheduleQuery);
  const member = useQuery(memberQuery);
  const integrations = useQuery(integrationQuery);
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: (body: unknown) => post('/schedules', body),
    onSuccess: () => {
      setOpen(false);
      void client.invalidateQueries({ queryKey: ['schedules'] });
      toast.success('定时研究已保存');
    },
    onError: (e) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api(`/schedules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['schedules'] });
      toast.success('计划已更新');
    },
    onError: (e) => toast.error(e.message),
  });
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const [hour, minute] = String(f.get('time')).split(':').map(Number);
    create.mutate({
      goal: f.get('goal'),
      product: f.get('product'),
      hour,
      minute,
      timezone: f.get('timezone'),
    });
  }
  return (
    <>
      <PageHeading
        title="定时研究"
        description="每天自动研究你关注的话题。"
        action={
          canWrite(member.data?.role ?? 'viewer') && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button disabled={!integrations.data?.agentConfigured}>
                  <Plus className="size-4" />
                  创建计划
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>每日研究计划</DialogTitle>
                  <DialogDescription>选择每天的研究时间。</DialogDescription>
                </DialogHeader>
                <form onSubmit={submit} className="space-y-4">
                  <ProductField />
                  <div className="space-y-2">
                    <Label htmlFor="schedule-goal">研究目标</Label>
                    <Textarea
                      id="schedule-goal"
                      name="goal"
                      minLength={10}
                      maxLength={2000}
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="time">每日执行时间</Label>
                      <Input
                        id="time"
                        name="time"
                        type="time"
                        defaultValue="09:00"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="timezone">时区</Label>
                      <Input
                        id="timezone"
                        name="timezone"
                        defaultValue="Asia/Shanghai"
                        required
                      />
                    </div>
                  </div>
                  <Button disabled={create.isPending}>保存计划</Button>
                </form>
              </DialogContent>
            </Dialog>
          )
        }
      />
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : q.data.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {q.data.map((schedule) => (
            <Card key={schedule.id} className="shadow-none">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Clock3 className="size-4" />
                  每天 {String(schedule.hour).padStart(2, '0')}:
                  {String(schedule.minute).padStart(2, '0')}
                </CardTitle>
                <Badge variant="outline">
                  {schedule.enabled ? '已启用' : '已暂停'}
                </Badge>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-sm text-muted-foreground">
                  <ProductName id={schedule.product} />
                </p>
                {schedule.product === null && (
                  <LegacyProduct id={schedule.id} kind="schedules" />
                )}
                <p className="text-sm leading-6">{schedule.goal}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {schedule.timezone} · 报告保存于 Agent 研究记录
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  disabled={
                    toggle.isPending ||
                    !canWrite(member.data?.role ?? 'viewer') ||
                    (member.data?.role !== 'admin' &&
                      schedule.createdBy !== member.data?.id) ||
                    schedule.product === null
                  }
                  onClick={() =>
                    toggle.mutate({
                      id: schedule.id,
                      enabled: !schedule.enabled,
                    })
                  }
                >
                  {schedule.enabled ? '暂停计划' : '恢复计划'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          title="让团队每天都有新发现"
          description="添加计划，每天获取新发现。"
        />
      )}
    </>
  );
}
