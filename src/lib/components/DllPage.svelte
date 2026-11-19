<script lang="ts">
  // 开发者在 presentation.page 里编排的内容块。数据已由 plugins/page.ts 清洗。
  import Info from '@lucide/svelte/icons/info';
  import Lightbulb from '@lucide/svelte/icons/lightbulb';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Play from '@lucide/svelte/icons/play';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import X from '@lucide/svelte/icons/x';
  import type { Aspect, Media, PageBlock } from '../plugins/page';
  import type { PlatformPlugin } from '../types';
  import { browser } from '../browser/browser.svelte';
  import { app } from '../stores/app.svelte';
  import DllAsset from './DllAsset.svelte';
  import Keys from './Keys.svelte';
  import RichText from './RichText.svelte';
  let { plugin, blocks }: { plugin: PlatformPlugin; blocks: PageBlock[] } = $props();

  const ratio = (a: Aspect) => a === 'auto' ? undefined : a.replace(':', ' / ');
  const host = (url: string) => { const h = new URL(url).hostname.replace(/^www\./, ''); return /bilibili\.com|b23\.tv/.test(h) ? 'B站' : /youtube\.com|youtu\.be/.test(h) ? 'YouTube' : h; };
  function open(url: string) { browser.open(url); app.route = 'browser'; }

  // 灯箱：图集与单图共用
  let viewer = $state<HTMLDialogElement>();
  let shown = $state<{ items: Media[]; index: number } | null>(null);
  function view(items: Media[], index: number) { shown = { items, index }; viewer?.showModal(); }
  function step(d: number) { if (shown) shown.index = (shown.index + d + shown.items.length) % shown.items.length; }

  let expanded = $state<Record<number, boolean>>({});
  let split = $state<Record<number, number>>({});
</script>

