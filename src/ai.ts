import { Env } from './types';

export interface AIConfig {
  llm_url?: string;
  llm_key?: string;
  llm_model?: string;
}

export interface LinkItem {
  id: number;
  title: string;
  url: string;
  description?: string;
}

async function runWithTimeout<T>(promise: Promise<T>, ms: number = 6000): Promise<T> {
  let timer: any;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Workers AI timeout')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate a single link description using Free AI (Cloudflare Workers AI or Custom LLM)
 */
export async function generateSingleDescription(
  title: string,
  url: string,
  config: AIConfig,
  env: Env
): Promise<string> {
  const prompt = `为这个网站写一句简短中文描述（不超过15字）。只返回纯文本描述，不要包含任何前缀、引号或解释。

网站：${title}
网址：${url}`;

  // 1. Custom OpenAI-compatible endpoint if specified by user
  if (config.llm_url && config.llm_key) {
    const desc = await callCustomOpenAI(prompt, config);
    if (desc) return desc;
  }

  // 2. Cloudflare Workers AI (Free, 0-API-Key built-in)
  if (env.AI) {
    try {
      const model = config.llm_model && config.llm_model.startsWith('@cf/')
        ? config.llm_model
        : '@cf/meta/llama-3.1-8b-instruct';

      const response: any = await runWithTimeout(
        env.AI.run(model, {
          messages: [
            { role: 'system', content: '你是一个精通中文的网站书签整理助手。请为用户提供的网站生成一句精炼准确的中文短描述（不超过15字）。严禁多余废话。' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 60
        }),
        6000
      );

      let text = '';
      if (typeof response === 'string') {
        text = response;
      } else if (response && response.response) {
        text = response.response;
      } else if (response && response.choices && response.choices[0]) {
        text = response.choices[0].message?.content || '';
      }

      text = sanitizeDescription(text);
      if (text) return text;
    } catch (e: any) {
      console.warn('Workers AI call failed:', e);
      // If primary CF model fails, try Chinese Qwen model
      try {
        const response: any = await runWithTimeout(
          env.AI.run('@cf/qwen/qwen1.5-7b-chat', {
            messages: [
              { role: 'system', content: '为网站写一句简短中文描述（不超过15字），只返回描述文本。' },
              { role: 'user', content: prompt }
            ],
            max_tokens: 60
          }),
          5000
        );
        const text = sanitizeDescription(response?.response || response?.choices?.[0]?.message?.content || '');
        if (text) return text;
      } catch (err) {
        console.error('Fallback Workers AI failed:', err);
      }
    }
  }

  // 3. Smart local heuristic fallback if AI unavailable
  return generateHeuristicDescription(title, url);
}

/**
 * Generate bulk link descriptions in one or more batches using Free AI
 */
export async function generateBulkDescriptions(
  links: LinkItem[],
  config: AIConfig,
  env: Env
): Promise<{ id: number; desc: string }[]> {
  const results: { id: number; desc: string }[] = [];
  if (!links || links.length === 0) return results;

  // Process in batches of 10 to ensure high quality and stay within token limits
  const batchSize = 10;
  for (let i = 0; i < links.length; i += batchSize) {
    const batch = links.slice(i, i + batchSize);
    const batchPromptList = batch.map((l, idx) => ({ id: idx, title: l.title, url: l.url }));
    const prompt = `为以下网站列表生成中文描述（每项不超过15字）。严格按照 JSON 数组格式返回，不要任何其他文字或 markdown 标签。

格式示例：[{"id": 0, "desc": "代码托管与开源协作平台"}, {"id": 1, "desc": "中文网络问答与创作社区"}]

待处理网站列表：
${JSON.stringify(batchPromptList, null, 2)}`;

    let responseText = '';

    // 1. Custom LLM
    if (config.llm_url && config.llm_key) {
      responseText = await callCustomOpenAI(prompt, config);
    }

    // 2. Cloudflare Workers AI
    if (!responseText && env.AI) {
      try {
        const model = config.llm_model && config.llm_model.startsWith('@cf/')
          ? config.llm_model
          : '@cf/meta/llama-3.1-8b-instruct';

        const aiRes: any = await runWithTimeout(
          env.AI.run(model, {
            messages: [
              { role: 'system', content: '你是一个专业的网站分类与摘要生成助手。请严格输出合法的 JSON 数组，包含 id 和 desc 字段。' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.2,
            max_tokens: 800
          }),
          8000
        );

        responseText = aiRes?.response || aiRes?.choices?.[0]?.message?.content || '';
      } catch (e) {
        console.warn('Bulk Workers AI failed:', e);
      }
    }

    // Parse JSON or extract fallback
    const parsed = safeParseJsonArray(responseText);
    if (Array.isArray(parsed) && parsed.length > 0) {
      for (const item of parsed) {
        const idx = typeof item.id === 'number' ? item.id : parseInt(item.id, 10);
        if (idx >= 0 && idx < batch.length) {
          const desc = sanitizeDescription(item.desc || item.description || '');
          if (desc) {
            results.push({ id: batch[idx].id, desc });
          }
        }
      }
    } else {
      // Line by line regex fallback
      const lines = responseText.split('\n');
      for (const line of lines) {
        const match = line.match(/^(\d+)[:：.、\s]+(.*)/);
        if (match) {
          const idx = parseInt(match[1], 10);
          const desc = sanitizeDescription(match[2]);
          if (idx >= 0 && idx < batch.length && desc) {
            results.push({ id: batch[idx].id, desc });
          }
        }
      }

      // If still missing for any items in batch, use heuristic fallback
      for (const link of batch) {
        if (!results.some(r => r.id === link.id)) {
          results.push({ id: link.id, desc: generateHeuristicDescription(link.title, link.url) });
        }
      }
    }
  }

  return results;
}

/**
 * Call custom OpenAI-compatible API
 */
async function callCustomOpenAI(prompt: string, config: AIConfig): Promise<string> {
  try {
    const endpoint = config.llm_url!.replace(/\/+$/, '') + '/chat/completions';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.llm_key}`
      },
      body: JSON.stringify({
        model: config.llm_model || 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      })
    });

    if (!res.ok) return '';
    const json: any = await res.json();
    return json?.choices?.[0]?.message?.content || '';
  } catch (e) {
    console.error('Custom OpenAI API error:', e);
    return '';
  }
}

/**
 * Clean up output description
 */
function sanitizeDescription(text: string): string {
  if (!text) return '';
  let cleaned = text.trim();
  // Remove markdown quotes and code blocks
  cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
  cleaned = cleaned.replace(/^["'“‘](.*)["'”’]$/, '$1');
  cleaned = cleaned.replace(/^描述[:：]\s*/, '');
  cleaned = cleaned.replace(/^网站描述[:：]\s*/, '');
  return cleaned.substring(0, 30).trim();
}

/**
 * Safe JSON parser for arrays with markdown wrapping support
 */
function safeParseJsonArray(text: string): any[] | null {
  if (!text) return null;
  let raw = text.trim();
  raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  try {
    const res = JSON.parse(raw);
    if (Array.isArray(res)) return res;
  } catch {}

  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const sub = raw.substring(start, end + 1);
      const res = JSON.parse(sub);
      if (Array.isArray(res)) return res;
    } catch {}
  }

  return null;
}

/**
 * Intelligent heuristic description based on domain and title
 */
function generateHeuristicDescription(title: string, url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('github.com')) return '全球开源代码托管与协作平台';
    if (host.includes('bilibili.com')) return '国内知名的弹幕视频分享社区';
    if (host.includes('zhihu.com')) return '中文互联网问答与深度讨论社区';
    if (host.includes('v2ex.com')) return '创意工作者与程序员讨论社区';
    if (host.includes('juejin.cn')) return '掘金开发者技术交流与分享社区';
    if (host.includes('google.com')) return '全球最大的搜索引擎';
    if (host.includes('bing.com')) return '微软必应智能搜索引擎';
    if (host.includes('baidu.com')) return '全球最大的中文搜索引擎';
    if (host.includes('youtube.com')) return '全球最大的视频分享与播放平台';
    if (host.includes('twitter.com') || host.includes('x.com')) return '全球热门即时信息与社交平台';
    if (host.includes('notion.so')) return '一站式笔记协作与项目管理空间';
    if (host.includes('cloudflare.com')) return '全球领先的云网络与边缘计算平台';
  } catch {}

  const t = title.trim();
  if (t.length > 0 && t.length <= 15) return t;
  return t.substring(0, 15);
}

/**
 * Asynchronous Link Health Checker (Parallel with concurrency control)
 */
export async function checkLinksHealth(
  links: { id: number; title: string; url: string; group_name: string }[]
): Promise<{ total: number; working: number; broken: number; results: any[] }> {
  const total = links.length;
  let working = 0;
  let broken = 0;
  const results: any[] = [];

  const checkOne = async (link: { id: number; title: string; url: string; group_name: string }) => {
    try {
      const parsed = new URL(link.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return {
          id: link.id,
          title: link.title,
          url: link.url,
          group: link.group_name,
          status: 0,
          ok: false,
          error: '不支持的 URL 协议'
        };
      }

      // Try HEAD request first, fallback to GET if 405 or 403
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      let res = await fetch(link.url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: controller.signal,
        redirect: 'follow'
      }).catch(async () => {
        return await fetch(link.url, {
          method: 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: controller.signal,
          redirect: 'follow'
        });
      });

      clearTimeout(timeoutId);

      const ok = res.status >= 200 && res.status < 400;
      return {
        id: link.id,
        title: link.title,
        url: link.url,
        group: link.group_name,
        status: res.status,
        ok,
        error: ok ? '' : `HTTP ${res.status}`
      };
    } catch (e: any) {
      return {
        id: link.id,
        title: link.title,
        url: link.url,
        group: link.group_name,
        status: 0,
        ok: false,
        error: e.name === 'AbortError' ? '请求超时 (6s)' : (e.message || '连接失败')
      };
    }
  };

  // Run in chunks of 8 parallel requests
  const chunkSize = 8;
  for (let i = 0; i < links.length; i += chunkSize) {
    const chunk = links.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(checkOne));
    for (const r of chunkResults) {
      results.push(r);
      if (r.ok) working++;
      else broken++;
    }
  }

  return { total, working, broken, results };
}
