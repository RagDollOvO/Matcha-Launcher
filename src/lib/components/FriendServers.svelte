<script lang="ts">
  import Users from '@lucide/svelte/icons/users';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Star from '@lucide/svelte/icons/star';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import Copy from '@lucide/svelte/icons/copy';
  import MapIcon from '@lucide/svelte/icons/map';
  import Signal from '@lucide/svelte/icons/signal';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { backOut, cubicOut } from 'svelte/easing';
  import LaunchMode from './LaunchMode.svelte';
  import { serverApi, type FriendServer } from '../api/servers';
  import { errorText } from '../api/bridge';
  import { app } from '../stores/app.svelte';
  import { campaignOf } from '../maps';
  import { reduceMotion } from '../motion';

  let { open = $bindable(false) }: { open?: boolean } = $props();
  let presence = $state<FriendServer[] | null>(null), loading = $state(false), error = $state('');
  async function refresh() {
    if (loading) return;
    loading = true;
    // 出错时保留提示直到下一次成功，免得每 30 秒闪一次骨架
    try { presence = await serverApi.friends(); error = ''; }
    catch (e) { presence = null; error = errorText(e).replace(/ \[steam_(?:offline|friends_unavailable)\]$/, ''); }
    finally { loading = false; }
  }
  onMount(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden && !app.confirmation && !app.busy) void refresh();
    }, 30000);
    return () => { clearInterval(timer); open = false; };
  });
  let root: HTMLDivElement, trigger: HTMLButtonElement, badge = $state<HTMLElement>();
  let rows = $state<FriendServer[]>([]), saving = $state(''), expanded = $state('');
  const total = $derived(presence?.reduce((n, r) => n + r.friends.length, 0));
  const servers = $derived(presence?.filter(r => r.addr).length ?? 0);
  const subtitle = $derived(error ? 'Steam 好友暂不可用' : presence === null ? '正在读取…'
    : !total ? '暂时没人在玩' : servers ? `${total} 位好友 · ${servers} 个服务器` : `${total} 位好友在游戏中`);

  type Person = { name: string; avatar: string | null; alt: boolean };
  type Entry = { key: string; r: FriendServer; people: Person[] };
  // 同一台服务器上的好友合成一张卡；在大厅或查不到服务器的人各占一行
  const entries = $derived.by(() => {
    const cards: Entry[] = [], solo: Entry[] = [];
    for (const r of rows) {
      const people = r.friends.map((name, i) => ({ name, avatar: r.avatars?.[i] ?? null, alt: (name.codePointAt(0) ?? 0) % 2 === 0 }));
      if (r.addr) cards.push({ key: r.id, r, people });
      else people.forEach((p, i) => solo.push({ key: JSON.stringify([r.id, p.name, i]), r, people: [p] }));
    }
    return [...cards, ...solo];
  });
  const initial = (name: string) => (Array.from(name.trim())[0] || '友').toUpperCase();
  const names = (people: Person[]) => people.length > 2 ? `${people[0].name}、${people[1].name} 等 ${people.length} 人` : people.map(p => p.name).join('、');
  const place = (r: FriendServer) => r.addr ? r.name : r.name === '游戏大厅' ? '游戏大厅' : '游戏中';
  const quality = (ping: number) => ping <= 80 ? 'good' : ping <= 150 ? 'fair' : 'poor';
  const copyOnly = (r: FriendServer) => app.launchState === 'running' || (r.vac && app.launchConfig.vacMode === 'insecure') || ['timeout','error'].includes(r.status);
  const duration = (ms: number) => reduceMotion() ? 0 : ms;

  /** 弹出：从按钮下方落下来，带一点回弹；收起时干脆利落 */
  function pop(_node: Element, { out = false }: { out?: boolean } = {}) {
    if (reduceMotion()) return { duration: 0 };
    return out
      ? { duration: 130, easing: cubicOut, css: (t: number) => `opacity:${t};transform:translateY(${(t - 1) * 4}px) scale(${0.97 + 0.03 * t})` }
      : { duration: 320, easing: backOut, css: (t: number) => `opacity:${Math.min(1, t * 1.8)};transform:translateY(${(t - 1) * 8}px) scale(${0.92 + 0.08 * t})` };
  }
  // 有新好友进来时，人数徽标弹一下
  let lastTotal: number | undefined;
  $effect(() => {
    const n = total;
    if (n !== undefined && lastTotal !== undefined && n > lastTotal && badge && !reduceMotion())
      badge.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: 460, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
    lastTotal = n;
  });

  // Presence feeds the counter; only the open roster needs map and player details.
  $effect(() => {
    if (!open) { expanded = ''; return; }
    const found = presence ?? [];
    let active = true;
    rows = found;
    for (const row of found.filter(r => r.addr)) {
      void serverApi.friendInfo(row.id).catch(e => ({...row, status:'error' as const, error:errorText(e)})).then(detail => {
        if (active) rows = rows.map(r => r.id === row.id ? detail : r);
      });
    }
    return () => { active = false; };
  });
  function dismissOutside(e: Event) {
    if (open && !app.confirmation && !e.composedPath().includes(root)) open = false;
  }
  function onKey(e: KeyboardEvent) {
    if (!open || app.confirmation) return;
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault(); open = false; trigger.focus();
    }
  }
  async function favorite(r: FriendServer) {
    saving = r.id;
    try {
      await app.toggleFriendFavorite(r);
    } catch (e) { app.toast(errorText(e)); }
    finally { saving = ''; }
  }
