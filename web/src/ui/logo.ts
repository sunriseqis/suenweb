// 品牌标来自 docs/design/logo原型.svg（用户提供），此处只做尺寸与取色适配
import raw from '../assets/logo.svg?raw';
import { svg } from '../lib/dom.ts';

const INNER = raw
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>[\s\S]*$/, '')
  .replace(/fill="(?!none)[^"]*"/g, 'fill="currentColor"');

export function brandLogo(size = 28, className = ''): SVGSVGElement {
  return svg('0 0 1024 1024', {
    inner: INNER,
    width: String(size),
    height: String(size),
    viewBox: '0 0 1024 1024',
    fill: 'currentColor',
    class: className,
    'aria-hidden': 'true',
    focusable: 'false',
  });
}
