# 飞书群驱动的 AI-Native 研发闭环方案

> 参考 HiFox AI-native 研发实践，结合 `magic-growth` 单仓架构、飞书开放平台（`lark-cli` / 机器人事件）与 24 小时常驻测试机，搭建“飞书群提需求 → Agent 自动拆解与开发 → 证据化验收 → 进展回写飞书群”的团队自建闭环。

## 1. 整体流转架构

```mermaid
flowchart LR
  A["飞书反馈/产品群 @需求助手"] --> B["常驻机监听 im.message.receive_v1"]
  B --> C["需求整理 Agent\n(读群上下文 + 代码库 + docs)"]
  C --> D["回发群话题：方案选项 + 验收标准(AC)"]
  D --> E["产品/负责人拍板确认"]
  E --> F["写入任务台(飞书多维表格/Issue)\n并分配给开发 Agent"]
  F --> G["开发 Agent\n(pnpm worktree:init -> 实现 -> 测试 -> pnpm verify:ui)"]
  G --> H["提交 PR + 交付三件套\n(验证地址/账号 + Diff + 截图报告)"]
  H --> I["自动回写飞书原话题"]
  I --> J["白盒审查 + Playwright 回归 + 设计师后置走查"]
  J --> K["合并发布 & 通知原话题已上线"]
```

## 2. 角色分工（4 类 Agent 职责边界）

1. **需求整理 Agent（飞书群入口）**
   - 触发：群内 `@机器人` 或带 `#需求` / `创建任务` 指令。
   - 输入：飞书话题上下文 + 本仓库代码、[`docs/`](./development.md) 及历史任务。
   - 输出：按 [Feature 需求与验收标准模板](./templates/feature-spec.md) 生成结构化草案，明确列出需要人工拍板的决策选项（例如权限边界、是否需要新迁移、影响范围）。
   - 约束：**禁止未经确认直接落库或开始写代码**；必须先把决策项和 AC 写清。

2. **全栈开发 Agent（Worktree 独立执行）**
   - 触发：任务状态进入「待开发」且指派给开发 Agent。
   - 执行路径：
     1. 在常驻机执行 `pnpm worktree:init <task-slug> --slot <1..9>`，拿到独立分支、目录与隔离端口；
     2. 执行 `pnpm env:check` 确认 Node 24 / DB / Redis / 迁移就绪；
     3. 如涉及技术实现分歧，先在任务/话题中确认关键细节；
     4. 全栈完成 `packages/contracts` → `packages/database`（`pnpm db:generate` + `pnpm db:migrate`）→ `apps/api` / `apps/worker` → `apps/web`（遵守 [现代 B 端办公设计规范](./design-system.md)）；
     5. 跑齐门禁命令（`pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`）与受影响的集成脚本；
     6. 涉及前端改动时执行 `pnpm verify:ui`，产出 `artifacts/ui-evidence/<timestamp>/report.md` 和桌面/移动端截图；
     7. 创建 PR，并调用 `pnpm feishu:intake -- reply ...` 把 **验证链接/账号、PR Diff、截图与测试结论** 同步回原飞书话题。

3. **自动化测试 Agent（白盒预检 + 黑盒回归）**
   - 触发：PR 创建或任务流转到「待测试」。
   - 白盒预检：对照 [Feature Spec](./templates/feature-spec.md) 逐条核查权限守卫（`viewer` 拒绝写接口、动态产品授权隔离）、并发 `revision` 校验、异常/未配置态与真实测试输出。
   - 黑盒执行：在 24 小时常驻测试机运行 `pnpm test:smoke`、受影响业务集成测试及 Playwright UI 回归，失败时把具体错误日志和截图直接回帖到 PR 与飞书话题。

4. **后置 UI 走查 Agent（对应 HiFox 设计师后置模式）**
   - 前提：设计 Token、页面骨架和禁止反模式已前置固化在 [现代 B 端办公设计规范](./design-system.md) 与 `apps/web/src/components/` 中。
   - 走查：开发/PM 直接让 Agent 产出功能后，再对照截图证据包和规范做视觉走查；发现对齐、密度、语义色或移动端适配问题时，直接由 Agent 在同一分支修补并重新生成截图。

## 3. 飞书开放平台与常驻测试机准备清单

### 3.1 飞书开放平台应用配置（待管理员开通）

1. 在飞书开放平台创建企业自建应用，开启**机器人**能力。
2. 订阅事件：`im.message.receive_v1`（接收群聊 `@机器人` 消息），事件推送方式建议优先**长连接模式**（无需公网回调域名，配合 `lark-cli event consume` 直接在常驻机运行）。
3. 申请最小必要权限：读取群消息与话题上下文、以机器人身份回复群消息/话题；如需同步到飞书多维表格（Base）或飞书任务，再追加对应域权限。
4. 在常驻机完成 `lark-cli auth login` 并验证 `pnpm feishu:intake -- --check`。

### 3.2 24 小时常驻测试机（Mac mini / Linux VM / 独立 Staging）

- 安装 Node 24、pnpm 10.32.1、Docker（PostgreSQL 17 / Redis 7）、Git、Playwright Chromium 与 `lark-cli`。
- 准备专用测试账号（`admin`、`operator`、`viewer` 三个角色）与隔离测试数据库，**严禁指向生产库或生产 Redis**。
- 常驻监听进程（示例）：
  ```bash
  # 检查本机与 lark-cli 就绪状态
  pnpm env:check
  pnpm feishu:intake -- --check

  # 启动飞书群消息事件监听（收到触发词后写入 artifacts/feishu-intake/）
  pnpm feishu:intake -- listen
  ```

## 4. 当前已交付 vs 待接入状态（如实记录）

- **已交付到仓库**：
  - [现代 B 端办公设计规范](./design-system.md) 与前端基础主题/高频页改造
  - [Feature 需求与验收标准模板](./templates/feature-spec.md)
  - `pnpm env:check`（自动化环境自检）
  - `pnpm worktree:init`（多 Agent 并发 Worktree 与端口隔离）
  - `pnpm verify:ui`（Playwright 自动登录、桌面/移动端截图与证据报告脚本）
  - `pnpm feishu:intake`（基于 `lark-cli` 的飞书群消息采集与话题回写脚手架）
- **尚未接入/验证（需团队资源就绪后推进）**：
  - 仓库首次 Git 基线提交与远程 GitHub/GitLab 仓库配置
  - 常驻测试机安装 Playwright Chromium 并跑通首次 E2E 回归
  - 飞书开放平台机器人应用授权、群聊真实 `@机器人` 联调与多维表格/Issue 自动建单联动
