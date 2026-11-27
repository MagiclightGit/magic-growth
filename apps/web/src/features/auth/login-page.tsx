import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { memberQuery } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  const client = useQueryClient();
  const member = useQuery(memberQuery);
  if (member.data) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError('');
    const data = new FormData(e.currentTarget);
    try {
      const result = await authClient.signIn.email({
        email: String(data.get('email')),
        password: String(data.get('password')),
      });
      if (result.error) {
        setError('邮箱或密码不正确，或账号暂不可用');
        return;
      }
      await client.invalidateQueries({ queryKey: ['me'] });
      navigate('/');
    } catch {
      setError('暂时无法连接，请稍后重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[380px] rounded-lg border bg-card p-6 sm:p-7">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
            光
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight text-foreground">
              光魔增长
            </h1>
            <p className="text-xs text-muted-foreground">团队内部账号登录</p>
          </div>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs text-foreground">
              工作邮箱
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="name@company.com"
              className="h-9"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs text-foreground">
              密码
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              className="h-9"
              required
            />
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-md bg-status-danger-bg px-3 py-2 text-xs text-status-danger-fg"
            >
              {error}
            </p>
          )}
          <Button size="lg" className="w-full" disabled={pending}>
            {pending && <LoaderCircle className="size-4 animate-spin" />}
            登录工作台
          </Button>
        </form>
        <p className="mt-5 border-t pt-4 text-center text-xs text-muted-foreground">
          仅限团队内部成员使用，开通账号或重置密码请联系管理员。
        </p>
      </div>
    </main>
  );
}
