#!/usr/bin/env node
/**
 * UI 自动化验证与截图证据采集脚本（参考 HiFox 交付三件套：验证链接/账号 + Diff + 截图）。
 *
 * 环境变量：
 *   VERIFY_UI_URL      目标站点地址，默认 http://localhost:5173
 *   VERIFY_UI_EMAIL    测试账号邮箱（可选；未设置时仅截取 /login 页面）
 *   VERIFY_UI_PASSWORD 测试账号密码（可选）
 *   VERIFY_UI_ROUTES   逗号分隔的路由列表，默认 /,/intelligence,/candidates,/tasks
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    '未安装 playwright，无法执行浏览器截图验证。\n请先运行：\n  pnpm add -D -w playwright\n  pnpm exec playwright install chromium',
  );
  process.exit(1);
}

const baseUrl = (process.env.VERIFY_UI_URL || 'http://localhost:5173').replace(
  /\/$/,
  '',
);
const email = process.env.VERIFY_UI_EMAIL || '';
const password = process.env.VERIFY_UI_PASSWORD || '';
const routes = (
  process.env.VERIFY_UI_ROUTES || '/,/intelligence,/candidates,/tasks'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(process.cwd(), 'artifacts', 'ui-evidence', stamp);
fs.mkdirSync(outDir, { recursive: true });

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const report = [];
const browser = await chromium.launch({ headless: true });

try {
  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      locale: 'zh-CN',
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
    const loginShot = `${vp.name}-login.png`;
    await page.screenshot({
      path: path.join(outDir, loginShot),
      fullPage: true,
    });
    report.push({
      viewport: vp.name,
      route: '/login',
      screenshot: loginShot,
      overflowX: await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
      consoleErrors: [...consoleErrors],
    });

    if (email && password) {
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', password);
      await page.click('button[type="submit"]');
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 10000,
      });

      for (const route of routes) {
        consoleErrors.length = 0;
        await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(400);
        const safeName =
          route === '/'
            ? 'overview'
            : route.replace(/^\//, '').replace(/\W+/g, '-');
        const shot = `${vp.name}-${safeName}.png`;
        await page.screenshot({
          path: path.join(outDir, shot),
          fullPage: true,
        });
        const overflowX = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        );
        report.push({
          viewport: vp.name,
          route,
          screenshot: shot,
          overflowX,
          consoleErrors: [...consoleErrors],
        });
      }
    }

    await context.close();
  }
} finally {
  await browser.close();
}

let diffStat = '（无 Git 提交记录）';
try {
  diffStat =
    execFileSync('git', ['diff', '--stat'], { encoding: 'utf8' }).trim() ||
    '（工作区无未提交改动）';
} catch {
  // ignore
}

const mdLines = [
  `# UI 验收证据包 (${stamp})`,
  '',
  `- 验证地址：${baseUrl}`,
  `- 登录验收：${email ? `已使用测试账号 ${email}` : '未提供测试账号（仅验证 /login）'}`,
  '',
  '## 页面检查结果',
  '',
  '| 视口 | 路由 | 截图文件 | 横向溢出 | 控制台错误 |',
  '| --- | --- | --- | --- | --- |',
  ...report.map(
    (r) =>
      `| ${r.viewport} | \`${r.route}\` | \`${r.screenshot}\` | ${r.overflowX ? '有溢出' : '正常'} | ${r.consoleErrors.length} |`,
  ),
  '',
  '## 代码变更摘要 (`git diff --stat`)',
  '',
  '```text',
  diffStat,
  '```',
  '',
];

const reportPath = path.join(outDir, 'report.md');
fs.writeFileSync(reportPath, mdLines.join('\n'), 'utf8');
console.log(`UI 验收证据已生成：${reportPath}`);

const hasErrors = report.some((r) => r.consoleErrors.length > 0);
if (hasErrors) {
  console.error('检测到页面控制台错误，请查看 report.md 并修复后再提交。');
  process.exit(1);
}
