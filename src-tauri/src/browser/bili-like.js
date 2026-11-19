// Executed once on the requested video's own page. Only the result is read by the shell.
(async (bvid) => {
  const failure = (message) => ({ status: 'failed', message });
  const result = async () => {
    if (location.origin !== 'https://www.bilibili.com' || location.pathname.replace(/\/$/, '') !== '/video/' + bvid)
      return failure('视频地址已改变');
    const cookie = name => document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='))?.slice(name.length + 1);
    if (!cookie('DedeUserID') && !cookie('bili_jct')) return { status: 'login' };
    const api = 'https://api.bilibili.com/x/web-interface/archive/';
    const request = async (path, options) => {
      const response = await fetch(api + path, { credentials: 'include', redirect: 'error', cache: 'no-store', ...options });
      if (!response.ok) throw Error();
      return response.json();
    };
    const err = r => r.code === -101 ? { status: 'login' }
      : failure(typeof r.message === 'string' && r.message.trim() ? r.message.trim().slice(0, 120) : 'B站未确认点赞结果');
    const state = await request('has/like?bvid=' + encodeURIComponent(bvid));
    if (state.code !== 0) return err(state);
    if (state.data === 1) return { status: 'already' };
    if (state.data !== 0) return failure('未能读取视频的点赞状态');
    const csrf = cookie('bili_jct');
    if (!csrf) return { status: 'login' };
    const reply = await request('like', { method: 'POST', body: new URLSearchParams({ bvid, like: '1', csrf }) });
    if (reply.code === 0) return { status: 'voted' };
    if (reply.code === 65006) return { status: 'already' };
    return err(reply);
  };
  try { window.__matchaBiliLikeResult = await result(); }
  catch { window.__matchaBiliLikeResult = failure('B站暂未返回结果'); }
})
