/** 官方战役：编号 → [中文名, 章节数]。地图代码形如 c2m1_highway */
const CAMPAIGNS: Record<number, [string, number]> = {
  1: ['死亡中心', 4], 2: ['黑色狂欢节', 5], 3: ['沼泽激战', 4], 4: ['暴风骤雨', 5], 5: ['教区', 5],
  6: ['短暂时刻', 3], 7: ['牺牲', 3], 8: ['毫不留情', 5], 9: ['坠机险途', 2], 10: ['死亡丧钟', 5],
  11: ['静寂时分', 5], 12: ['血腥收获', 5], 13: ['刺骨寒溪', 4], 14: ['临死一搏', 2],
};

export interface Campaign { name: string; chapter: number; chapters: number }

/** 官方地图返回战役名和章节；三方图返回 null */
export function campaignOf(map: string | null | undefined): Campaign | null {
  const m = /^c(\d{1,2})m(\d)_/i.exec(map ?? '');
  const c = m ? CAMPAIGNS[Number(m[1])] : undefined;
  if (!m || !c) return null;
  const chapter = Number(m[2]);
  return chapter >= 1 && chapter <= c[1] ? { name: c[0], chapter, chapters: c[1] } : null;
}
