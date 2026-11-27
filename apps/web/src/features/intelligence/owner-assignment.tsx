import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Assignee, IntelligenceListItem } from '@guangmo/contracts';
import { api } from '@/lib/api';
import { ChoiceSelect } from '@/components/choice-select';
import { Label } from '@/components/ui/label';
export const intelligenceAssigneesQuery = {
  queryKey: ['intelligence-assignees'],
  queryFn: () => api<Assignee[]>('/intelligence/assignees'),
};
export function OwnerAssignment({
  item,
  writable,
}: {
  item: IntelligenceListItem;
  writable: boolean;
}) {
  const client = useQueryClient();
  const members = useQuery({
    queryKey: ['intelligence-assignees', item.product],
    queryFn: () =>
      api<Assignee[]>(
        `/intelligence/assignees?product=${encodeURIComponent(item.product)}`,
      ),
    enabled: writable,
  });
  const update = useMutation({
    mutationFn: (ownerId: string | null) =>
      api(`/intelligence/${item.id}/owner`, {
        method: 'PATCH',
        body: JSON.stringify({ ownerId, revision: item.ownerRevision }),
      }),
    onSuccess: () => {
      toast.success('跟进负责人已更新');
      void client.invalidateQueries({ queryKey: ['intelligence'] });
      void client.invalidateQueries({
        queryKey: ['intelligence-detail', item.id],
      });
    },
    onError: (error) => {
      toast.error(error.message);
      void client.invalidateQueries({ queryKey: ['intelligence'] });
      void client.invalidateQueries({
        queryKey: ['intelligence-detail', item.id],
      });
    },
  });
  const eligible = members.data ?? [];
  const currentUnavailable =
    !!item.ownerId && !eligible.some((member) => member.id === item.ownerId);
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Label htmlFor={`owner-${item.id}`}>情报跟进负责人</Label>
      {writable ? (
        <ChoiceSelect
          id={`owner-${item.id}`}
          label="情报跟进负责人"
          value={item.ownerId ?? 'unassigned'}
          disabled={update.isPending || members.isPending || !!members.error}
          onValueChange={(value) =>
            update.mutate(value === 'unassigned' ? null : value)
          }
          options={[
            { value: 'unassigned', label: '未分配' },
            ...(currentUnavailable
              ? [
                  {
                    value: item.ownerId!,
                    label: `${item.owner?.name ?? '原负责人'}（当前不可分配）`,
                  },
                ]
              : []),
            ...eligible.map((member) => ({
              value: member.id,
              label: member.name,
            })),
          ]}
        />
      ) : (
        <p className="text-sm">{item.owner?.name ?? '未分配'}</p>
      )}
      {members.error && writable && (
        <p role="alert" className="text-xs text-destructive">
          成员列表加载失败。
          <button
            className="ml-1 underline"
            onClick={() => void members.refetch()}
          >
            重试
          </button>
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        负责筛选和跟进这条情报，各任务执行负责人可单独指定。
      </p>
    </div>
  );
}
