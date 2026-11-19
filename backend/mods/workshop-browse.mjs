import { fail } from './files.mjs';
import { workshopId } from './library.mjs';

const sorts = ['trend', 'mostrecent', 'lastupdated', 'totaluniquesubscribers'];
export function browseUrl({ search = '', sort = 'trend', tag = '', page = 1, kind = 'item' } = {}) {
  if (typeof search !== 'string' || search.length > 200 || typeof tag !== 'string' || tag.length > 80 ||
      !sorts.includes(sort) || !Number.isInteger(page) || page < 1 || page > 1000 || !['item', 'collection'].includes(kind)) {
    fail('invalid_argument', '请检查工坊搜索条件（关键词最多 200 字，第 1–1000 页）。');
  }
  const url = new URL('https://steamcommunity.com/workshop/browse/');
  url.search = new URLSearchParams({ appid: '550', browsesort: sort, section: kind === 'collection' ? 'collections' : 'readytouseitems',
    days: '7', p: String(page), numperpage: '30', searchtext: search.trim(), l: 'schinese' }).toString();
  if (tag) url.searchParams.set('requiredtags[]', tag);
  return url.href;
}

// Read Steam's public SSR JSON as data; never evaluate the page's scripts/markup.
export function parseBrowse(html) {
  try {
    const json = html.match(/<script\b[^>]*\bid="valve-ssr-data"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
    const ssr = JSON.parse(json), queries = JSON.parse(ssr.renderContext.queryData).queries;
    const query = queries.find(q => q.queryKey?.[0] === 'workshop_browse' && q.queryKey?.[1]?.appid === 550);
    const data = query?.state?.data;
    if (data?.eresult !== 1 || !Array.isArray(data.results) || data.results.length > 100 ||
        !Number.isInteger(data.current_page) || !Number.isInteger(data.total_pages) || !Number.isInteger(data.total_count)) throw new Error('shape');
    if (data.results.some(r => !workshopId(r.publishedfileid) || r.consumer_appid !== 550)) throw new Error('items');
    const authors = new Map(queries.filter(q => q.queryKey?.[0] === 'PlayerLinkDetails').map(q => {
      const p = q.state?.data?.public_data; return [p?.steamid, p?.persona_name];
    }));
    return { raws: data.results, authors, page: data.current_page, totalPages: Math.min(1000, Math.max(1, data.total_pages)), total: data.total_count };
  } catch {
    fail('workshop_page_changed', 'Steam 列表暂时读取失败，请重试，或在 Steam 查看。');
  }
}

export function descriptionText(value) {
  return String(value ?? '').slice(0, 60000)
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '$2 ($1)')
    .replace(/\[(?:\/?(?:h[1-6]|b|i|u|strike|spoiler|quote|code|list|olist|table|tr|td|th|previewyoutube|img)(?:=[^\]]*)?|\*)\]/gi, '\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}
