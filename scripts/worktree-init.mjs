#!/usr/bin/env node
/**
 * 为 AI Agent 或开发者创建隔离的 Git Worktree 与端口配置，避免多任务并行冲突。
 *
 * 用法：
 *   node scripts/worktree-init.mjs <task-slug> [--slot 1] [--base main]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const getFlag = (name, fallback) => {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

if (!slug || !/^[a-z0-9][a-z0-9-_]{1,48}$/i.test(slug)) {
  console.error(
    '用法: pnpm worktree:init <task-slug> [--slot 1..9] [--base main]\n示例: pnpm worktree:init feishu-task-102 --slot 1',
  );
  process.exit(1);
}

const slot = Number(getFlag('--slot', '1'));
if (!Number.isInteger(slot) || slot < 1 || slot > 9) {
  console.error('--slot 必须是 1 到 9 的整数，用于隔离 Web/API 端口。');
  process.exit(1);
}

const root = process.cwd();
const parentDir = path.dirname(root);
const baseName = path.basename(root);
const targetDir = path.join(parentDir, `${baseName}-worktrees`, slug);
const branch = `feat/${slug}`;
const base = getFlag('--base', 'HEAD');

try {
  execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: root,
    stdio: 'ignore',
  });
} catch {
  console.error(
    '错误：当前 Git 仓库还没有任何提交，无法创建 worktree。\n请先完成首次基线提交（git add . && git commit -m "chore: initial baseline"）。',
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(targetDir), { recursive: true });
execFileSync('git', ['worktree', 'add', '-b', branch, targetDir, base], {
  cwd: root,
  stdio: 'inherit',
});

const apiPort = 3001 + slot;
const webPort = 5173 + slot;
const sourceEnv = path.join(root, '.env');
const targetEnv = path.join(targetDir, '.env');

if (!args.includes('--no-env') && fs.existsSync(sourceEnv)) {
  let content = fs.readFileSync(sourceEnv, 'utf8');
  const upsert = (key, value) => {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (pattern.test(content)) {
      content = content.replace(pattern, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}\n`;
    }
  };
  upsert('PORT', String(apiPort));
  upsert('API_PORT', String(apiPort));
  upsert('BETTER_AUTH_URL', `http://127.0.0.1:${apiPort}`);
  upsert('WEB_ORIGIN', `http://localhost:${webPort}`);
  fs.writeFileSync(targetEnv, content, { mode: 0o600 });
}

console.log(`
Worktree 已就绪：
  目录:     ${targetDir}
  分支:     ${branch}
  API 端口: ${apiPort}
  Web 端口: ${webPort}

下一步在该目录执行：
  cd "${targetDir}"
  pnpm install --frozen-lockfile
  pnpm build
  pnpm env:check
  # 如需独立前端端口启动：
  pnpm --filter @guangmo/web dev -- --port ${webPort}
`);
