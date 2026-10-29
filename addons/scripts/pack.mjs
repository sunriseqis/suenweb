// 打包扩展：Firefox 走 MV2 包（.xpi，host 权限安装即授予），Chrome/Edge 走 MV3 包（.zip）。
// 产物进 addons/dist（不入库）。
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const dist = join(here, 'dist');
const stage = join(here, '.pack');

function copyBase(target) {
  cpSync(join(here, 'src'), join(target, 'src'), { recursive: true });
  cpSync(join(here, 'icons'), join(target, 'icons'), { recursive: true });
}

rmSync(dist, { recursive: true, force: true });
rmSync(stage, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
mkdirSync(stage, { recursive: true });

// --- Firefox：MV2 ---
const ff = join(stage, 'firefox');
mkdirSync(ff, { recursive: true });
copyBase(ff);
cpSync(join(here, 'manifest_firefox.json'), join(ff, 'manifest.json'));

// --- Chrome/Edge：MV3 ---
const cr = join(stage, 'chrome');
mkdirSync(cr, { recursive: true });
copyBase(cr);
cpSync(join(here, 'manifest.json'), join(cr, 'manifest.json'));

const hasZip = (() => {
  try {
    execFileSync('zip', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

if (!hasZip) {
  console.log('未找到 zip 命令：可加载目录已就绪');
  console.log('  Firefox: ' + ff);
  console.log('  Chrome : ' + cr);
  console.log('手动打包：cd ' + ff + ' && zip -r ../suenweb-addon-' + pkg.version + '.xpi .');
  process.exit(0);
}

const outXpi = join(dist, 'suenweb-addon-' + pkg.version + '-firefox.xpi');
const outZip = join(dist, 'suenweb-addon-' + pkg.version + '-chrome.zip');
execFileSync('zip', ['-qr', outXpi, 'manifest.json', 'src', 'icons'], { cwd: ff });
execFileSync('zip', ['-qr', outZip, 'manifest.json', 'src', 'icons'], { cwd: cr });
console.log('打包完成：' + outXpi + '  (Firefox · MV2)');
console.log('打包完成：' + outZip + '  (Chrome/Edge · MV3)');
