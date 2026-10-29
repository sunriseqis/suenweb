#!/usr/bin/env node
/**
 * 飞牛 fnOS 原生应用套件（.fpk）构建脚本。
 * 结构照搬 SuenMusic 实证版本（scripts/build-fn.mjs），关键坑都已规避：
 *   - node_modules/.bin 软链必须删除（fnpack 会把软链改写成死链 → 安装报权限错）
 *   - 生产依赖必须 npm ci --omit=dev 重新安装（不可拷开发目录）
 *   - 打包前硬校验 fn/ 下无软链
 *   - 前端产物陈旧检测（改了源码没重新构建就强制重编）
 *
 * 用法：node scripts/build-fn.mjs
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { chmod, cp, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.umask(0o022);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FN_DIR = join(ROOT, 'fn');
const APP_DIR = join(FN_DIR, 'app');
const OUTPUT_DIR = join(ROOT, 'output');
const CACHE_DIR = join(homedir(), '.cache/suenweb-fn');

function log(msg) {
  console.log('[build-fn] ' + msg);
}

function fail(message) {
  console.error('\n✖ [build-fn] ' + message);
  process.exit(1);
}

function newestMtime(dir) {
  let newest = 0;
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'public') continue;
        walk(full);
        continue;
      }
      try {
        const m = statSync(full).mtimeMs;
        if (m > newest) newest = m;
      } catch {
        /* ignore */
      }
    }
  };
  walk(dir);
  return newest;
}

