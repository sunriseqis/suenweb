// 打包扩展：产物进 addons/dist（不入库）。优先用系统 zip，缺失时给出提示。
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const here = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const dist = join(here, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(here, 'manifest.json'), join(dist, 'manifest.json'));
cpSync(join(here, 'src'), join(dist, 'src'), { recursive: true });
cpSync(join(here, 'icons'), join(dist, 'icons'), { recursive: true });

const targets = [
  join(dist, 'suenweb-addon-' + pkg.version + '.xpi'),
  join(dist, 'suenweb-addon-' + pkg.version + '.zip'),
];

if (!existsSync('/usr/bin/zip') && !existsSync('/bin/zip')) {
  console.log('未找到 zip 命令：已把可加载目录准备好，位于 ' + dist);
  console.log('手动打包：cd ' + dist + ' && zip -r ../suenweb-addon-' + pkg.version + '.zip .');
  process.exit(0);
}

for (const target of targets) {
  execFileSync('zip', ['-qr', target, 'manifest.json', 'src', 'icons'], { cwd: dist });
  console.log('打包完成：' + target);
}
