# GCP 部署与维护

## 首期选择

项目 `magiclight-2025`，新加坡 `asia-southeast1`，独立资源前缀 `guangmo-growth`。小团队首期使用一台标准型（非 Spot）`e2-medium`，4GB 内存、共享 vCPU。Caddy 提供 HTTPS、静态前端及同源 `/api` 反向代理；NestJS API 与 BullMQ Worker 独立容器运行，PostgreSQL 17 和 Redis 7 使用持久化卷。

这是一套成本优先的单机方案，不提供多可用区高可用。实例或所在可用区故障会暂停服务，需恢复实例或通过备份重建。后续可以分别把 API 移到 Cloud Run、数据库移到 Cloud SQL、Redis 移到托管服务，不改变业务模块边界。研究耗时主要受模型和外部信息源影响，扩大机器不能直接加快模型响应。

按 24 小时运行、当前小团队流量暂按每月 45–65 美元规划，包含机器、磁盘、IPv4 和少量备份存储的估算，不是已核实的实时报价。不包含模型、搜索、超额流量及构建费用；账单、折扣和区域实际单价决定最终金额。项目的 Cloud Billing 查询接口未启用，未为查询报价额外启用。

## 资源及权限

- `guangmo-growth` 自定义 VPC / 子网，仅应用专用；公开 80/443，SSH 只允许 IAP 网段。数据库和 Redis 无宿主机端口映射。
- `guangmo-growth` VM / 静态 Standard IPv4，`asia-southeast1-b`。
- 15GB 系统盘，独立 50GB balanced 数据盘 `guangmo-growth-data`。数据盘不随 VM 删除，挂载 `/srv/guangmo`；Docker 要求该路径先挂载，避免误写系统盘。
- `asia-southeast1-docker.pkg.dev/magiclight-2025/guangmo-growth` 保存镜像。
- `guangmo-growth-runtime` VM 服务账号仅获得应用镜像仓库读取和备份桶对象创建权限，不使用项目 Editor 权限。
- `gs://magiclight-2025-guangmo-backups` 禁止公开访问，数据库备份保留 30 天。存储桶软删除策略可能额外保留已删除对象并产生费用。
- `guangmo-growth-daily` 数据盘每日快照策略，自动快照保留 7 天。

运行密钥保存在 VM 的 `/opt/guangmo/.env`，目录 700、文件 600，仅管理员可读取；密钥不写入镜像、Cloud Build 或源码包。本地生产文件位于被 Git/Docker/gcloud 排除的 `.deployment/`，应按密钥文件管理。

## 构建和首次部署

在仓库根目录使用 Node 24、pnpm 和已经登录的 gcloud。所有命令显式指定项目，不切换全局默认项目。

```bash
gcloud artifacts repositories create guangmo-growth \
  --project=magiclight-2025 --location=asia-southeast1 \
  --repository-format=docker

bash deploy/gcp/provision.sh

gcloud builds submit --project=magiclight-2025 --region=asia-southeast1 \
  --config=deploy/cloudbuild.yaml \
  --substitutions=_IMAGE_PREFIX=asia-southeast1-docker.pkg.dev/magiclight-2025/guangmo-growth,_RELEASE=YOUR_UNIQUE_RELEASE
```

`provision.sh` 可重复执行，已存在的 VM、网络、磁盘不会被替换；修改机型和区域需单独审阅。首次启动安装 Docker 并挂载数据盘，`/opt/guangmo/bootstrap-complete` 表示初始化结束。

准备 `.deployment/production.env`，文件权限 600，值包括：

```dotenv
IMAGE_PREFIX=asia-southeast1-docker.pkg.dev/magiclight-2025/guangmo-growth
RELEASE=YOUR_UNIQUE_RELEASE
SITE_HOST=YOUR_HOST_WITHOUT_SCHEME
POSTGRES_PASSWORD=GENERATE_RANDOM_HEX
BETTER_AUTH_SECRET=GENERATE_RANDOM_HEX
OPENAI_API_KEY=YOUR_PROVIDER_KEY
OPENAI_BASE_URL=YOUR_PROVIDER_URL
RESEARCH_MODEL=YOUR_MODEL
```

`SITE_HOST` 必须解析到该 VM 的静态 IPv4，Caddy 自动申请并续期 TLS。可先使用临时 DNS 地址，正式使用前绑定团队域名。域名变更后重新发布以同步 Better Auth 的来源与回调地址。

```bash
bash deploy/gcp/publish.sh .deployment/production.env
```