</script>

<svelte:window onpointerdown={dismissOutside} onfocusin={dismissOutside} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Escape and page shortcuts are handled for the whole disclosure.) -->
<div class="roster" bind:this={root} role="group" aria-label="Steam 好友" onkeydown={onKey}>
  <button class="trigger" class:open bind:this={trigger}
    aria-expanded={open} aria-controls={open ? 'friends-playing' : undefined}
    aria-label={'好友在玩' + (total === undefined ? '' : ' · ' + total + ' 人')}
    title={error || '好友在玩'} data-sfx={open ? 'close' : 'open'} onclick={() => open = !open}>
    <Users size={16} strokeWidth={1.8}/>{#if total}<b class="counter mono" bind:this={badge}>{total}</b>{/if}
  </button>
  {#if open}
    <section id="friends-playing" aria-label="好友在玩" class="sheet" in:pop out:pop={{ out: true }}>
      <header class="mast">
        <span class="mark" class:live={!!total}><Users size={16} strokeWidth={2}/></span>
        <span class="title"><h3>好友在玩</h3><span class="sub">{subtitle}</span></span>
        <button class="icon-btn refresh" aria-label="刷新好友" title="刷新好友" disabled={loading} onclick={refresh}>
          <RefreshCw size={14} class={loading ? 'spin' : ''}/>
        </button>
      </header>
      {#if entries.length}
        <ul>
          {#each entries as e, index (e.key)}
            {@const r = e.r}
            {@const show = expanded === e.key}
            <li class:open={show} style:--delay={Math.min(index, 6) * 38 + 60 + 'ms'}>
              {#snippet identity()}
                <span class="faces" class:duo={e.people.length > 1}>
                  {#each e.people.slice(0, 2) as p, i (i)}
                    <span class="avatar" class:alternate={p.alt}>
                      {#if p.avatar}<img src={p.avatar} alt="" draggable="false" />{:else}{initial(p.name)}{/if}
                    </span>
                  {/each}
                </span>
                <span class="identity"><strong>{names(e.people)}</strong>
                  <span class="place" class:idle={!r.addr && r.name === '游戏大厅'} title={r.addr ? r.name : undefined}><i class="pulse"></i><span>{place(r)}</span></span>
                </span>
              {/snippet}
              {#if r.addr}
                <button class="person interactive" aria-expanded={show} aria-label={names(e.people) + ' 所在服务器详情'}
                  onclick={() => expanded = show ? '' : e.key}>
                  {@render identity()}
                  {#if r.players !== null}<span class="fill mono">{r.players}/{r.maxPlayers ?? '—'}</span>{/if}
                  <span class="more"><ChevronRight size={15}/></span>
                </button>
                {#if show}
                  {@const campaign = campaignOf(r.map)}
                  {@const starred = app.servers.some(s => s.addr === r.addr && s.favorite)}
                  {@const pending = r.status === 'unqueried' || r.status === 'querying'}
                  <div class="detail" transition:slide={{ duration: duration(240), easing: cubicOut }}>
                    <div class="inner">
                      <div class="map">
                        <span class="map-ic"><MapIcon size={15}/></span>
                        <span class="map-text">
                          <b>{campaign ? campaign.name : r.map || (pending ? '正在查询地图…' : '未知地图')}</b>
                          <small>{campaign ? `第 ${campaign.chapter} 章 · 共 ${campaign.chapters} 章` : r.map ? '三方地图' : r.addr}</small>
                        </span>
                        {#if campaign}
                          <span class="chapters" aria-hidden="true">
                            {#each Array.from({ length: campaign.chapters }) as _, i (i)}<i class:passed={i < campaign.chapter - 1} class:now={i === campaign.chapter - 1}></i>{/each}
                          </span>
                        {/if}
                      </div>
                      <div class="facts">
                        {#if r.players !== null}
                          <span class="fact"><Users size={12}/>{r.players} / {r.maxPlayers ?? '—'}
                            {#if r.maxPlayers}<span class="bar"><i style:width={Math.min(100, r.players / r.maxPlayers * 100) + '%'}></i></span>{/if}
                          </span>
                        {/if}
                        {#if r.ping !== null}<span class="fact ping {quality(r.ping)}"><Signal size={12}/>{r.ping} ms</span>{/if}
                        {#if r.vac}<span class="fact"><ShieldCheck size={12}/>VAC</span>{/if}
                        {#if pending}<span class="fact">正在查询…</span>{:else if r.error}<span class="fact warn">{r.error}</span>{/if}
                      </div>
                      <div class="launch"><LaunchMode /></div>
                      <div class="actions">
                        <button class="join" class:copy={copyOnly(r)} disabled={['wrong-game','unqueried'].includes(r.status) || !!app.busy || ['launching','requested'].includes(app.launchState)}
                          onclick={() => copyOnly(r) ? app.copyServer(r) : app.connectServer(r.id,r)}>
                          {#if copyOnly(r)}<Copy size={14}/>复制连接命令{:else}加入游戏<span class="arrow"><ArrowUpRight size={15}/></span>{/if}
                        </button>
                        <button class="star" class:starred disabled={!!saving} aria-label={starred ? '取消收藏' : '收藏服务器'} aria-pressed={starred}
                          title={starred ? '取消收藏' : '收藏服务器'} onclick={() => favorite(r)}><Star size={15} fill={starred ? 'currentColor' : 'none'}/></button>
                      </div>
                    </div>
                  </div>
                {/if}
              {:else}<div class="person">{@render identity()}</div>{/if}
            </li>
          {/each}
        </ul>
      {:else if presence === null && loading && !error}
        <ul class="ghosts" aria-hidden="true">
          {#each [0, 1, 2] as i (i)}<li style:--delay={i * 60 + 'ms'}><span class="g-face"></span><span class="g-lines"><i></i><i></i></span></li>{/each}
        </ul>
        <span class="sr" role="status">正在读取 Steam 好友…</span>
      {:else}
        <div class="empty" role="status">
          <span class="bubble" class:sad={!!error}><Users size={20}/></span>
          <b>{error ? '暂时读不到好友' : '暂无好友在玩'}</b>
          <span>{error || '好友进服后会出现在这里'}</span>
          {#if error}<button class="retry" disabled={loading} onclick={refresh}>{loading ? '正在重试…' : '重试'}</button>{/if}
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .roster {
    --leaf: #b7dc94; --leaf-ink: #1c3310; --warn: #e9c46a; --gold: #f4c95d;
    --wash: color-mix(in srgb, var(--leaf) 8%, var(--md-surface-container));
    --ring: var(--md-surface-container);
    position: relative; flex: none;
  }
  :global([data-theme="light"]) .roster { --leaf: #426735; --leaf-ink: #fff; --warn: #8a6412; --gold: #b07d00; }

  /* 顶栏按钮：人数是一枚绿色小徽标，外圈缓慢呼吸 */
  .trigger { display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 36px; height: 30px; padding: 0 8px; border-radius: 10px; color: var(--bar-ink); transition: background 140ms, color 140ms, transform 160ms var(--ease-out); }
  .trigger :global(svg) { filter: drop-shadow(0 1px 2px var(--bar-halo)); transition: transform 260ms var(--ease-out); }
  .trigger:hover { color: var(--fg); background: color-mix(in srgb, var(--md-surface) 70%, transparent); }
  .trigger.open { color: var(--md-on-secondary-container); background: var(--md-secondary-container); }
  .trigger:hover :global(svg),.trigger.open :global(svg) { filter: none; }
  .trigger:hover :global(svg) { transform: translateY(-1px); }
  .trigger:active { transform: scale(.94); }
  .counter { position: relative; isolation: isolate; display: grid; place-items: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--leaf); color: var(--leaf-ink); font: 700 10px/1 var(--font-mono); animation: badge-in 380ms cubic-bezier(0.34, 1.56, 0.64, 1); }
  .counter::after { content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit; background: var(--leaf); opacity: 0; animation: halo 3.2s ease-out 800ms infinite; }
  @keyframes badge-in { from { transform: scale(0); } }
  @keyframes halo { 0% { transform: scale(1); opacity: .55; } 55%, 100% { transform: scale(1.9, 2.1); opacity: 0; } }

  /* 面板：顶部压一层淡淡的绿光，和「在线」呼应 */
  .sheet {
    position: absolute; right: -4px; top: calc(100% + 10px); z-index: 12; width: 304px; overflow: hidden; border-radius: 16px;
    transform-origin: calc(100% - 22px) -6px;
    background: radial-gradient(130% 110px at 88% -20px, color-mix(in srgb, var(--leaf) 14%, transparent), transparent), var(--md-surface-container);
    box-shadow: 0 18px 40px -16px rgb(0 0 0 / .55), 0 2px 8px -3px rgb(0 0 0 / .25), 0 0 0 1px var(--line);
  }
  .mast { display: flex; align-items: center; gap: 10px; margin: 0 12px; padding: 12px 0 10px 2px; border-bottom: 1px solid var(--line-soft); }
  .mark { position: relative; flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 11px; color: var(--fg-3); background: color-mix(in srgb, var(--md-on-surface) 7%, transparent); transition: color 200ms, background 200ms; }
  .mark.live { color: var(--leaf); background: color-mix(in srgb, var(--leaf) 16%, transparent); }
  .mark.live::after { content: ''; position: absolute; top: -2px; right: -2px; width: 8px; height: 8px; border-radius: 50%; background: var(--leaf); box-shadow: 0 0 0 2px var(--md-surface-container); }
  .title { display: grid; flex: 1; min-width: 0; }
  h3 { margin: 0; color: var(--fg); font-size: 14px; font-weight: 600; line-height: 1.35; }
  .sub { color: var(--fg-3); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .refresh { flex: none; width: 28px; height: 28px; border-radius: 9px; color: var(--fg-3); }
  .refresh:hover:not(:disabled) { color: var(--fg); }

  ul { display: grid; gap: 2px; margin: 0; padding: 6px; list-style: none; max-height: min(60vh, 440px); overflow: auto; overscroll-behavior: contain; }
  li { border-radius: 12px; transition: background 220ms var(--ease-out); animation: arrive 360ms var(--ease-out) var(--delay) backwards; }
  li.open { --ring: var(--wash); background: var(--wash); }
  @keyframes arrive { from { opacity: 0; transform: translateY(-6px); } }

  .person { display: flex; align-items: center; gap: 11px; width: 100%; padding: 8px 10px; text-align: left; border-radius: 12px; }
  .interactive { transition: background 160ms; }
  .interactive:hover { background: var(--hover); }
  li.open .interactive:hover { background: transparent; }

  /* 头像：一人一张；同服两人叠成一大一小 */
  .faces { flex: none; position: relative; width: 40px; height: 40px; }
  .avatar { position: absolute; inset: 0; display: grid; place-items: center; overflow: hidden; border-radius: 12px; background: var(--md-secondary-container); color: var(--md-on-secondary-container); font: 600 16px var(--font-sans); transition: transform 280ms var(--ease-out); }
  .avatar.alternate { background: var(--md-tertiary-container); color: var(--md-on-tertiary-container); }
  .avatar img { width: 100%; height: 100%; object-fit: cover; }
  .duo .avatar:first-child { inset: 0 auto auto 0; width: 30px; height: 30px; border-radius: 10px; font-size: 13px; }
  .duo .avatar:last-child { inset: auto 0 0 auto; width: 25px; height: 25px; border-radius: 9px; font-size: 11px; box-shadow: 0 0 0 2px var(--ring); }
  .interactive:hover .avatar:first-child { transform: rotate(-5deg) scale(1.05); }
  .interactive:hover .duo .avatar:last-child { transform: translate(2px, 1px) rotate(6deg); }

  .identity { display: grid; flex: 1; min-width: 0; gap: 2px; }
  .identity strong { overflow: hidden; color: var(--fg); font-size: 13.5px; font-weight: 600; line-height: 1.35; white-space: nowrap; text-overflow: ellipsis; }
  .place { display: flex; align-items: center; gap: 7px; min-width: 0; color: var(--leaf); font-size: 12px; }
  .place > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .place.idle { color: var(--fg-3); }
  .pulse { position: relative; flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .pulse::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: currentColor; opacity: 0; animation: ping 2.6s ease-out var(--delay) infinite; }
  .idle .pulse::after { animation: none; }
  @keyframes ping { 0% { transform: scale(1); opacity: .6; } 70%, 100% { transform: scale(2.8); opacity: 0; } }

  .fill { flex: none; padding: 2px 7px; border-radius: 999px; color: var(--fg-3); background: color-mix(in srgb, var(--md-on-surface) 6%, transparent); font-size: 11px; }
  .more { flex: none; display: grid; place-items: center; color: var(--fg-3); transition: transform 260ms var(--ease-out), color 160ms; }
  .interactive:hover .more { color: var(--fg); transform: translateX(2px); }
  .interactive[aria-expanded="true"] .more { color: var(--leaf); transform: rotate(90deg); }

  /* 展开的服务器详情：内容逐行浮上来 */
  .detail { overflow: hidden; }
  .inner { display: grid; gap: 10px; padding: 0 10px 12px; overflow-wrap: anywhere; }
  .inner > * { animation: lift 320ms var(--ease-out) backwards; }
  .inner > :nth-child(2) { animation-delay: 45ms; }
  .inner > :nth-child(3) { animation-delay: 90ms; }
  .inner > :nth-child(4) { animation-delay: 135ms; }
  @keyframes lift { from { opacity: 0; transform: translateY(6px); } }

  .map { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 8px; border-radius: 11px; background: color-mix(in srgb, var(--md-surface-container-highest) 55%, transparent); }
  .map-ic { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; color: var(--leaf); background: color-mix(in srgb, var(--leaf) 15%, transparent); }
  .map-text { display: grid; flex: 1; min-width: 0; }
  .map-text b,.map-text small { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .map-text b { color: var(--fg); font-size: 13px; font-weight: 600; }
  .map-text small { color: var(--fg-3); font-size: 11px; }
  .chapters { flex: none; display: flex; align-items: center; gap: 3px; }
  .chapters i { width: 6px; height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--md-on-surface) 18%, transparent); }
  .chapters i.passed { background: color-mix(in srgb, var(--leaf) 55%, transparent); }
  .chapters i.now { width: 14px; background: var(--leaf); transform-origin: left; animation: stretch 520ms cubic-bezier(0.34, 1.56, 0.64, 1) 220ms backwards; }
  @keyframes stretch { from { transform: scaleX(.4); } }

  .facts { display: flex; flex-wrap: wrap; gap: 6px; }
  .fact { display: inline-flex; align-items: center; gap: 5px; min-height: 24px; padding: 3px 9px; border-radius: 999px; color: var(--fg-2); background: color-mix(in srgb, var(--md-on-surface) 6%, transparent); font-size: 11.5px; line-height: 1.3; }
  .fact :global(svg) { flex: none; color: var(--fg-3); }
  .fact.ping :global(svg) { color: inherit; }
  .ping.good { color: var(--leaf); }
  .ping.fair { color: var(--warn); }
  .ping.poor,.fact.warn { color: var(--danger); }
  .bar { width: 34px; height: 4px; overflow: hidden; border-radius: 2px; background: color-mix(in srgb, var(--md-on-surface) 14%, transparent); }
  .bar i { display: block; height: 100%; border-radius: inherit; background: var(--leaf); transform-origin: left; animation: grow 640ms var(--ease-out) 180ms backwards; }
  @keyframes grow { from { transform: scaleX(0); } }

  .launch :global(.launch-mode) { display: flex; }
  .launch :global(select) { max-width: none; }
  .actions { display: flex; gap: 8px; }
  .join { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; border-radius: 12px; color: var(--leaf-ink); background: var(--leaf); font-size: 13px; font-weight: 600; box-shadow: 0 8px 18px -10px var(--leaf); transition: transform 180ms var(--ease-out), box-shadow 180ms, filter 160ms; }
  .join:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); box-shadow: 0 12px 22px -10px var(--leaf); }
  .join:active:not(:disabled) { transform: scale(.97); }
  .join.copy { color: var(--leaf); background: color-mix(in srgb, var(--leaf) 15%, transparent); box-shadow: none; }
  .arrow { display: grid; place-items: center; transition: transform 240ms var(--ease-out); }
  .join:hover:not(:disabled) .arrow { transform: translate(2px, -2px); }
  .star { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; color: var(--fg-3); background: color-mix(in srgb, var(--md-on-surface) 6%, transparent); transition: color 160ms, background 160ms, transform 160ms var(--ease-out); }
  .star:hover:not(:disabled) { color: var(--fg); background: color-mix(in srgb, var(--md-on-surface) 10%, transparent); }
  .star:active:not(:disabled) { transform: scale(.92); }
  .star.starred { color: var(--gold); background: color-mix(in srgb, var(--gold) 14%, transparent); }
  .star.starred :global(svg) { animation: twinkle 460ms cubic-bezier(0.34, 1.56, 0.64, 1); }
  @keyframes twinkle { from { transform: scale(.5) rotate(-40deg); } }

  /* 首次读取：骨架扫光 */
  .ghosts li { display: flex; align-items: center; gap: 11px; padding: 8px 10px; }
  .g-face,.g-lines i { position: relative; overflow: hidden; background: color-mix(in srgb, var(--md-on-surface) 8%, transparent); }
  .g-face { flex: none; width: 40px; height: 40px; border-radius: 12px; }
  .g-lines { display: grid; flex: 1; gap: 7px; }
  .g-lines i { height: 10px; border-radius: 5px; }
  .g-lines i:first-child { width: 46%; }
  .g-lines i:last-child { width: 72%; }
  .g-face::after,.g-lines i::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--md-on-surface) 9%, transparent), transparent); animation: shimmer 1.3s ease-in-out var(--delay) infinite; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  .empty { display: grid; justify-items: center; gap: 4px; padding: 22px 20px 20px; color: var(--fg-3); font-size: 12px; text-align: center; }
  .empty b { color: var(--fg-2); font-size: 13px; font-weight: 600; }
  .bubble { display: grid; place-items: center; width: 46px; height: 46px; margin-bottom: 6px; border-radius: 16px; color: var(--leaf); background: color-mix(in srgb, var(--leaf) 13%, transparent); animation: bob 3.2s ease-in-out infinite; }
  .bubble.sad { color: var(--fg-3); background: color-mix(in srgb, var(--md-on-surface) 7%, transparent); animation: none; }
  @keyframes bob { 50% { transform: translateY(-4px) rotate(-3deg); } }
  .retry { margin-top: 8px; height: 30px; padding: 0 16px; border-radius: 10px; color: var(--fg); background: color-mix(in srgb, var(--md-on-surface) 8%, transparent); font-size: 12px; transition: background 160ms; }
  .retry:hover:not(:disabled) { background: color-mix(in srgb, var(--md-on-surface) 12%, transparent); }

  button:disabled { opacity: .5; cursor: default; }
  button:focus-visible { outline: 2px solid var(--md-primary); outline-offset: -2px; }
  @media (prefers-reduced-motion: reduce) {
    li,.counter,.counter::after,.pulse::after,.inner > *,.chapters i.now,.bar i,.bubble,.star.starred :global(svg),.g-face::after,.g-lines i::after { animation: none; }
    .trigger,.trigger :global(svg),.more,.interactive,.avatar,.join,.arrow,.star { transition: none; }
    .refresh :global(.spin) { animation: none; }
  }
</style>
