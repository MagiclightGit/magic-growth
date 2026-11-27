#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = (process.env.VERIFY_UI_URL || 'http://localhost:5173').replace(
  /\/$/,
  '',
);
const email = process.env.VERIFY_UI_EMAIL;
const password = process.env.VERIFY_UI_PASSWORD;
assert.equal(Boolean(email), Boolean(password), '同时提供测试账号邮箱和密码');

const routes = (
  process.env.VERIFY_UI_ROUTES || '/,/intelligence,/candidates,/tasks'
)
  .split(',')
  .map((route) => route.trim())
  .filter(Boolean);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(process.cwd(), 'artifacts', 'ui-evidence', stamp);
fs.mkdirSync(outDir, { recursive: true });

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];
const results = [];
let role;
let failure;
const browser = await chromium.launch();

try {
  for (const { name, width, height } of viewports) {
    const context = await browser.newContext({
      viewport: { width, height },
      locale: 'zh-CN',
    });
    const page = await context.newPage();
    const errors = [];

    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const source = message.location().url;
      // The login page checks for a session before the user signs in.
      if (
        source === `${baseUrl}/api/me` &&
        new URL(page.url()).pathname === '/login' &&
        /\b401\b/.test(message.text())
      )
        return;
      errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));

    async function capture(route) {
      const safeName =
        route === '/' ? 'overview' : route.slice(1).replace(/\W+/g, '-');
      const screenshot = `${name}-${safeName}.png`;
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: path.join(outDir, screenshot),
        fullPage: true,
      });
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      results.push({
        name,
        route,
        screenshot,
        overflow,
        errors: errors.splice(0),
      });
    }

    await page.goto(`${baseUrl}/login`);
    await page.getByRole('button', { name: '登录工作台' }).waitFor();
    await page.waitForLoadState('networkidle');
    await capture('/login');

    if (email && password) {
      await page.getByLabel('工作邮箱').fill(email);
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: '登录工作台' }).click();
      await page.waitForURL((url) => url.pathname === '/');
      const session = await context.request.get(`${baseUrl}/api/me`);
      assert(session.ok(), `登录后无法读取成员身份，HTTP ${session.status()}`);
      ({ role } = await session.json());

      for (const route of routes) {
        const target = new URL(route, baseUrl);
        assert.equal(target.origin, new URL(baseUrl).origin);
        const response = await page.goto(target.href);
        assert(response?.ok(), `页面 ${route} 返回 HTTP ${response?.status()}`);
        await page.locator('main h1').first().waitFor();
        await page.waitForLoadState('networkidle');
        assert.equal(
          new URL(page.url()).pathname,
          target.pathname,
          `页面 ${route} 发生跳转`,
        );
        assert.equal(
          await page
            .getByRole('heading', { name: '页面不存在', exact: true })
            .count(),
          0,
          `页面 ${route} 不存在`,
        );
        await capture(route);
      }
    }
    await context.close();
  }
} catch (error) {
  failure = error;
} finally {
  await browser.close();
}

const diffStat =
  execFileSync('git', ['diff', 'HEAD', '--stat'], {
    encoding: 'utf8',
  }).trim() || '工作区无未提交改动';
const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const reportPath = path.join(outDir, 'report.md');
fs.writeFileSync(
  reportPath,
  [
    `# UI 验收证据包（${stamp}）`,
    '',
    `- 验证地址 ${baseUrl}`,
    `- 提交 \`${revision}\``,
    `- 测试账号 ${email ? `${email}（${role ?? '身份未验证'}）` : '仅验证登录页'}`,
    '',
    '| 视口 | 路由 | 截图 | 横向溢出 | 控制台错误 |',
    '| --- | --- | --- | --- | --- |',
    ...results.map(
      ({ name, route, screenshot, overflow, errors }) =>
        `| ${name} | \`${route}\` | [${screenshot}](./${screenshot}) | ${overflow ? '有' : '无'} | ${errors.length} |`,
    ),
    '',
    ...results.flatMap(({ name, route, errors }) =>
      errors.map(
        (error) => `- ${name} \`${route}\` — ${error.replace(/\s+/g, ' ')}`,
      ),
    ),
    ...(failure ? [`- 验证中断：${failure.message}`, ''] : []),
    '',
    '## 代码变更摘要',
    '',
    '```text',
    diffStat,
    '```',
    '',
  ].join('\n'),
);
console.log(`UI 验收证据已生成：${reportPath}`);

if (failure) throw failure;
if (results.some(({ errors }) => errors.length)) {
  console.error('检测到页面控制台错误，详见 report.md。');
  process.exitCode = 1;
}
if (results.some(({ overflow }) => overflow)) {
  console.error('检测到页面横向溢出，详见 report.md。');
  process.exitCode = 1;
}
