import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Product } from '@guangmo/contracts';
import { useProducts } from './product-context';
import { memberQuery } from '@/lib/queries';
import { api, post } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { PageHeading, EmptyState } from '@/components/page-state';
export default function ProductsPage() {
  const { products, refresh } = useProducts();
  const member = useQuery(memberQuery);
  const admin = member.data?.role === 'admin';
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const save = useMutation({
    mutationFn: (body: unknown) =>
      editing
        ? api(`/products/${editing.id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          })
        : post('/products', body),
    onSuccess: () => {
      setEditing(undefined);
      refresh();
      toast.success('产品已保存');
    },
    onError: (e) => toast.error(e.message),
  });
  const archive = useMutation({
    mutationFn: (p: Product) =>
      api(`/products/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: !p.archived }),
      }),
    onSuccess: () => {
      refresh();
      toast.success('产品状态已更新');
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <PageHeading
        title="产品目录"
        description={
          admin
            ? '管理团队产品，并在团队成员中分配访问权限。'
            : '你有权访问的产品。'
        }
        action={
          admin && <Button onClick={() => setEditing(null)}>新增产品</Button>
        }
      />
      {!products.length ? (
        <EmptyState
          title="暂无可访问的产品"
          description="请联系管理员开通产品权限。"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {products.map((p) => (
            <Card key={p.id} className="gap-3 p-5 shadow-none">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-medium">{p.name}</h2>
                {p.archived && <Badge variant="outline">已归档</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">{p.id}</p>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {p.description || '暂无产品简介'}
              </p>
              {admin && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(p)}
                  >
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={archive.isPending}
                    onClick={() => archive.mutate(p)}
                  >
                    {p.archived ? '恢复产品' : '归档产品'}
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? '编辑产品' : '新增产品'}</DialogTitle>
            <DialogDescription>
              归档后可查阅历史记录，暂停新研究与新任务。
            </DialogDescription>
          </DialogHeader>
          <form
            key={editing?.id ?? 'new'}
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const body = Object.fromEntries(new FormData(e.currentTarget));
              if (editing) delete body.id;
              save.mutate(body);
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="product-id">产品标识</Label>
              <Input
                id="product-id"
                name="id"
                defaultValue={editing?.id}
                disabled={!!editing}
                pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
                maxLength={64}
                placeholder="例如：NewProduct"
                required
              />
              <p className="text-xs text-muted-foreground">
                创建后固定，用于关联历史记录。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-name">产品名称</Label>
              <Input
                id="product-name"
                name="name"
                defaultValue={editing?.name}
                required
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-description">产品简介</Label>
              <Textarea
                id="product-description"
                name="description"
                defaultValue={editing?.description}
                maxLength={2000}
              />
            </div>
            <Button disabled={save.isPending}>保存产品</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