发布从元数据服务短暂获取镜像拉取凭证，使用后退出 Docker 登录。脚本等待旧 Worker 完成任务、停止旧 API，再执行 Drizzle 迁移并启动服务。该方案更新有短暂不可用窗口，不宣称零停机。数据库和 Redis 卷持续保留。

生产数据库独立初始化。使用现有管理员开通脚本创建首个管理员，不开放公开注册。禁止运行本地 smoke / fixture 脚本对生产数据库做测试。

```bash
gcloud compute ssh guangmo-growth --project=magiclight-2025 \
  --zone=asia-southeast1-b --tunnel-through-iap \
  --command='sudo docker compose --env-file /opt/guangmo/.env -f /opt/guangmo/compose.yaml exec api node dist/scripts/create-admin.js' -- -t
```

## 日常检查

VM 上运行：

```bash
cd /opt/guangmo
sudo docker compose --env-file .env -f compose.yaml ps
sudo docker compose --env-file .env -f compose.yaml logs --tail=100 api worker
sudo systemctl status guangmo-backup.timer
sudo journalctl -u guangmo-backup.service --since yesterday
df -h /srv/guangmo
```

公开 `/api/health` 检查 API 存活，`/api/health/ready` 同时检查数据库。Redis 和 Worker 状态需结合容器状态、日志和实际任务进度检查；HTTP 健康不等同于整个研究链路健康。容器日志有轮转限制。当前未配置值班告警通知渠道。

## 备份和恢复

每天 UTC 19:00 左右（北京时间次日 03:00）执行 PostgreSQL `pg_dump -Fc`，上传 GCS 独立时间戳对象。服务账号只能新增对象，无法覆盖或删除旧备份。每日数据盘快照补充保存数据库、Redis 和 Caddy 状态；快照是崩溃一致性备份，不能保证数据库与队列在同一业务事务边界。每日备份的最大数据损失窗口约 24 小时，备份失败会扩大该窗口。

人工补做一次逻辑备份：

```bash
sudo systemctl start guangmo-backup.service
sudo journalctl -u guangmo-backup.service -n 20 --no-pager
```

恢复前先停止 API 和 Worker，保留当前磁盘或另做备份。通过具有备份读取权限的运维身份下载指定 `.dump`，在隔离数据库用 `pg_restore` 验证后恢复目标数据库。队列和进行中任务需与所选备份时间核对，防止恢复旧任务后重复调用外部模型。不要对运行中的生产库直接执行清库或覆盖恢复。

应用版本回退：改回上一版 `RELEASE` 并发布。数据库迁移不会自动回退，必须先确认旧代码兼容当前 schema；不兼容时优先向前修复或使用经过验证的数据恢复流程。

## 2026-11-18 部署记录

版本 `20261118-02`；VM 静态 IP `34.2.132.151`，临时访问地址 <https://guangmo.34.2.132.151.sslip.io>。生产管理员邮箱为 `yu@test.com`（按用户指定修改），随机密码保存在本机 `.deployment/production-access.json`，权限 600，避免在对话或日志中公开密码。临时域名依赖第三方动态 DNS，正式使用建议换团队自己的域名。

实测：Cloud Build 镜像构建成功；HTTPS 前端、数据库 readiness、匿名访问 401、Better Auth 密码登录及登录后的身份、产品、研究列表接口通过。数据库迁移完成；GCS 首次逻辑备份成功（79,177 字节）。API/Worker 均配置模型，未为部署验证发起付费研究；未进行完整故障恢复演练或负载压测。本地 build、typecheck、lint、format:check 及 51 项测试通过。

运行状态核对：Redis 中有 1 个在线 Worker 消费者，API 的模型配置已识别；管理员初始化后再次备份成功（79,731 字节）。空闲观测内存约使用 953MB、可用约 2.9GB，数据盘约使用 48MB；这只是初始空载读数，不是并发性能测试结果。

## 2026-11-25 部署记录

发布版本 `20261125-01`，包含每日站内简报、来源登记和采集、候选审核、竞品变化和视频观测。发布前完成数据库逻辑备份 `postgres/20261125T120003Z.dump`，随后成功应用迁移并启动 Web、API 和 Worker。

线上核对通过 HTTPS、管理员登录、简报匿名访问拦截、候选与视频接口及 Redis 队列连接。Worker 已生成两份按产品归档的简报。线上来源列表为空。构建、类型检查、Lint、格式检查及 53 项测试通过。[Cloud Build](https://console.cloud.google.com/cloud-build/builds;region=asia-southeast1/719bac02-2ba9-4352-9e59-dfee8549844b?project=679337547569)
