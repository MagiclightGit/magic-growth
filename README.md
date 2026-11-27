# 光魔增长 · Guangmo Growth

面向内部增长团队的情报与协作工作台。首期建设基础框架与信息采集，后续扩展渠道、商户跟进和产品增长数据。

**当前已搭好可运行的工程基础，并完成真实登录、权限、手工情报入库及独立 Worker 联调。本机已接入 Codex 同款第三方中转配置，真实模型、Web Search 及 API → Redis → Worker → 报告落库联调均已通过；结构化情报自动入库和每日情报摘要尚未完成。**

## 本地使用

项目目录：`~/Projects/guangmo-growth`，已从 `untitled folder` 更名。需要 Node 24、pnpm 10.32.1、Docker。

本机已安装依赖、生成本地 `.env`、启动 PostgreSQL/Redis 并执行迁移。创建自己的首个管理员后即可使用：

```bash
cd ~/Projects/guangmo-growth
# macOS 使用 Homebrew Node 24 时：
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
pnpm admin:create
pnpm dev
```

访问 <http://localhost:5173>。首位管理员通过交互命令初始化，密码输入隐藏；后续成员由管理员在工作台开通，不开放自助注册。本次验证创建的账号和业务记录会清理，项目不附带默认密码或演示经营数据。

新机器首次安装、环境变量、数据库迁移与开发约定见 [开发说明](./docs/development.md)。

## 工程结构

```text
apps/web          React + Vite，业务 features、shadcn/ui、AI Elements
apps/api          NestJS，按认证 / 成员 / 情报 / 研究组织业务模块
apps/worker       独立研究进程、队列消费、失败重试、每日调度
packages/contracts  Zod 输入校验、共享接口类型
packages/database   PostgreSQL + Drizzle Schema 与版本迁移
packages/agent      AI SDK ToolLoopAgent、Web Search
```

采用 pnpm workspace + Turborepo、严格 TypeScript、ESLint、Prettier、Vitest 与 GitHub Actions 配置。前端路由按业务懒加载，服务端数据由 TanStack Query 管理；共享包单向被应用引用，后台长任务与 HTTP 请求分开部署。当前为单团队工作空间。

## 当前可用

- shadcn Dashboard 风格工作台、移动端导航、深浅色、加载/错误/空状态。
- Better Auth 邮箱密码登录、退出、管理员开通成员、admin/operator/viewer 服务端权限。
- 情报录入、列表、详情、标题/摘要搜索、类型/审核状态筛选、来源链接、人工确认与不相关标记。
- PostgreSQL 持久化、同产品规范 URL 去重、部分关键操作事务审计、版本化迁移。
- Agent 研究页面、AI Elements 过程展示、团队共享运行与报告；无模型配置时禁用入口并给出准确状态；本机已配置并通过实际调用验证。
- BullMQ + Redis + 独立 Worker、待入队记录补偿、并发限制、有限重试、每日时区调度代码。

真实 AI 搜索与手动研究后台执行已在本机验证；每日计划已通过真实时钟触发、退出登录后完成报告与候选整理、暂停/恢复和权限检查。当前报告与人工情报库分别存储，Agent 不会自动将报告变成已审核情报。已实现候选审核、多来源依据和任务闭环；CSV、来源管理、业务记忆、取消与研究内部阶段恢复见 TODO。

## 检查与文档

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
# 需 API、Worker、PostgreSQL、Redis 正在运行，仅用于隔离测试环境
pnpm test:smoke
```

所有集成测试必须在隔离测试环境中运行。
集成脚本验证真实登录、关闭注册、成员权限、去重、跨成员可见性和退出；未配置模型时还验证真实 Redis 投递与 Worker 重试失败，结束后清理临时记录。真实模型与搜索另做了显式调用验证；每日调度另有真实时钟自测（`SCHEDULE_REAL_MODEL=1 pnpm test:schedules`，会调用收费模型）；这些结果不代表已完成生产上线验收。

- [开发与启动说明](./docs/development.md)
- [开发 TODO 与首期验收](./TODO.md)
- [Agent 架构决策](./docs/agent-architecture.md)：完整设计目标，部分待实现。
- [产品梳理](./docs/product-brief.md)
- [原始能力文档快照](./docs/references/demo-document-20261116.txt)
- [在线 Demo](https://guangmo-growth-demo-20261112.maverick-yan-9925.chatgpt.site/) · [能力产品文档](https://guangmo-growth-demo-20261112.maverick-yan-9925.chatgpt.site/document?v=20261116-final)

项目名沿用 Demo「光魔增长」品牌，仓库名与根包名统一为 `magic-growth`（`git@github.com:MagiclightGit/magic-growth.git`）。维护日期：2026-11-27。

研究到任务的操作与扩展说明见 [信息采集工作流](./docs/collection-workflow.md)。新研究自动整理候选，审核后可入库并创建选题/建联任务；老报告可在详情点击“整理情报”。`pnpm test:workflow` 提供不调用模型的工作流集成检查。
