import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ProductField } from './product-context';
import { memberQuery } from '@/lib/queries';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
export function LegacyProduct({
  id,
  kind,
}: {
  id: string;
  kind: 'research' | 'schedules';
}) {
  const member = useQuery(memberQuery);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (product: string) =>
      api(`/${kind}/${id}/product`, {
        method: 'PATCH',
        body: JSON.stringify({ product }),
      }),
    onSuccess: () => {
      void client.invalidateQueries();
      toast.success('产品归属已保存');
    },
    onError: (e) => toast.error(e.message),
  });
  if (member.data?.role !== 'admin') return null;
  return (
    <form
      className="my-4 space-y-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(String(new FormData(e.currentTarget).get('product')));
      }}
    >
      <p className="text-sm">此历史记录尚未关联产品，目前仅管理员可见。</p>
      <ProductField />
      <Button size="sm" disabled={save.isPending}>
        关联产品
      </Button>
    </form>
  );
}
