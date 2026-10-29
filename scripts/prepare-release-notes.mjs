/**
 * 跨端发布说明幂等合并工具（对齐 suenmusic 实证版）。
 *
 * suenapp 公共仓的同一个 Release（如 v2.0.0）会被多个项目共用（suenmusic / suenweb / ...）。
 * 本脚本通过带标记的 SECTION 分区，实现：
 *   1. 首次发布本端：追加到 Release 说明中；
 *   2. 重复构建本端：幂等更新替换本端段落，其它项目段落不受影响。
 *
 * 用法：
 *   node scripts/prepare-release-notes.mjs --platform fnos --tag v2.0.0 --output /tmp/release_body.md
 */

import { writeFileSync } from 'node:fs';

const PLATFORMS = {
  fnos: {
    id: 'SUENWEB-FNOS',
    titleRegex: /###\s+SuenWeb\s+.*?飞牛私有云[\s\S]*?(?=(?:###\s+Suen(?:Music|Web|Money)|<!-- SECTION:)|$)/gi,
    content: function (tag) {
      const L = [];
      L.push('<!-- SECTION:SUENWEB-FNOS -->');
      L.push('### SuenWeb ' + tag + ' 飞牛私有云（fnOS）原生套件');
      L.push('');
      L.push('- **格式**：`.fpk` 纯原生系统运行（免 Docker，零虚拟化损耗）。');
      L.push('- **功能**：自托管书签服务，内置安装引导，浏览器插件一键收藏与实时同步，AMO 签名版插件可从应用内下载。');
      L.push('<!-- /SECTION:SUENWEB-FNOS -->');
      return L.join('\n');
    }
  }
};

function parseArgs() {
  const args = process.argv.slice(2);
  let platform = '';
  let tag = '';
  let output = '';
  let repo = process.env.RELEASE_REPO || 'sunriseqis/suenapp';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--platform' && args[i + 1]) platform = args[++i];
    if (args[i] === '--tag' && args[i + 1]) tag = args[++i];
    if (args[i] === '--output' && args[i + 1]) output = args[++i];
    if (args[i] === '--repo' && args[i + 1]) repo = args[++i];
  }

  if (!platform || !tag || !output) {
    console.error('用法: node scripts/prepare-release-notes.mjs --platform <fnos> --tag <vX.Y.Z> --output <file>');
    process.exit(1);
  }

  return { platform, tag, output, repo };
}

async function fetchExistingReleaseBody(repo, tag) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_RELEASE_TOKEN || process.env.SUENAPP_TOKEN || '';
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'suenweb-ci' };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { headers });
    if (res.status === 404) return '';
    if (!res.ok) {
      console.warn(`[WARN] 获取现有 Release 失败 (HTTP ${res.status})，将作为全新 Release 处理`);
      return '';
    }
    const data = await res.json();
    return typeof data.body === 'string' ? data.body : '';
  } catch (err) {
    console.warn(`[WARN] 无法连接 GitHub API: ${err.message}，按全新 Release 处理`);
    return '';
  }
}

export function mergeBody(existing, platform, tag) {
  const conf = PLATFORMS[platform];
  if (!conf) throw new Error('Unsupported platform: ' + platform);
  const newContent = conf.content(tag).trim();

  let body = (existing || '').trim();
  const markedRegex = new RegExp(`<!-- SECTION:${conf.id} -->[\\s\\S]*?<!-- /SECTION:${conf.id} -->`, 'gi');
  const titleRegex = new RegExp(conf.titleRegex.source, 'gi');

  if (markedRegex.test(body)) {
    markedRegex.lastIndex = 0;
    let replacedFirst = false;
    body = body.replace(markedRegex, () => {
      if (!replacedFirst) { replacedFirst = true; return newContent; }
      return '';
    });
  } else if (titleRegex.test(body)) {
    titleRegex.lastIndex = 0;
    let replacedFirst = false;
    body = body.replace(titleRegex, () => {
      if (!replacedFirst) { replacedFirst = true; return newContent; }
      return '';
    });
  } else {
    body = body ? `${body}\n\n${newContent}` : newContent;
  }

  return body.replace(/\n{3,}/g, '\n\n').trim();
}

async function main() {
  const { platform, tag, output, repo } = parseArgs();
  console.log(`[Release Notes] 平台 ${platform} (Tag: ${tag}, Repo: ${repo})...`);

  const existingBody = await fetchExistingReleaseBody(repo, tag);
  const mergedBody = mergeBody(existingBody, platform, tag);

  writeFileSync(output, mergedBody + '\n', 'utf8');
  console.log(`[Release Notes] 已写入: ${output}`);
}

main().catch(err => {
  console.error('[Release Notes] 错误:', err);
  process.exit(1);
});