function run(command, args, options = {}) {
  console.log('\n$ ' + command + ' ' + args.join(' '));
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

async function readSemver() {
  const raw = await readFile(join(ROOT, 'server/package.json'), 'utf8');
  const m = JSON.parse(raw).version.match(/(\d+\.\d+\.\d+)/);
  if (!m) fail('无法从 server/package.json version 解析语义化版本');
  return m[1];
}

async function injectManifestVersion(semver) {
  log('1/6 同步版本号至 fn/manifest: ' + semver);
  const manifestPath = join(FN_DIR, 'manifest');
  if (!existsSync(manifestPath)) fail('找不到 manifest: ' + manifestPath);
  let content = await readFile(manifestPath, 'utf8');
  content = content.replace(/version\s*=\s*[^\r\n]*/, 'version               = ' + semver);
  await writeFile(manifestPath, content, 'utf8');
}

async function updateIconAssets() {
  log('2/6 生成套件图标（64/256，纯 Node 光栅化）...');
  const master = join(ROOT, 'addons', 'scripts', 'make-icons.mjs');
  if (!existsSync(master)) fail('找不到图标生成脚本: ' + master);
  const code = await readFile(master, 'utf8');
  const patched = code
    .replace(/const dir = .*/, "const dir = '" + join(APP_DIR, 'ui/images') + "/';")
    .replace(/for \(const size of \[16, 32, 48, 96, 128\]\) \{/, 'for (const size of [64, 256]) {')
    .replace(/'icon-' \+ size \+ '\.png'/, "(size === 256 ? 'icon_256.png' : 'icon_64.png')");
  if (!patched.includes('icon_256.png')) fail('图标脚本补丁异常：产物中缺少 icon_256 片段');
  await mkdir(join(APP_DIR, 'ui/images'), { recursive: true });
  const tmp = join(ROOT, 'scripts', '.tmp-icons.mjs');
  await writeFile(tmp, patched, 'utf8');
  try {
    run('node', [tmp]);
  } finally {
    await rm(tmp, { force: true });
  }
  await cp(join(APP_DIR, 'ui/images', 'icon_256.png'), join(FN_DIR, 'ICON_256.PNG'));
  await cp(join(APP_DIR, 'ui/images', 'icon_64.png'), join(FN_DIR, 'ICON.PNG'));
  log('图标就绪: ICON_256.PNG / ICON.PNG');
}

async function ensureStandaloneNode() {
  log('3/6 准备原生自包含 Node.js 运行时...');
  const nodeVersion = 'v24.18.1';
  const nodeDirName = 'node-' + nodeVersion + '-linux-x64';
  const nodeDir = join(CACHE_DIR, nodeDirName);
  const cachedNodeBin = join(nodeDir, 'bin/node');
  const okMarker = join(nodeDir, '.ok');

  const nodeTarName = nodeDirName + '.tar.xz';

  // 缓存有效条件：bin/node 存在且 .ok 标记存在且内容核对通过（防半截解压复用）
  const cacheValid = (() => {
    if (!(existsSync(cachedNodeBin) && existsSync(okMarker))) return false;
    try {
      const recorded = readFileSync(okMarker, 'utf8').trim();
      const actualSha = createHash('sha256').update(readFileSync(cachedNodeBin)).digest('hex');
      const actualSize = statSync(cachedNodeBin).size;
      return recorded === actualSha + ' ' + actualSize;
    } catch {
      return false;
    }
  })();
  if (cacheValid) {
    log('命中 Node.js 运行时缓存（sha256 与大小核对通过）');
  }
  if (!cacheValid) {
    log('下载独立 Node.js 运行时 (' + nodeVersion + ' linux-x64)...');
    await mkdir(CACHE_DIR, { recursive: true });
    const tarFile = join(CACHE_DIR, nodeDirName + '.tar.xz');
    const shasumsUrl = 'https://nodejs.org/dist/' + nodeVersion + '/SHASUMS256.txt';
    const download = async (url) => {
      run('curl', ['-fSL', url, '-o', tarFile]);
      const shasums = execFileSync('curl', ['-fsSL', shasumsUrl], { encoding: 'utf8' });
      const expected = (shasums.split('\n').find((line) => line.endsWith(' ' + nodeDirName + '.tar.xz') || line.includes(nodeDirName + '.tar.xz')) ?? '').split(/\s+/)[0] ?? '';
      if (!/^[0-9a-f]{64}$/.test(expected)) fail('无法从官方 SHASUMS256.txt 提取 ' + nodeDirName + '.tar.xz 的 sha256');
      const actual = createHash('sha256').update(await readFile(tarFile)).digest('hex');
      if (actual !== expected) {
        await rm(tarFile, { force: true });
        fail('Node.js tarball sha256 校验失败：期望 ' + expected + '，实际 ' + actual);
      }
      log('Node.js tarball sha256 校验通过: ' + actual);
    };
    const mirrorUrl = 'https://npmmirror.com/mirrors/node/' + nodeVersion + '/' + nodeDirName + '.tar.xz';
    const officialUrl = 'https://nodejs.org/dist/' + nodeVersion + '/' + nodeDirName + '.tar.xz';
    try {
      await download(mirrorUrl);
    } catch (err) {
      log('镜像下载/校验失败，回退官方源: ' + (err?.message ?? err));
      await download(officialUrl);
    }
    await rm(nodeDir, { recursive: true, force: true });
    await run('tar', ['-xJf', tarFile, '-C', CACHE_DIR]);
    if (!existsSync(cachedNodeBin)) fail('解压后未找到 ' + cachedNodeBin);
    const nodeSha = createHash('sha256').update(readFileSync(cachedNodeBin)).digest('hex');
    await writeFile(okMarker, nodeSha + ' ' + statSync(cachedNodeBin).size + '\n', 'utf8');
    await rm(tarFile, { force: true });
  }

  const appBinDir = join(APP_DIR, 'bin');
  await mkdir(appBinDir, { recursive: true });
  await cp(cachedNodeBin, join(appBinDir, 'node'));
  await chmod(join(appBinDir, 'node'), 0o755);
  log('Node.js 运行时就绪');
}

async function prepareNativeAppPayload() {
  log('4/6 装配原生服务端与 Web SPA 静态资产...');
  const webDir = join(ROOT, 'web');
  const webDist = join(ROOT, 'public');
  const distMissing = !existsSync(join(webDist, 'index.html'));
  let distStale = false;
  if (!distMissing) {
    const srcNewest = Math.max(
      newestMtime(join(webDir, 'src')),
      ...[join(webDir, 'index.html'), join(webDir, 'vite.config.ts'), join(webDir, 'package.json'), join(webDir, 'package-lock.json')]
        .filter(existsSync)
        .map((f) => { try { return statSync(f).mtimeMs; } catch { return 0; } }),
    );
    distStale = srcNewest > newestMtime(webDist);
    if (distStale) log('public/ 比前端源码旧，强制重新构建');
  }
  if (distMissing || distStale) {
    log(distMissing ? 'public/ 不存在，执行前端构建...' : '重新构建前端...');
    run('npm', ['run', 'build'], { cwd: webDir });
  }

  const appWebDist = join(APP_DIR, 'web/dist');
  await rm(appWebDist, { recursive: true, force: true });
  await mkdir(dirname(appWebDist), { recursive: true });
  await cp(webDist, appWebDist, { recursive: true });

  const appServer = join(APP_DIR, 'server');
  await rm(appServer, { recursive: true, force: true });
  await mkdir(appServer, { recursive: true });
  await cp(join(ROOT, 'server/src'), join(appServer, 'src'), { recursive: true });
  await cp(join(ROOT, 'server/package.json'), join(appServer, 'package.json'));
  await cp(join(ROOT, 'server/package-lock.json'), join(appServer, 'package-lock.json'));

  log('安装生产依赖（npm ci --omit=dev，严格按 lockfile）...');
  try {
    run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: appServer });
  } catch (err) {
    fail('生产依赖安装失败（打包需要网络）: ' + (err?.message ?? err));
  }
  for (const name of ['typescript', '@types']) {
    const target = join(appServer, 'node_modules', name);
    if (existsSync(target)) {
      await rm(target, { recursive: true, force: true });
      log('已清理生产依赖残留: ' + name);
    }
  }
  // .bin 软链必须删：fnpack 会把相对软链改写成死链 → fnOS 安装报「设置目录权限失败」
  const pkgBinDir = join(appServer, 'node_modules', '.bin');
  if (existsSync(pkgBinDir)) {
    await rm(pkgBinDir, { recursive: true, force: true });
    log('已移除 node_modules/.bin');
  }
  log('打包浏览器插件产物...');
  try {
    const distDir = join(ROOT, 'addons/dist');
    const signedFiles = existsSync(distDir) ? (await readdir(distDir)).filter((f) => f.includes('-signed.')) : [];
    const backupDir = join(ROOT, 'scripts/.signed-backup');
    for (const f of signedFiles) {
      await mkdir(backupDir, { recursive: true });
      await cp(join(distDir, f), join(backupDir, f));
    }
    run('npm', ['run', 'pack'], { cwd: join(ROOT, 'addons') });
    for (const f of signedFiles) {
      await cp(join(backupDir, f), join(distDir, f));
      log('已还原 AMO 签名版: ' + f);
    }
    if (signedFiles.length) await rm(backupDir, { recursive: true, force: true });
  } catch {
    log('[WARN] 插件打包失败，套件里将没有下载产物（接口会返回指引）');
  }
  // AMO 签名版保护：pack.mjs 会清空 dist，签名版需在 pack 前备份、pack 后还原
  // （改为：pack 前把 *-signed.xpi 挪到临时目录，pack 后挪回）

  // 插件包产物：服务端 /extension/download/* 读 <repoRoot>/addons/dist，包内 repoRoot = app/
  const appAddonDist = join(APP_DIR, 'addons/dist');
  await rm(appAddonDist, { recursive: true, force: true });
  if (existsSync(join(ROOT, 'addons/dist'))) {
    await mkdir(appAddonDist, { recursive: true });
    await cp(join(ROOT, 'addons/dist'), appAddonDist, { recursive: true });
    log('已打入插件下载产物: ' + (await readdir(join(ROOT, 'addons/dist'))).length + ' 个文件（含 AMO 签名版）');
  }

  // smoke 验证：用包内 node 以 strip-types 直接 import 服务端模块，证明运行时与依赖完整
  log('smoke 验证：包内 node 加载 server/src/config.ts...');
  const smokeNode = join(APP_DIR, 'bin/node');
  const smokeNodeBin = existsSync(smokeNode) ? smokeNode : 'node';
  try {
    const out = execFileSync(smokeNodeBin, [
      '--experimental-strip-types', '--disable-warning=ExperimentalWarning',
      '--input-type=module', '-e', 'await import("./server/src/config.ts"); console.log("smoke ok");',
    ], { cwd: APP_DIR, encoding: 'utf8', timeout: 60000 });
    if (!out.includes('smoke ok')) fail('smoke 验证输出异常：' + out.trim());
    log('smoke ok');
  } catch (err) {
    fail('smoke 验证失败（包内 node 无法加载 server/src/config.ts）: ' + (err?.message ?? err));
  }

  log('规范套件权限 (目录 755 / 文件 644 / 脚本与 node 755)...');
  run('find', [FN_DIR, '-type', 'd', '-exec', 'chmod', '755', '{}', '+']);
  run('find', [FN_DIR, '-type', 'f', '-exec', 'chmod', '644', '{}', '+']);
  const cmdDir = join(FN_DIR, 'cmd');
  run('chmod', ['+x', ...['main', 'install_init', 'install_callback', 'uninstall_init', 'uninstall_callback', 'upgrade_init', 'upgrade_callback', 'config_init', 'config_callback'].map((f) => join(cmdDir, f))]);
  const appBinNode = join(APP_DIR, 'bin/node');
  if (existsSync(appBinNode)) await chmod(appBinNode, 0o755);
}

