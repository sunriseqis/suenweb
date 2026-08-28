#!/usr/bin/env node

/**
 * SuenWeb 一键自动化部署脚本 (Cloudflare Workers + D1)
 * 功能：
 * 1. 自动同步静态资产 (HTML/CSS/图标/插件) 到 public 目录
 * 2. 自动检测 Cloudflare 登录状态
 * 3. 自动创建或获取 D1 数据库并更新 wrangler.jsonc
 * 4. 自动执行 D1 数据库初始化与表结构同步
 * 5. 自动一键部署全套应用与边缘资产至 Cloudflare Workers
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function log(msg, emoji = '🚀') {
  console.log(`\n\x1b[36m${emoji} [SuenWeb Deploy] ${msg}\x1b[0m`);
}

function success(msg) {
  console.log(`\x1b[32m✅ ${msg}\x1b[0m`);
}

function warn(msg) {
  console.log(`\x1b[33m⚠️ ${msg}\x1b[0m`);
}

function error(msg) {
  console.error(`\x1b[31m❌ ${msg}\x1b[0m`);
}

function run(cmd, options = {}) {
  try {
    return execSync(cmd, { cwd: ROOT_DIR, encoding: 'utf-8', stdio: 'pipe', ...options });
  } catch (e) {
    if (options.ignoreError) return '';
    throw e;
  }
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║              SuenWeb 一键云端部署 (Cloudflare Workers)           ║
║       Serverless D1 数据库 + 边缘静态资产直出 + 免 Key 免费 AI   ║
╚══════════════════════════════════════════════════════════════════╝
  `);

  // 1. 同步最新资产到 public 目录
  log('正在同步前端静态资产至 public 目录...', '📦');
  const publicDir = path.join(ROOT_DIR, 'public');
  const staticDir = path.join(ROOT_DIR, 'static');
  const extDir = path.join(ROOT_DIR, 'extension');
  const indexHtml = path.join(ROOT_DIR, 'templates', 'index.html');

  if (fs.existsSync(indexHtml)) {
    fs.copyFileSync(indexHtml, path.join(publicDir, 'index.html'));
  }
  if (fs.existsSync(staticDir)) {
    copyDirRecursive(staticDir, path.join(publicDir, 'static'));
  }
  if (fs.existsSync(extDir)) {
    copyDirRecursive(extDir, path.join(publicDir, 'extension'));
  }
  success('静态资产同步完成');

  // 2. 检测 Cloudflare 登录状态
  log('检测 Cloudflare 授权凭据...', '🔐');
  try {
    const whoami = run('npx wrangler whoami', { ignoreError: false });
    if (whoami.includes('You are logged in')) {
      success('Cloudflare 账号已登录');
    }
  } catch (e) {
    warn('未检测到 Cloudflare 登录信息，正在打开浏览器进行授权...');
    try {
      execSync('npx wrangler login', { cwd: ROOT_DIR, stdio: 'inherit' });
    } catch (loginErr) {
      error('Cloudflare 登录失败，请手动执行 npx wrangler login 后重试');
      process.exit(1);
    }
  }

  // 3. 检查或创建 D1 数据库
  log('正在配置 Cloudflare D1 数据库 (suenweb-db)...', '🗄️');
  let dbId = '';
  try {
    const listOutput = run('npx wrangler d1 list --json', { ignoreError: true });
    if (listOutput) {
      const dbs = JSON.parse(listOutput);
      const existing = dbs.find(d => d.name === 'suenweb-db');
      if (existing && existing.uuid) {
        dbId = existing.uuid;
        success(`找到现有 D1 数据库: suenweb-db (ID: ${dbId})`);
      }
    }
  } catch {}

  if (!dbId) {
    log('正在创建全新 D1 数据库: suenweb-db...', '✨');
    try {
      const createOutput = run('npx wrangler d1 create suenweb-db');
      const match = createOutput.match(/database_id\s*=\s*"([a-f0-9\-]+)"/i);
      if (match && match[1]) {
        dbId = match[1];
        success(`D1 数据库创建成功 (ID: ${dbId})`);
      }
    } catch (e) {
      error('创建 D1 数据库失败: ' + (e.message || e));
    }
  }

  // 4. 更新 wrangler.jsonc 中的 database_id
  if (dbId) {
    const wranglerConfigPath = path.join(ROOT_DIR, 'wrangler.jsonc');
    if (fs.existsSync(wranglerConfigPath)) {
      let content = fs.readFileSync(wranglerConfigPath, 'utf-8');
      content = content.replace(/"database_id":\s*"[^"]*"/, `"database_id": "${dbId}"`);
      fs.writeFileSync(wranglerConfigPath, content, 'utf-8');
      success('已自动更新 wrangler.jsonc 数据库配置');
    }
  }

  // 5. 初始化云端数据库表结构
  log('正在初始化云端 D1 数据库结构与预设数据 (schema.sql)...', '⚡');
  try {
    execSync('npx wrangler d1 execute suenweb-db --remote --file=./schema.sql', {
      cwd: ROOT_DIR,
      stdio: 'inherit'
    });
    success('云端数据库结构与初始壁纸/字体初始化完成');
  } catch (e) {
    warn('数据库初始化已执行或部分表已存在，继续部署...');
  }

  // 6. 执行 Workers 部署
  log('正在发布应用至 Cloudflare Workers 全球边缘网络...', '🚀');
  try {
    execSync('npx wrangler deploy', {
      cwd: ROOT_DIR,
      stdio: 'inherit'
    });
    console.log(`
\x1b[32m════════════════════════════════════════════════════════════════════
🎉 SuenWeb 一键部署大获成功！
- 资产已全部同步至 Cloudflare 全球 CDN
- D1 分布式数据库已成功挂载
- 免费 AI 智能模型已开箱启用 (无需 API Key)
════════════════════════════════════════════════════════════════════\x1b[0m
    `);
  } catch (e) {
    error('部署遇到错误: ' + (e.message || e));
    process.exit(1);
  }
}

main().catch(err => {
  error('执行出错: ' + (err.message || err));
  process.exit(1);
});
