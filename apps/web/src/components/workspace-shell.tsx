import { ProductWorkspace } from '@/features/products/product-context';
import { useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CheckSquare,
  Clapperboard,
  ClipboardCheck,
  Eye,
  FileText,
  Inbox,
  LayoutGrid,
  LogOut,
  Mail,
  Menu,
  Moon,
  Package,
  Search,
  Settings,
  Sun,
  Users,
} from 'lucide-react';
import { memberQuery } from '@/lib/queries';
import { authClient } from '@/lib/auth-client';
import { ApiError } from '@/lib/api';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './ui/sheet';
import { Loading, ErrorState } from './page-state';
import { cn } from '@/lib/utils';

type NavItem = {
  path: string;
  label: string;
  icon: typeof LayoutGrid;
  adminOnly?: boolean;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    title: '日常工作',
    items: [
      { path: '/', label: '工作台概览', icon: LayoutGrid },
      { path: '/briefs', label: '每日简报', icon: FileText },
      { path: '/tasks', label: '任务中心', icon: CheckSquare },
      { path: '/outreach', label: '创作者建联', icon: Mail },
    ],
  },
  {
    title: '情报与监测',
    items: [
      { path: '/intelligence', label: '情报收件箱', icon: Inbox },
      { path: '/candidates', label: '候选审核', icon: ClipboardCheck },
      { path: '/competitors', label: '竞品监控', icon: Eye },
      { path: '/dramas', label: '视频与创意参考', icon: Clapperboard },
    ],
  },
  {
    title: '研究与配置',
    items: [
      { path: '/research', label: 'Agent 研究', icon: Search },
      { path: '/schedules', label: '定时研究', icon: CalendarClock },
      { path: '/products', label: '产品目录', icon: Package },
      { path: '/settings', label: '接入与设置', icon: Settings },
      { path: '/members', label: '团队成员', icon: Users, adminOnly: true },
    ],
  },
];

const allLinks = navGroups.flatMap((group) => group.items);

const roleLabels: Record<string, string> = {
  admin: '管理员',
  operator: '运营',
  viewer: '只读',
};

function Navigation({
  admin,
  onNavigate,
}: {
  admin: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex h-12 items-center gap-2.5 border-b px-3.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
          光
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight text-foreground">
            光魔增长
          </p>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">
            增长协作工作台
          </p>
        </div>
      </div>
      <nav
        aria-label="主导航"
        className="flex-1 space-y-4 overflow-y-auto px-2.5 py-3"
      >
        {navGroups.map((group) => {
          const items = group.items.filter((item) => !item.adminOnly || admin);
          if (!items.length) return null;
          return (
            <div key={group.title}>
              <p className="mb-1 px-2 text-[11px] font-medium text-muted-foreground">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {items.map(({ path, label, icon: Icon }) => (
                  <NavLink
                    onClick={onNavigate}
                    key={path}
                    to={path}
                    end={path === '/'}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
                        isActive
                          ? 'bg-primary-soft font-medium text-primary-soft-foreground'
                          : 'text-foreground/80 hover:bg-accent hover:text-foreground',
                      )
                    }
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
    </div>
  );
}

export default function WorkspaceShell() {
  const member = useQuery(memberQuery);
  const client = useQueryClient();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(
    () => localStorage.getItem('guangmo-theme') === 'dark',
  );
  if (member.isPending) return <Loading />;
  if (
    member.error instanceof ApiError &&
    [401, 403].includes(member.error.status)
  )
    return <Navigate to="/login" replace />;
  if (member.error)
    return (
      <div className="m-6">
        <ErrorState error={member.error} retry={() => void member.refetch()} />
      </div>
    );
  if (!member.data) return null;
  const user = member.data;
  const title =
    allLinks.find((x) => x.path === location.pathname)?.label ?? '工作台';

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('guangmo-theme', next ? 'dark' : 'light');
  }

  async function signOut() {
    await authClient.signOut();
    client.clear();
    window.location.assign('/login');
  }

  return (
    <div className="min-h-svh bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-card focus:p-3"
      >
        跳到主要内容
      </a>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col border-r bg-sidebar lg:flex">
        <div className="flex-1 overflow-y-auto">
          <Navigation admin={user.role === 'admin'} />
        </div>
        <div className="border-t p-2.5">
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-xs font-medium text-primary-soft-foreground">
              {user.name.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">
                {user.name}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {user.email}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="退出登录"
              onClick={() => void signOut()}
            >
              <LogOut className="size-3.5 text-muted-foreground" />
            </Button>
          </div>
        </div>
      </aside>
      <div className="lg:ml-56">
        <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b bg-card px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="lg:hidden"
                  aria-label="打开导航"
                >
                  <Menu className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-60 p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>工作空间导航</SheetTitle>
                </SheetHeader>
                <div className="flex h-full flex-col">
                  <div className="flex-1 overflow-y-auto">
                    <Navigation
                      admin={user.role === 'admin'}
                      onNavigate={() => setOpen(false)}
                    />
                  </div>
                  <div className="border-t p-3">
                    <Button
                      className="w-full"
                      size="sm"
                      variant="outline"
                      onClick={() => void signOut()}
                    >
                      <LogOut className="size-3.5" />
                      退出登录
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              光魔增长
            </span>
            <span className="hidden text-xs text-border sm:inline">/</span>
            <span className="text-[13px] font-medium text-foreground">
              {title}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="neutral" className="hidden sm:inline-flex">
              {roleLabels[user.role] ?? user.role}
            </Badge>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleTheme}
              aria-label={dark ? '切换浅色模式' : '切换深色模式'}
            >
              {dark ? (
                <Sun className="size-4 text-muted-foreground" />
              ) : (
                <Moon className="size-4 text-muted-foreground" />
              )}
            </Button>
          </div>
        </header>
        <main
          id="main-content"
          className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6 sm:py-5"
        >
          <ProductWorkspace userId={user.id}>
            <Outlet />
          </ProductWorkspace>
        </main>
      </div>
    </div>
  );
}
