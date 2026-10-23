export type Child = Node | string | number | null | undefined | false;

export type Props = {
  class?: string;
  text?: string;
  html?: string;
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
    else if (key === 'html') node.innerHTML = String(value);
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
  node.innerHTML = props.inner;
  return node;
}
