# 本地开发与工程约定

更新：2026-11-17。当前为单团队工作空间，未实现多租户隔离。

## 目录与依赖方向

```text
magic-growth/
├── apps/
│   ├── web/src/
│   │   ├── app/                 # 路由、Provider
│   │   ├── features/            # auth、overview、intelligence、research 等
│   │   ├── components/ui/       # shadcn 本地组件
│   │   ├── components/ai-elements/
│   │   └── lib/                 # HTTP、Query、认证客户端
│   ├── api/src/
│   │   ├── modules/             # 按业务划分 Controller / Service / Module
│   │   ├── platform/            # 数据库注入、校验等基础设施
│   │   ├── config/              # 启动环境校验
│   │   └── scripts/             # 首个管理员、集成验证
│   └── worker/src/              # 研究执行、重试、调度、补入队
├── packages/
│   ├── contracts/src/          # Zod 输入契约、浏览器安全类型
│   ├── database/               # Drizzle Schema、迁移及连接
│   └── agent/src/              # AI SDK ToolLoopAgent 与搜索
├── docs/                       # 产品、决策与开发说明
├── compose.yaml                # 本地 PostgreSQL / Redis
└── .github/workflows/ci.yml
```

应用依赖共享包；共享包不反向依赖应用。前端只能使用 contracts，不能引入 database 或 agent。API 不直接执行长时间研究。Worker 调用 agent 并把运行结果写回 PostgreSQL；浏览器通过 API 查询团队共享记录。数据库迁移为唯一结构变更入口。

下拉选择统一使用 `components/ui/select`（shadcn / Radix），菜单使用 Popper 定位、Portal 和视口碰撞处理。表单通过 `name` 与明确默认值保留 FormData 行为；筛选器的“全部”使用非空内部值再映射为空查询条件，避免 Radix 的空值限制。

选择 pnpm workspace + Turborepo 管理多个进程与构建依赖。现阶段维持少量清晰的包，不提前拆成微服务，也不为每个类型新建包。Nest 的模块按业务能力组织，未来新增来源、任务中心、日报时使用各自模块。

## 首次启动

安装 Node 24、pnpm 10.32.1 与 Docker。macOS 已安装 Homebrew Node 24 时可在当前终端执行 `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`。

```bash
pnpm install --frozen-lockfile
cp .env.example .env
node --input-type=module -e 'import fs from "node:fs"; import crypto from "node:crypto"; fs.appendFileSync(".env", "\nBETTER_AUTH_SECRET=" + crypto.randomBytes(32).toString("hex") + "\n");'
chmod 600 .env
pnpm infra:up
pnpm build
pnpm db:migrate
pnpm admin:create
pnpm dev
```

仅在尚无 `.env` 时复制模板；已有配置不要覆盖。本机本次初始化已完成依赖安装、凭据生成、基础设施启动及迁移；测试账号会清理，正式首个管理员请通过交互命令创建。密码输入隐藏，至少 12 位；已有管理员时 CLI 拒绝重复初始化，其他账号从网页「团队成员」开通。

工作台：<http://localhost:5173>。API：`http://127.0.0.1:3001/api`。PostgreSQL 开发端口为 55432，Redis 为 56379，避免占用常见默认端口。Compose 将数据写入命名卷；`pnpm infra:down` 不删除卷。

`pnpm dev` 启动 Vite、Nest 编译监听和 Worker 编译监听。应用自身代码支持监听更新；修改 `packages/*` 后执行 `pnpm build` 并重启 `pnpm dev`，确保所有应用使用同一份共享包产物。迁移后也应重启相关进程。

## 研究配置与当前边界

首个适配器使用 OpenAI Responses 模型与服务端 Web Search 工具。将 `OPENAI_API_KEY` 和 `RESEARCH_MODEL` 写入根目录 `.env`；使用兼容中转站时另设 `OPENAI_BASE_URL`（例如 `https://your-provider.example/v1`），留空则使用 OpenAI 默认地址。模型和中转站都必须支持 Responses 与服务端 Web Search；不要把密钥放入 `VITE_*` 变量。重启 API 和 Worker 后，页面显示配置状态。已配置只表示存在凭据，不代表已验证外部可用性；真实运行结果才是验证依据。