async function ensureFnpack() {
  log('5/6 检查 fnpack 官方打包工具...');
  try {
    const which = execFileSync('which', ['fnpack'], { encoding: 'utf8' }).trim();
    if (which) {
      log('使用系统 fnpack: ' + which);
      return which;
    }
  } catch {
    /* not in PATH */
  }
  const localBin = join(ROOT, 'node_modules/.bin/fnpack');
  if (existsSync(localBin)) return localBin;
  const url = 'https://static2.fnnas.com/fnpack/fnpack-1.2.1-linux-amd64';
  // 供应链校验：sha256 取自 2026 一次性下载实测（来源 URL 见上，fnpack 1.2.1 linux-amd64，3764408 字节）
  const expectedSha256 = '72d2a4095da676b64510b023731a227b369d80f8079bc45ff8a2f802ec0480c1';
  log('未检测到 fnpack，下载官方工具: ' + url);
  await mkdir(join(ROOT, 'node_modules/.bin'), { recursive: true });
  run('curl', ['-fSL', url, '-o', localBin]);
  const actual = createHash('sha256').update(await readFile(localBin)).digest('hex');
  if (actual !== expectedSha256) {
    await rm(localBin, { force: true });
    fail('fnpack sha256 校验失败：期望 ' + expectedSha256 + '，实际 ' + actual);
  }
  log('fnpack sha256 校验通过');
  await chmod(localBin, 0o755);
  return localBin;
}

