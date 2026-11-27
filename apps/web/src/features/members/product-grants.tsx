import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useProducts } from '@/features/products/product-context';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Loading, ErrorState } from '@/components/page-state';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
export function ProductGrants({
  id,
  name,
  admin,
}: {
  id: string;
  name: string;
  admin: boolean;
}) {
  const [open, setOpen] = useState(false);
  return admin ? (
    <span className="text-xs text-muted-foreground">全部产品</span>
  ) : (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        产品权限
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{name} · 产品权限</DialogTitle>
            <DialogDescription>
              成员只能查看授权产品，操作能力由成员角色决定。
            </DialogDescription>
          </DialogHeader>
          {open && <GrantsForm id={id} done={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
function GrantsForm({ id, done }: { id: string; done: () => void }) {
  const { products } = useProducts();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['member-products', id],
    queryFn: () =>
      api<{ productIds: string[]; revision: number }>(
        `/members/${id}/products`,
      ),
  });
  const save = useMutation({
    mutationFn: (productIds: string[]) =>
      api(`/members/${id}/products`, {
        method: 'PATCH',
        body: JSON.stringify({ productIds, revision: query.data?.revision }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['member-products', id] });
      done();
      toast.success('产品权限已更新');
    },
    onError: (e) => {
      toast.error(e.message);
      void query.refetch();
    },
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;
  return (
    <form
      key={query.data.revision}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(
          new FormData(e.currentTarget).getAll('productIds').map(String),
        );
      }}
    >
      <div className="max-h-80 space-y-3 overflow-auto">
        {products.map((p) => (
          <label
            key={p.id}
            className="flex items-center gap-3 rounded-md border p-3 text-sm"
          >
            <input
              type="checkbox"
              name="productIds"
              value={p.id}
              defaultChecked={query.data.productIds.includes(p.id)}
            />
            {p.name}
            {p.archived ? '（已归档）' : ''}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        不勾选任何产品表示暂不开放业务数据。新增产品需另外授权。
      </p>
      <Button disabled={save.isPending}>保存权限</Button>
    </form>
  );
}