本机已复用 Codex 的 `packycode` 中转配置：`https://cf.api.fan/v1`、`gpt-6.1-sol`，推理强度沿用 provider 的默认 medium。密钥只保存于 gitignored 的本地 `.env`，不会随仓库分发；项目运行时不再读取 Codex 配置。2026-11-17 已验证最小文本请求、强制调用 Web Search 并返回来源，以及通过业务 API 入队、独立 Worker 搜索、保存报告和事件的完整链路（首次执行成功）。联调临时账号与报告已清理。以后更换模型、地址或密钥时需重新验证；中转站返回的 token 统计应与其账单核对，尚无费用记账功能。

每次研究限制 8 个 Agent 步骤、4000 输出 token 和 180 秒调用超时，队列并发为 2，失败最多执行 2 次。当前会保存过程事件和报告；未配置时 API 拒绝提交研究，人工情报管理仍可用。

数据库中的 queued 行充当持久化待入队记录。Worker 每 15 秒补入队并同步每日调度器；Redis 启用 AOF。BullMQ 负责作业锁及 stalled 恢复，业务报告落在 PostgreSQL。每日计划按指定 IANA 时区执行，只有创建人能暂停/恢复。关闭网页不影响存活的 Worker；本机睡眠或 Worker 停止期间不执行，不自动补齐所有错过的日历运行。

现已实现报告与候选提取之间的阶段检查点，以及候选情报经人工审核入库。尚未实现研究内部工具步骤检查点、强制取消、同一计划禁止重叠、业务记忆或独立日报。报告阶段失败会重新研究，提取阶段失败仅重试提取，均可能再次产生模型费用。供应商费用、来源质量和专项采集仍需继续验收。

## 认证与权限

Better Auth 使用 PostgreSQL 会话，邮箱密码登录，关闭公众注册。角色为 admin、operator、viewer；admin 管理成员，admin/operator 录入和审核情报及发起研究，viewer 可读。API 每次请求检查会话、角色和 disabled 状态；Worker 开始执行时复核发起人。

初始成员通过 Better Auth 的密码哈希函数保存凭据，管理员不得通过普通资料请求自行修改角色。当前成员页面提供列表和开通；停用界面、密码重置/邮件恢复、组织邀请与多实例共享登录限流待补充。现有登录限流为单 API 进程内存存储。

## 数据与验证

