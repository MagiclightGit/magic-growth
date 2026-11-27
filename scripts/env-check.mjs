#!/usr/bin/env node
/**
 * 自动化环境检查脚本（供人工与 AI Agent 开发/测试前统一执行）。
 * 检查：Node 24、pnpm、.env、Git 基线、PostgreSQL/Redis 端口、可选运行中服务与 lark-cli。
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const requireRunning = process.argv.includes('--require-running');

const results = [];
function record(name, status, detail, hint = '') {
  results.push({ name, status, detail, hint });
}

function runText(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function checkTcp(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function parseEnvFile(filePath) {
  const map = new Map();
  if (!fs.existsSync(filePath)) return map;
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    map.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  return map;
}

// 1. Node version
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor === 24) {
  record('Node.js', 'ok', `v${process.versions.node}`);
} else {
  record(
    'Node.js',
    'fail',
    `当前 v${process.versions.node}，要求 Node 24`,
    'macOS 可执行 export PATH="/opt/homebrew/opt/node@24/bin:$PATH"',
  );
}

// 2. pnpm
const pnpmVersion = runText('pnpm', ['-v']);
if (pnpmVersion) {
  record('pnpm', 'ok', `v${pnpmVersion}`);
} else {
  record('pnpm', 'fail', '未检测到 pnpm', '请安装 pnpm 10.32.1');
}

// 3. Git baseline & worktree readiness
const headCommit = runText('git', ['rev-parse', '--short', 'HEAD']);
const remote = runText('git', ['remote']);
if (headCommit) {
  record(
    'Git 基线',
    remote ? 'ok' : 'warn',
    `HEAD=${headCommit}${remote ? ` · remotes=${remote.replace(/\n/g, ',')}` : ' · 未配置远程仓库'}`,
    remote ? '' : '如需自动提交 PR，请先配置 git remote（GitHub/GitLab）',
  );
} else {
  record(
    'Git 基线',
    'warn',
    '当前分支尚无任何提交（无法创建 git worktree）',
    '请先执行初始 git add / git commit 建立基线后再使用 worktree 并发开发',
  );
}

// 4. .env
const envPath = path.join(root, '.env');
const env = parseEnvFile(envPath);
if (!fs.existsSync(envPath)) {
  record(
    '.env 配置',
    'fail',
    '根目录缺少 .env',
    '参考 docs/development.md 从 .env.example 生成并填充 BETTER_AUTH_SECRET',
  );
} else {
  const missing = ['DATABASE_URL', 'REDIS_URL', 'BETTER_AUTH_SECRET'].filter(
    (key) => !env.get(key),
  );
  if (missing.length) {
    record(
      '.env 配置',
      'fail',
      `缺少必需变量：${missing.join(', ')}`,
      '补齐变量后重试',
    );
  } else {
    const modelReady = Boolean(
      env.get('OPENAI_API_KEY') && env.get('RESEARCH_MODEL'),
    );
    record(
      '.env 配置',
      'ok',
      `核心变量齐全 · 模型凭据${modelReady ? '已配置' : '未配置（仅人工流程可用）'}`,
    );
  }
}

// 5. PostgreSQL & Redis TCP
const pgUrl = env.get('DATABASE_URL') || 'postgres://127.0.0.1:55432/guangmo';
const redisUrl = env.get('REDIS_URL') || 'redis://127.0.0.1:56379';
const parseHostPort = (raw, fallbackPort) => {
  try {
    const u = new URL(raw);
    return {
      host: u.hostname || '127.0.0.1',
      port: Number(u.port) || fallbackPort,
    };
  } catch {
    return { host: '127.0.0.1', port: fallbackPort };
  }
};
const pgAddr = parseHostPort(pgUrl, 5432);
const redisAddr = parseHostPort(redisUrl, 6379);

const [pgOk, redisOk] = await Promise.all([
  checkTcp(pgAddr.host, pgAddr.port),
  checkTcp(redisAddr.host, redisAddr.port),
]);

record(
  'PostgreSQL',
  pgOk ? 'ok' : requireRunning ? 'fail' : 'warn',
  pgOk
    ? `${pgAddr.host}:${pgAddr.port} 可连通`
    : `${pgAddr.host}:${pgAddr.port} 未监听`,
  pgOk ? '' : '运行 pnpm infra:up 启动本地数据库',
);

record(
  'Redis',
  redisOk ? 'ok' : requireRunning ? 'fail' : 'warn',
  redisOk
    ? `${redisAddr.host}:${redisAddr.port} 可连通`
    : `${redisAddr.host}:${redisAddr.port} 未监听`,
  redisOk ? '' : '运行 pnpm infra:up 启动本地 Redis',
);

// 6. API health (required only with --require-running)
const apiPort = Number(env.get('API_PORT') || 3001);
let apiOk;
try {
  const res = await fetch(`http://127.0.0.1:${apiPort}/api/health/ready`, {
    signal: AbortSignal.timeout(1500),
  });
  apiOk = res.ok;
} catch {
  apiOk = false;
}
record(
  'API 服务',
  apiOk ? 'ok' : requireRunning ? 'fail' : 'warn',
  apiOk
    ? `http://127.0.0.1:${apiPort}/api/health/ready 正常`
    : `127.0.0.1:${apiPort} 未启动`,
  apiOk ? '' : '运行 pnpm dev 启动 Web / API / Worker',
);

// 7. Optional AI-native tools: Playwright & lark-cli
let hasPlaywright;
try {
  await import('playwright');
  hasPlaywright = true;
} catch {
  hasPlaywright = false;
}
record(
  'Playwright',
  hasPlaywright ? 'ok' : 'warn',
  hasPlaywright ? '已安装，可执行 pnpm verify:ui' : '未安装',
  hasPlaywright
    ? ''
    : '运行 pnpm install --frozen-lockfile && pnpm exec playwright install chromium',
);

const larkCli = runText('which', ['lark-cli']);
record(
  'lark-cli',
  larkCli ? 'ok' : 'warn',
  larkCli ? larkCli : '未检测到 lark-cli',
  larkCli ? '' : '飞书群事件消费与消息回写需要 lark-cli 或飞书开放平台应用凭据',
);

// Print summary table
const icon = { ok: '[OK]  ', warn: '[WARN]', fail: '[FAIL]' };
for (const item of results) {
  console.log(`${icon[item.status]} ${item.name}: ${item.detail}`);
  if (item.hint) console.log(`       -> ${item.hint}`);
}

const failures = results.filter((r) => r.status === 'fail');
if (failures.length) {
  console.error(`\n环境检查未通过：${failures.length} 项失败。`);
  process.exit(1);
}
console.log('\n环境检查完成。');
