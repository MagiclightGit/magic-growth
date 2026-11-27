import { ProductGrants } from './product-grants';
import { useProducts } from '@/features/products/product-context';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { memberQuery, type Member } from '@/lib/queries';
import { api, post } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageHeading, Loading, ErrorState } from '@/components/page-state';
const roleLabel = { admin: '管理员', operator: '运营', viewer: '只读' };
export default function MembersPage() {
  const { products } = useProducts();
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const member = useQuery(memberQuery);
  const q = useQuery({
    queryKey: ['members'],
    queryFn: () => api<Member[]>('/members'),
    enabled: member.data?.role === 'admin',
  });
  const create = useMutation({
    mutationFn: (body: unknown) => post('/members', body),
    onSuccess: () => {
      setOpen(false);
      void client.invalidateQueries({ queryKey: ['members'] });
      toast.success('成员已开通，请通过安全渠道交付初始密码');
    },
    onError: (e) => toast.error(e.message),
  });
  if (member.data?.role !== 'admin')
    return <ErrorState error={new Error('仅管理员可管理成员')} />;
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    create.mutate({
      ...Object.fromEntries(form),
      productIds: form.getAll('productIds'),
    });
  }
  return (
    <>
      <PageHeading
        title="团队成员"
        description="管理成员与访问权限。"
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4" />
                开通成员
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>开通成员</DialogTitle>
                <DialogDescription>
                  初始密码至少 12 位，请通过安全渠道交付。
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="member-name">姓名</Label>
                  <Input id="member-name" name="name" maxLength={80} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="member-email">邮箱</Label>
                  <Input id="member-email" name="email" type="email" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="member-password">初始密码</Label>
                  <Input
                    id="member-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="member-role">角色</Label>
                  <Select name="role" defaultValue="viewer">
                    <SelectTrigger id="member-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" sideOffset={4}>
                      {Object.entries(roleLabel).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <fieldset className="space-y-2">
                  <legend className="mb-2 text-sm font-medium">
                    授权产品（管理员可访问全部产品）
                  </legend>
                  {products.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input type="checkbox" name="productIds" value={p.id} />
                      {p.name}
                    </label>
                  ))}
                </fieldset>
                <Button disabled={create.isPending}>开通账号</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <Card className="overflow-hidden py-0 shadow-none">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">成员</TableHead>
                <TableHead>邮箱</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>产品权限</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="py-4 pl-5 font-medium">
                    {user.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {user.email}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{roleLabel[user.role]}</Badge>
                  </TableCell>
                  <TableCell>
                    <ProductGrants
                      id={user.id}
                      name={user.name}
                      admin={user.role === 'admin'}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
