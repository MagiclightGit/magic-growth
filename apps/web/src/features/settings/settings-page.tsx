import { FeedSources } from './feed-sources';
import { useQuery } from '@tanstack/react-query';
import { Database, Layers2, Search, Workflow } from 'lucide-react';
import { integrationQuery } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeading, Loading, ErrorState } from '@/components/page-state';
export default function SettingsPage() {
  const q = useQuery(integrationQuery);
  return (
    <>
      <PageHeading title="接入与设置" description="查看服务状态。" />
      <FeedSources />
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {[
            {
              title: '数据存储',
              icon: Database,
              ready: true,
              description: '保存情报与研究报告。',
            },
            {
              title: '研究执行',
              icon: Workflow,
              ready: q.data.queueAvailable,
              description: '处理手动研究与定时研究。',
            },
            {
              title: 'AI 搜索',
              icon: Search,
              ready: q.data.agentConfigured,
              description: q.data.agentConfigured
                ? '已配置，可发起研究。'
                : '尚未配置，请联系管理员。',
            },
            {
              title: '成员登录',
              icon: Layers2,
              ready: true,
              description: '使用邮箱和密码登录。',
            },
          ].map(({ title, icon: Icon, ready, description }) => (
            <Card key={title} className="shadow-none">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Icon className="size-4" />
                  {title}
                </CardTitle>
                <Badge variant={ready ? 'secondary' : 'outline'}>
                  {ready ? '已配置' : '未接入'}
                </Badge>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-muted-foreground">
                  {description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