async function assertNoSymlinks() {
  const links = execFileSync('find', [FN_DIR, '-type', 'l'], { encoding: 'utf8' }).trim();
  if (links) fail('fn/ 下不允许存在软链（打进 fpk 会变死链，安装必失败）：\n' + links);
}

async function assembleFpk(fnpackBin, semver) {
  log('6/6 执行 fnpack build...');
  await assertNoSymlinks();
  await mkdir(OUTPUT_DIR, { recursive: true });
  const rawTarget = join(FN_DIR, 'suenweb.fpk');
  if (existsSync(rawTarget)) await unlink(rawTarget);
  const staleTgz = join(FN_DIR, 'app.tgz');
  if (existsSync(staleTgz)) await unlink(staleTgz);

  run(fnpackBin, ['build', '-d', '.'], { cwd: FN_DIR });

  if (!existsSync(rawTarget)) fail('打包完成但未找到产物: ' + rawTarget);
  const finalName = 'suenweb-v' + semver + '.fpk';
  const finalPath = join(OUTPUT_DIR, finalName);
  await rename(rawTarget, finalPath);
  await chmod(finalPath, 0o644);

  const fileStat = await stat(finalPath);
  const sizeMb = (fileStat.size / (1024 * 1024)).toFixed(2);
  const sha256 = createHash('sha256').update(await readFile(finalPath)).digest('hex');
  console.log('\n============================================================');
  console.log('✔ 飞牛 fnOS 原生应用套件打包成功！');
  console.log('  安装包: output/' + finalName);
  console.log('  包体积: ' + fileStat.size + ' 字节 (' + sizeMb + ' MB)');
  console.log('  SHA256: ' + sha256);
  console.log('============================================================\n');
}

async function main() {
  const semver = await readSemver();
  await injectManifestVersion(semver);
  await updateIconAssets();
  await ensureStandaloneNode();
  await prepareNativeAppPayload();
  const fnpackBin = await ensureFnpack();
  await assembleFpk(fnpackBin, semver);
}

main().catch((err) => fail(err?.stack || String(err)));
