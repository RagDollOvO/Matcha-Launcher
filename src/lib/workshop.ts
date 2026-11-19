/** 从粘贴的文字里取出创意工坊条目 ID：链接里的 ?id=、steam:// 链接、或单独一行数字 */
export function parseWorkshopIds(text: string): string[] {
  const out = new Set<string>();
  for (const token of text.split(/[\s,，;；]+/)) {
    if (!token) continue;
    const m = token.match(/[?&]id=(\d+)/) ?? token.match(/CommunityFilePage\/(\d+)/i) ?? token.match(/^(\d+)$/);
    if (m && /^[1-9]\d{0,19}$/.test(m[1])) out.add(m[1]);
  }
  return [...out];
}
/** Ctrl+V 时只认明确的工坊链接，单纯的数字不拦截 */
export const looksLikeWorkshop = (text: string) => /steamcommunity\.com\/(?:sharedfiles|workshop)\/filedetails|CommunityFilePage\//i.test(text);
/** 搜索框里的纯数字：真实工坊 ID 至少 8 位，短数字（如 "30"）当普通关键词搜索 */
export const looksLikeWorkshopId = (text: string) => /^[1-9]\d{7,19}$/.test(text.trim());
