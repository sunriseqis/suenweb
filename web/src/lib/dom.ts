export type Child = Node | string | number | null | undefined | false;

export type Props = {
  class?: string;
  text?: string;
  dataset?: Record<string, string>;
  on?: Record<string, EventListener>;
  ref?: (node: HTMLElement) => void;
  [key: string]: unknown;
};

function applyProps(node: HTMLElement, props: Props): void {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value as Record<string, string>);
    else if (key === 'on') {
      for (const [event, handler] of Object.entries(value as Record<string, EventListener>)) {
        node.addEventListener(event, handler);
      }
    } else if (key === 'ref') (value as (n: HTMLElement) => void)(node);
    else if (key.length > 2 && key.startsWith('on') && typeof value === 'function') {
      // onClick / onInput 这类写法要真的挂监听，不能变成属性字符串
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    }
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
}

export function el(tag: string, props: Props = {}, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  applyProps(node, props);
  append(node, children);
  return node;
}

/** 仅放行 http/https 的绝对 URL；其它（含 javascript: 等）返回 null */
export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** 只用于静态、可信的 SVG 内部结构（不接收用户输入） */
export function svg(viewBox: string, props: Props & { inner: string }): SVGSVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', viewBox);
  node.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  for (const [key, value] of Object.entries(props)) {
    if (key === 'inner' || value === undefined || value === null || value === false) continue;
    if (key === 'class') node.setAttribute('class', String(value));
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  node.innerHTML = props.inner; // 仅静态内容：inner 只来自源码内置的 SVG 片段（icons.ts/logo.ts），不接收用户输入
  return node;
}