来源 URL 仅允许 HTTP(S)。规范化会移除 fragment、utm 参数、fbclid/gclid 并排序查询参数，保留影响内容的查询值；同产品下规范 URL 唯一。所有新录入默认待确认，摘要由人工录入，来源链接可打开。情报创建和状态修改以及成员开通有事务内审计。当前没有自动抓取用户提供 URL 的通用接口。

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
# 先启动 API / Worker / 本地 PostgreSQL / Redis
pnpm test:smoke
```

单元测试检查 URL 去重边界、非网页协议、角色写权限与时间/时区校验。集成验证真实 HTTP 登录、关闭注册、成员开通、越权拒绝、会话退出/停用、输入校验、去重、跨成员共享；无模型配置时还测试 outbox 补入队及 Worker 重试失败持久化，不调用收费模型。脚本创建唯一临时账号和记录，并在 finally 中清理。仅对本地或隔离测试环境运行，生产环境禁止执行。

CI 定义相同检查并用临时数据库/Redis 跑集成验证。首次推送后才会实际运行 GitHub Actions；本地检查不代表线上流水线已运行。

## 部署前仍需完成

现有 Compose 只用于开发。部署需为前端提供静态资源和 SPA 回退，将同域 `/api` 反向代理至 Nest，并独立运行 Worker；配置 HTTPS、生产数据库/Redis、允许的 Origin、Secret、进程守护、日志、备份及恢复。API 当前只监听回环地址，容器部署需增加可配置监听地址。生产凭据不要沿用 Compose 示例密码。

上线功能缺口和验收标准以 [TODO](../TODO.md) 为准；设计目标以 [Agent 架构决策](./agent-architecture.md) 为准，不能把设计描述视为已交付能力。

## 研究实时进度与文案

Worker 使用 AI SDK `ToolLoopAgent.stream()`，读取实际工具启动、URL 来源及文本增量；不保存或显示模型内部推理。来源以 HTTP(S) URL 去重并保存到 `run_events.data`。报告约每 750ms 保存一次到 `research_runs.result`，结束或失败时刷新最后一段；该字段在运行中表示草稿，成功后表示最终报告。每次重试从头执行并清空本次草稿，历史事件保留。

登录后的 `GET /api/research/:id/stream` 返回 SSE：立即发送已保存详情，每秒检查一次数据库，仅在快照变化时发送，终态后关闭。连接每 30 秒复核会话和停用状态；断开清理计时等待。代理需允许 SSE 并禁用缓冲。前端自动重连，断线时每三秒补查，`/research?run=<id>` 可直接恢复详情。Worker 不依赖 SSE 或浏览器存活。原生搜索细节的到达节奏取决于供应商，中转站可能批量返回来源；历史任务没有保存的来源不能重建。

报告用 Streamdown 显示 Markdown，忽略原始 HTML；来源仅提供 HTTP(S) 链接。界面不展示数据库、认证框架、调度同步间隔等实现细节，避免与任务操作争抢注意力。

真实搜索集成验证（会调用配置的模型并产生费用，仅本地隔离环境手动执行）：

```bash
pnpm --filter @guangmo/api build
cd apps/api
node --env-file=../../.env dist/scripts/research-smoke.js
```

覆盖未登录拒绝、真实入队/搜索/来源/最终报告、SSE 增量快照、重连恢复与终态关闭。测试记录及账号在终态后清理；若测试中断且任务仍活跃，保留记录及发起人供排查。常规 `pnpm test` 使用无付费模拟流验证去重、私有推理排除、不安全 URL 排除、错误时草稿保留与空报告失败。

## 候选情报与任务工作流

新增候选与任务模块、`0002` 数据迁移。新研究成功后自动生成待整理记录，由独立后台步骤提取候选；老研究在详情中手工触发，避免未经操作就批量重新调用模型。整理阶段可独立重试，报告保持成功。页面提供候选编辑/人工审核、多来源依据和任务创建、状态/结果更新。

模块职责、版本演进、幂等及限制详见 [信息采集工作流](./collection-workflow.md)。API 新增 `/candidates`、`/research/:id/candidates`、`/research/:id/extraction`、`/intelligence/:id`、`/intelligence/:id/tasks`、`/tasks` 和 `/tasks/:id`。候选编辑/审核和任务更新要求 revision；版本冲突返回 409。只读成员不能调用写接口。

完成 `pnpm build` 并启动服务后运行 `pnpm test:workflow`，检查真实事务、并发、权限与 Worker 提取重试，默认不调用模型。显式设置 `WORKFLOW_REAL_MODEL=1` 会额外验证真实模型结构化输出。`research-smoke` 现在也会等待自动整理阶段结束再清理，完整链路包含研究与提取两次模型阶段。

时间信息增量（v2）：新研究的提取阶段在后台补采来源 HTML 时间元数据，日期与精确时间使用不同表示；活动日期、来源发布/更新、采集/核查时间分别保存展示。新增字段位于现有 JSON payload/metadata，`pnpm db:generate` 确认无需 SQL 迁移。v1 阶段 handler 保留。采集边界与限制见工作流文档的“时间信息”。

## 每日计划真实定时自测

启动本地 API、Worker、PostgreSQL 和 Redis 并完成构建后执行：

```bash
SCHEDULE_REAL_MODEL=1 pnpm test:schedules
```

此命令会实际调用已配置模型进行研究和候选整理，产生费用；仅用于本地或隔离测试环境，生产环境拒绝运行。测试创建唯一临时成员和计划，等待真实时钟到点，不手工冒充定时触发，也不连接浏览器或 SSE。验证纽约时区换算、无提前触发、单次触发只有一份运行、退出登录后的后台执行、报告和 v2 候选生成、暂停移除调度、恢复后下次执行，以及无权限成员/过期队列作业不能创建研究。暂停已有计划不取消正在执行的研究。

2026-11-17 实测：纽约 01:36 / 北京 14:36 到点，运行创建于 `2026-11-17T06:36:00.089Z`，延迟 89ms；研究与整理均首次成功，生成 1 条待审核候选。全部检查通过，临时计划、作业、报告、候选和账号已清理。若异常中断仍有活跃研究，脚本移除后续调度并保留该运行和成员用于排查。此验证不覆盖服务器停机漏跑补偿、同计划跨次防重叠、夏令时切换现场或生产部署。

## 情报评分设计参考

[情报机会评分口径](./intelligence-scoring.md) 定义待校准的 `opportunity/v1-draft` 规则。已增加 `opportunity_assessments`、迁移 `0003` / `0004`、共享评分契约和 Worker 独立评分阶段。Agent 只能建议逐维档位及 B/C/U 证据等级，总分由服务端计算；未知数据不补造，评分不更改审核状态。人工评分修改/确认尚未实现。

新研究整理候选时，在同一事务创建评分待入队记录；评分独立重试，失败不会回滚成功报告或提取结果。已有候选及手工情报通过页面「评估机会」或「补充背景 / 重新评估」调用 `POST /api/scoring/:type/:id`（type 为 candidate/intelligence），权限为管理员或运营。手工录入、人工审核不隐式调用评分模型；入库后的情报需要自行评估。列表批量读取评估，不按每行单独查询。模型配置仍复用当前研究模型，凭据只在服务端。

评估保存输入、业务背景、规则版本、生成模型、逐维理由、来源索引和生成记录；内容、规则或时效改变后标记待复核。相同输入和背景在同一 UTC 日防重并复用，模型失败最多自动尝试两次。评分复核期限是读取时判断，尚未有自动重新评分计划。

真实评分自测（会调用当前模型，仅隔离本地环境）：

```bash
pnpm build
SCORING_REAL_MODEL=1 pnpm test:scoring
```

测试复制一条保留的真实研究候选，验证 API → 队列 → Worker → 模型 → 读取接口、无权限拒绝、并发防重、缺项不生成总分，以及内容修改后旧分失效。测试数据在终态后清理。`pnpm test` 覆盖加权、未知值、证据等级约束、来源索引和时区失效边界。真实研究与定时/工作流自测现会等待自动评分终态再清理，相比原来还会增加每条候选的模型评估费用。

评分、研究和整理目前共用并发 2 的 BullMQ 队列。执行长研究或批量补评时，短时限的工作流验收可能排队超时；运行 `pnpm test:workflow` 前应等待本地活跃模型任务结束。独立队列/优先级策略尚待按负载拆分。

## 情报列表与负责人增量

迁移 `0005` 为 intelligence 增加 owner_id 外键、owner_revision 与负责人索引，需先 `pnpm build`、`pnpm db:migrate` 再启动 API。已有数据保持未分配。前端七列与产品、市场、滚动收集时间、负责人筛选已接通服务端；共享契约在 `packages/contracts/src/intelligence-list.ts`，分配权限、成员校验、并发版本和审计由 IntelligenceService 事务负责。边界见 [信息采集工作流](./collection-workflow.md)。

本地 API 与数据库启动后执行 `pnpm test:intelligence`，无需模型调用或 Worker 作业；测试创建临时成员/情报/任务，验证筛选、权限、冲突、任务汇总和审计后清理。常规单元测试另覆盖滚动时间与夏令时、筛选输入和清空负责人契约。

## 动态产品与授权

迁移 `0006` 新增 products/product_members、成员授权版本、研究与计划归属，以及情报/任务产品外键。迁移中的数据回填需保留：旧无归属计划暂停，无依据的报告不猜测归属。运行 `pnpm build`、`pnpm db:migrate` 后重启 API/Worker。产品目录 `/products`、成员页 `/members` 可管理产品与授权。权限和历史迁移细则见 [产品授权](./product-access.md)。

新增 `pnpm test:products`，本地服务就绪后执行，无模型调用。跨产品授权共享于 API ProductAccess 与数据库 canAccessProduct；ResearchQueue 保持进程级单例，避免请求级权限服务导致每个请求创建 Redis 连接。

## 竞品与短剧专项

入口 `/competitors`、`/dramas`，工作流与扩展边界见 [竞品监控与短剧参考](./market-watch.md)。新增迁移 0007–0010，构建数据库包后执行 `pnpm db:migrate`。后台公开页面快照不需模型凭据；默认竞品入口的六维研究使用现有模型、Web Search 和公开网页读取，需 Worker、模型凭据及公网访问。每个竞品可设每 6–168 小时后台研究（默认 24 小时），会产生模型与搜索费用。短剧研究继续使用现有模型配置。

`pnpm test:competitor-research` 验证六维研究配置、权限、批次历史和并发核实入库，使用合成批次且不调用付费模型。真实模型验证应另行手动发起并检查六维来源质量，未知数据不能当作已采集完成。

`pnpm test:market-watch` 使用临时产品/成员验证专项权限、快照、后台重试/定时触发、趋势与原创任务。公网抓取失败会明确显示 `LIVE UNAVAILABLE`，不作为抓取成功证据；网络正常后使用 `WATCH_REQUIRE_LIVE=1 pnpm test:market-watch` 强制验收成功抓取。

研究报告渲染统一使用 `apps/web/src/components/research-report.tsx`（Streamdown + 官方 CJK 插件，处理中文标点相邻的强调语法）。竞品报告与 Agent 详情复用该组件，生成中传 `streaming`，完成或失败后按静态 Markdown 渲染；跳过原始 HTML，复用已有 Tailwind 扫描配置。

竞品卡片及历史证据中的独立外链使用 `w-fit max-w-full`，避免 block 或 flex 拉伸造成整行空白可点击；长 URL 保留截断或换行。

## 报告个人追问

迁移 0011 新增个人会话、消息、事件和显式团队分享。竞品与普通研究成功报告均可追问，详情见 [报告追问与个人会话](./research-conversations.md)。需要构建数据库包并执行 `pnpm db:migrate`，重启 API 和 Worker 使新工作流生效。`pnpm test:conversations` 需要本机数据库、Redis、API 和 Worker，短暂暂停本地队列以隔离合成作业，清理后恢复原状态；测试不调用付费模型。

研究记录与竞品研究详情共用 `features/research/components/research-detail-frame.tsx` 视口容器，详情正文与个人追问分别滚动。普通研究保留 `?run=` 链接，`researchView` 保存当前栏目；修改详情布局时需同时验证两类入口及窄屏输入区，详见 [研究详情交互](./research-detail-ux.md)。

## GCP 生产环境

部署与维护见 [GCP 部署](./gcp-deployment.md)。镜像构建使用 `deploy/Dockerfile`，API/Worker 通过 pnpm 的生产 deploy 输出运行，包的 `files` 必须包含 `dist`，数据库包额外包含 `drizzle`。本地 API 默认仅监听回环地址，容器设置 `API_HOST=0.0.0.0`；生产密钥保存在 `.deployment/` 和 VM root 配置，禁止上传构建。生产发布先排空 Worker，再迁移并启动；不要对生产执行本地 smoke 脚本。

## 人工线索与已核实阅读视图

先构建后运行 `pnpm db:migrate`，依次应用迁移 0012 和 0013。0012 允许候选独立于研究批次并保存审核原因，0013 给竞品档案增加关系分类，旧档案默认为未分类。API 和 Worker 更新使用同一数据库版本。

在收件箱点「补充线索」，无摘录进入待补证，已填写摘录进入待审核。审核通过后复用现有情报及证据入库事务。判断是否允许审批时使用证据和状态，沿用现有机会评分。人工线索的主 URL 用于防重复，补证时可增加来源。候选审核复用版本检查与操作审计。

收件箱的阅读视图只查询已核实项。今日重点默认最近 24 小时，以原始发布时间为依据，可改用收集时间。只精确到日期的原始时间按北京时间的自然日匹配，显示仍保留原始日期精度。缺原始日期的记录可以从无时间范围限制的阅读视图或收集时间视图查看。全部记录保留历史状态筛选。

`pnpm test:workflow` 增加人工线索防重、权限、补证、审核原因及入库后按发布时间和行业查询的回归验证。仅在本地测试环境运行。

## RSS 与 Atom 来源登记

迁移 0014 增加订阅源、采集运行及候选批次关联。构建后运行 `pnpm db:migrate`，重启 API 和 Worker。管理员在「接入与设置 → 情报来源」登记订阅地址、产品、行业、监测市场、频率和允许采集的依据。新来源默认暂停，可以手动采集一次，再启用定时。产品成员只能读取获授权产品的来源和运行记录。

连接器每轮最多检查订阅窗口内前 50 条，不需要模型。候选保留原链接、发布方标题、短摘录和可解析的原始日期。市场是来源配置的监测范围，日期缺失保留未知，原文摘录不足进入待补证。发布方摘录以来源自述标记，须经人工审核才进入正式收件箱。各来源按同产品标准文章 URL 防重，运行记录区分无新增和失败。此版不追补订阅源未返回的历史，不自动合并同一事件的不同链接。

采集沿用 Worker 与 BullMQ。运行记录写入 PostgreSQL，通过固定任务 ID 进行队列协调，失败后按队列策略重试。订阅源请求复用经过校验的公网读取逻辑，限制耗时、体积及重定向。仅接入管理员确认允许自动读取和留存摘录的来源。来源目录批量导入、来源侧分页或游标、权限到期与告警仍待接入。

本地验收取 Tattoo Life 官方 RSS 的实测响应，在隔离数据库中跑通 10 条候选、重复批次新增 0 条，以及人工审核入库。当前开发机 DNS 返回保留网段，正常 Worker 的实时抓取被安全规则拦截。隔离 Worker 已验证定时排队、两次尝试和失败状态。公网 Worker 的实时成功采集单独验收。

后续本地联调中，Tattoo Life 和 Meta Newsroom 官方 RSS 均由实际 Worker 实时抓取成功，各新增 10 条候选。审核其中一条后，收件箱保留了原始发布时间和证据。曾出现的来源响应超时现在会单独显示。

## 站内简报、竞品变化与视频观察

执行迁移 0015 和 0016 后重启 API 与 Worker。收件箱的「查看今日简报」打开 `/briefs`，按当前产品查看期次。Worker 从北京时间 09:05 开始检查当期是否生成，以前一天 08:30 至当日 08:30 为观察窗口。每产品每期只归档一次，最多八条已核实信息，日期未知的线索单列，三天内相同情报 ID 去重。当前按已有数据顺序选题，暂无手工重发和更正版本。简报显示当期 RSS/Atom 来源覆盖，社媒覆盖取决于实际导入和审核。

竞品网页快照首轮保存基线，有文本增减才生成待审候选。自动差异是初筛。定价页面的人工快照支持结构化报价，套餐、地区语言、币种和周期相同才判断价格变化。候选可通过审核入库，也可填写理由将证据并到同产品已有情报。

原有 `/dramas` 保留短剧记录与权限，导航显示「视频与创意参考」。用户可登记原帖和市场依据，手工记录或批量导入已获准的 JSON 观测。每次数组最多 50 条，支持单素材的 UTC 观测时间、指标、单位、口径、来源链接、提供方及缓存标记。版本 v1 的播放飙升信号使用 2–6 小时、增长至少 20,000 且增长率至少 50% 的阈值。单点、缓存、估算及跨提供方数据不可据此判为飙升。平台授权、持续账号池采集和真实覆盖验收仍待完成。

## 现代 B 端 UI 规范与 AI-Native 开发脚本

前端视觉与组件规范见 [现代 B 端办公设计规范](./design-system.md)，飞书群驱动的多 Agent 研发闭环见 [AI-Native 研发闭环方案](./ai-native-workflow.md)，新需求开工前请对齐 [Feature 需求与验收标准模板](./templates/feature-spec.md)。

仓库新增 4 条辅助开发与验收的统一命令（运行产物写入已被 `.gitignore` 忽略的 `artifacts/`）：

```bash
# 检查 Node 24、pnpm、.env、Git 基线、PostgreSQL/Redis、API、Playwright 与 lark-cli
pnpm env:check

# 为并行开发的 Agent 创建隔离目录、分支与端口（slot 1..9）
pnpm worktree:init <task-slug> --slot 1

# 自动采集桌面/移动端页面截图与控制台错误报告（需安装 playwright 与 chromium，并启动本地/测试服务）
VERIFY_UI_URL=http://localhost:5173 VERIFY_UI_EMAIL=test@example.com VERIFY_UI_PASSWORD=... pnpm verify:ui

# 检查 lark-cli / 启动飞书群需求监听 / 回写群话题进展
pnpm feishu:intake -- --check
pnpm feishu:intake -- listen
pnpm feishu:intake -- reply --message-id <om_xxx> --markdown "已提交 PR，待验收" --dry-run
```