{#snippet heading(title: string | undefined)}{#if title}<h3 class="title">{title}</h3>{/if}{/snippet}

<div class="page">
  {#each blocks as b, i (i)}
    <section class="block" data-block={b.type}>
      {#if b.type === 'heading'}
        {#if b.eyebrow}<div class="eyebrow">{b.eyebrow}</div>{/if}<h3 class="big">{b.text}</h3>
      {:else if b.type === 'text'}
        <RichText text={b.text}/>
      {:else if b.type === 'image'}
        <figure class:wide={b.wide}>
          <button class="frame" class:auto={b.aspect === 'auto'} style:aspect-ratio={ratio(b.aspect)} aria-label={'放大 ' + (b.caption ?? '图片')} onclick={() => view([b], 0)}><DllAsset {plugin} path={b.src} alt={b.caption ?? ''}/></button>
          {#if b.caption}<figcaption>{b.caption}</figcaption>{/if}
        </figure>
      {:else if b.type === 'gallery'}
        {@render heading(b.title)}
        <div class="gallery" style:--columns={b.columns}>
          {#each b.items as m, j (j)}
            <figure>
              <button class="frame" style:aspect-ratio={ratio(b.aspect) ?? '16 / 9'} aria-label={'放大 ' + (m.caption ?? `第 ${j + 1} 张`)} onclick={() => view(b.items, j)}><DllAsset {plugin} path={m.src} alt={m.caption ?? ''}/></button>
              {#if m.caption}<figcaption>{m.caption}</figcaption>{/if}
            </figure>
          {/each}
        </div>
      {:else if b.type === 'compare'}
        {@const at = split[i] ?? 50}
        <figure>
          <div class="compare" style:aspect-ratio={ratio(b.aspect) ?? '16 / 9'} style:--at={at + '%'}>
            <div class="layer"><DllAsset {plugin} path={b.before.src} alt={b.before.label}/></div>
            <div class="layer after"><DllAsset {plugin} path={b.after.src} alt={b.after.label}/></div>
            <span class="tag left">{b.before.label}</span><span class="tag right">{b.after.label}</span>
            <span class="handle" aria-hidden="true"></span>
            <input type="range" min="0" max="100" value={at} aria-label={`拖动对比 ${b.before.label} 与 ${b.after.label}`} oninput={e => split[i] = +e.currentTarget.value}/>
          </div>
          {#if b.caption}<figcaption>{b.caption}</figcaption>{/if}
        </figure>
      {:else if b.type === 'hotkeys'}
        {@render heading(b.title ?? '快捷键')}
        <dl class="keys">{#each b.items as k, j (j)}<div><dt><Keys keys={k.keys}/></dt><dd>{k.label}</dd></div>{/each}</dl>
      {:else if b.type === 'steps'}
        {@render heading(b.title)}
        <ol class="steps">
          {#each b.items as s, j (j)}
            <li><span class="n">{String(j + 1).padStart(2, '0')}</span><div><h4>{s.title}</h4>{#if s.text}<RichText text={s.text}/>{/if}
              {#if s.image}<button class="frame shot" aria-label={'放大 ' + s.title} onclick={() => view([{ src: s.image!, caption: s.title }], 0)}><DllAsset {plugin} path={s.image} alt={s.title}/></button>{/if}</div></li>
          {/each}
        </ol>
      {:else if b.type === 'callout'}
        <aside class="callout {b.tone}">
          <span class="icon">{#if b.tone === 'warning'}<TriangleAlert size={16}/>{:else if b.tone === 'tip'}<Lightbulb size={16}/>{:else}<Info size={16}/>{/if}</span>
          <div>{#if b.title}<h4>{b.title}</h4>{/if}<RichText text={b.text}/></div>
        </aside>
      {:else if b.type === 'specs'}
        {@render heading(b.title)}
        <dl class="specs">{#each b.rows as r, j (j)}<div><dt>{r.label}</dt><dd>{r.value}</dd></div>{/each}</dl>
      {:else if b.type === 'changelog'}
        {@render heading(b.title ?? '更新记录')}
        {@const all = expanded[i] ? b.items : b.items.slice(0, 3)}
        <ol class="changelog">
          {#each all as v, j (j)}<li><div class="ver"><strong>v{v.version.replace(/^v/i, '')}</strong>{#if v.date}<span>{v.date}</span>{/if}</div><ul>{#each v.notes as n, k (k)}<li>{n}</li>{/each}</ul></li>{/each}
        </ol>
        {#if b.items.length > 3 && !expanded[i]}<button class="more" onclick={() => expanded[i] = true}>展开全部 {b.items.length} 个版本</button>{/if}
      {:else if b.type === 'links'}
        {@render heading(b.title ?? '相关链接')}
        <ul class="links">{#each b.items as l, j (j)}<li><button onclick={() => open(l.url)} title={l.url}><span class="label">{l.label}</span>{#if l.note}<span class="note">{l.note}</span>{/if}<span class="host">{host(l.url)}</span><ExternalLink size={13}/></button></li>{/each}</ul>
      {:else if b.type === 'credits'}
        {@render heading(b.title ?? '致谢')}
        <ul class="credits">{#each b.items as c, j (j)}<li><span>{c.name}</span>{#if c.role}<small>{c.role}</small>{/if}</li>{/each}</ul>
      {:else if b.type === 'video'}
        <button class="video" onclick={() => open(b.url)} title={b.url}>
          <span class="poster">{#if b.poster}<DllAsset {plugin} path={b.poster} alt={b.title ?? ''}/>{/if}<span class="play"><Play size={20} fill="currentColor"/></span></span>
          <span class="meta"><span class="eyebrow">视频 · {host(b.url)}</span><strong>{b.title ?? '观看演示'}</strong>{#if b.note}<span class="note">{b.note}</span>{/if}</span>
        </button>
      {:else if b.type === 'divider'}
        <hr/>
      {/if}
    </section>
  {/each}
</div>

<dialog class="viewer" bind:this={viewer} onclose={() => shown = null} onkeydown={e => { if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); }} onclick={e => { if (e.target === viewer) viewer?.close(); }}>
  {#if shown}
    {@const m = shown.items[shown.index]}
    <div class="stage">{#key m.src}<DllAsset {plugin} path={m.src} alt={m.caption ?? ''} fit="contain"/>{/key}</div>
    <footer>
      <span class="caption">{m.caption ?? ''}</span>
      {#if shown.items.length > 1}<span class="count mono">{shown.index + 1} / {shown.items.length}</span>
        <button class="icon-btn" aria-label="上一张" onclick={() => step(-1)}><ChevronLeft size={18}/></button>
        <button class="icon-btn" aria-label="下一张" onclick={() => step(1)}><ChevronRight size={18}/></button>{/if}
      <button class="icon-btn" aria-label="关闭" onclick={() => viewer?.close()}><X size={18}/></button>
    </footer>
  {/if}
</dialog>

<style>
  .page { display: flex; flex-direction: column; }
  .block + .block { margin-top: 40px; }
  .block[data-block="heading"] + .block { margin-top: 16px; }
  .title { margin: 0 0 16px; font-size: 15px; font-weight: 550; color: var(--fg); }
  .eyebrow { font: 11px var(--font-mono); letter-spacing: .1em; color: var(--dev-accent, var(--fg-3)); text-transform: uppercase; }
  .big { margin: 8px 0 0; font-size: 22px; font-weight: 600; line-height: 1.35; color: var(--fg); text-wrap: balance; }
  .block[data-block="heading"] { margin-top: 56px; }
  .block[data-block="heading"]:first-child { margin-top: 0; }

  figure { margin: 0; }
  figcaption { margin-top: 10px; font-size: 12px; color: var(--fg-3); line-height: 1.6; }
  .frame { position: relative; display: block; width: 100%; padding: 0; overflow: hidden; background: var(--bg-1); border: 1px solid var(--line); border-radius: var(--r); cursor: zoom-in; }
  .frame :global(img) { transition: transform 300ms var(--ease-out); }
  .frame:hover :global(img) { transform: scale(1.015); }
  .frame.auto :global(img) { height: auto; }
  .gallery { display: grid; grid-template-columns: repeat(var(--columns), minmax(0, 1fr)); gap: 12px; }

  .compare { position: relative; overflow: hidden; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg-1); user-select: none; }
  .layer { position: absolute; inset: 0; }
  .layer.after { clip-path: inset(0 0 0 var(--at)); }
  .handle { position: absolute; top: 0; bottom: 0; left: var(--at); width: 2px; margin-left: -1px; background: var(--fg); pointer-events: none; }
  .handle::after { content: ''; position: absolute; top: 50%; left: 50%; width: 28px; height: 28px; margin: -14px 0 0 -14px; border-radius: 50%; background: var(--fg); box-shadow: 0 0 0 4px #0008; }
  .compare input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: ew-resize; }
  .compare:has(input:focus-visible) .handle { background: var(--dev-accent, var(--fg)); }
  .tag { position: absolute; top: 12px; padding: 2px 8px; background: #000c; color: var(--fg); font-size: 12px; border-radius: var(--r-sm); pointer-events: none; }
  .tag.left { left: 12px; } .tag.right { right: 12px; }

  .keys { margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); column-gap: 32px; }
  .keys div { display: flex; align-items: center; gap: 16px; padding: 11px 0; border-top: 1px solid var(--line-soft); }
  .keys dt { flex: none; min-width: 112px; }
  .keys dd { margin: 0; color: var(--fg-2); font-size: 13px; }

  .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .steps > li { display: grid; grid-template-columns: 56px 1fr; gap: 8px; padding: 20px 0; border-top: 1px solid var(--line-soft); }
  .steps > li:first-child { border-top: 0; padding-top: 0; }
  .n { font: 500 26px/1 var(--font-display); color: var(--dev-accent, var(--fg-3)); }
  .steps h4 { margin: 2px 0 8px; font-size: 15px; font-weight: 550; color: var(--fg); }
  .shot { margin-top: 14px; max-width: 560px; aspect-ratio: 16 / 9; }

  .callout { display: grid; grid-template-columns: 20px 1fr; gap: 12px; padding: 16px 18px; background: var(--bg-1); border: 1px solid var(--line); border-left: 2px solid var(--fg-3); border-radius: var(--r); }
  .callout.tip { border-left-color: var(--dev-accent, var(--fg)); }
  .callout.warning { border-left-color: var(--danger); }
  .callout .icon { color: var(--fg-3); padding-top: 4px; }
  .callout.tip .icon { color: var(--dev-accent, var(--fg)); }
  .callout.warning .icon { color: var(--danger); }
  .callout h4 { margin: 0 0 4px; font-size: 14px; font-weight: 550; color: var(--fg); }

  .specs { margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); column-gap: 32px; }
  .specs div { display: flex; justify-content: space-between; gap: 16px; padding: 11px 0; border-top: 1px solid var(--line-soft); font-size: 13px; }
  .specs dt { flex: none; color: var(--fg-3); }
  .specs dd { margin: 0; color: var(--fg); text-align: right; overflow-wrap: anywhere; }

  .changelog { list-style: none; margin: 0; padding: 0; }
  .changelog > li { display: grid; grid-template-columns: 140px 1fr; gap: 16px; padding: 14px 0; border-top: 1px solid var(--line-soft); }
  .ver { display: flex; flex-direction: column; gap: 4px; }
  .ver strong { font: 500 13px var(--font-mono); color: var(--fg); }
  .ver span { font-size: 12px; color: var(--fg-3); }
  .changelog ul { margin: 0; padding-left: 18px; color: var(--fg-2); font-size: 13px; line-height: 1.8; }
  .changelog ul li::marker { color: var(--fg-4); }
  .more { margin-top: 12px; font-size: 12px; color: var(--fg-2); }
  .more:hover { color: var(--fg); }

  .links { list-style: none; margin: 0; padding: 0; }
  .links button { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 0; border-top: 1px solid var(--line-soft); text-align: left; color: var(--fg-3); }
  .links li:first-child button { border-top: 0; }
  .links .label { color: var(--fg); font-size: 14px; }
  .links .note { flex: 1; min-width: 0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .links .host { margin-left: auto; font-size: 12px; }
  .links button:hover .label { color: var(--dev-accent, var(--fg)); text-decoration: underline; text-underline-offset: 3px; }

  .credits { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 10px 28px; }
  .credits li { display: flex; flex-direction: column; gap: 2px; font-size: 14px; color: var(--fg); }
  .credits small { font-size: 12px; color: var(--fg-3); }

  .video { display: grid; grid-template-columns: minmax(160px, 280px) 1fr; gap: 20px; align-items: center; width: 100%; padding: 0; text-align: left; }
  .poster { position: relative; aspect-ratio: 16 / 9; overflow: hidden; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg-1); }
  .play { position: absolute; inset: 0; display: grid; place-items: center; color: var(--fg); }
  .play :global(svg) { padding: 12px; box-sizing: content-box; border-radius: 50%; background: #000a; transition: transform 200ms var(--ease-out); }
  .video:hover .play :global(svg) { transform: scale(1.08); }
  .video .meta { display: flex; flex-direction: column; gap: 6px; }
  .video strong { font-size: 16px; font-weight: 550; color: var(--fg); }
  .video .note { font-size: 13px; color: var(--fg-3); }

  hr { margin: 0; border: 0; border-top: 1px solid var(--line); }

  .viewer { width: min(1400px, 94vw); max-width: none; height: min(900px, 90vh); max-height: none; padding: 0; border: 1px solid var(--line-strong); border-radius: 8px; background: #000; color: var(--fg); }
  .viewer[open] { display: flex; flex-direction: column; }
  .viewer::backdrop { background: #000e; }
  .stage { flex: 1; min-height: 0; }
  .viewer footer { display: flex; align-items: center; gap: 8px; padding: 10px 12px 10px 18px; border-top: 1px solid var(--line); }
  .caption { flex: 1; min-width: 0; font-size: 13px; color: var(--fg-2); }
  .count { font-size: 12px; color: var(--fg-3); margin-right: 6px; }
  .mono { font-family: var(--font-mono); }

  @container dll (max-width: 700px) {
    .gallery { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .changelog > li { grid-template-columns: 1fr; gap: 6px; }
    .video { grid-template-columns: 1fr; }
    .steps > li { grid-template-columns: 40px 1fr; }
  }
  @media (prefers-reduced-motion: reduce) { .frame :global(img), .play :global(svg) { transition: none; } }
</style>
