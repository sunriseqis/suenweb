export type ClassValue = string | false | null | undefined;

/** 类名合并：模板里到处拼 cn() 比到处写字符串拼接安全 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
