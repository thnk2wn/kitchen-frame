<script>
  import Txt from './Txt.svelte';
  import Icon from './Icon.svelte';
  import { messages, dismissMessage } from '../lib/state.svelte.js';
  import { time, formatDate } from '../lib/format.js';

  // An agent's message, covering everything until its X is pressed. Oldest first.
  let m = $derived(messages.items[0]);
  let count = $derived(messages.items.length);
  const when = (iso) => {
    const d = new Date(iso);
    return d.toDateString() === new Date().toDateString() ? time(d) : formatDate(d, { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + time(d);
  };
</script>

<div class="cover" role="alertdialog" aria-label={m.title || 'Message'}>
  <section class="card sheet">
    <header>
      <span class="meta"><Icon name="message" size={22} />{m.from || 'Message'} · {when(m.at)}{#if count > 1} · 1 of {count}{/if}</span>
      <button class="x" onclick={() => dismissMessage(m)} aria-label="Dismiss message"><Icon name="close" size={34} /></button>
    </header>
    {#if m.title}<h1><Txt text={m.title} /></h1>{/if}
    {#if m.body}<p class="body"><Txt text={m.body} /></p>{/if}
  </section>
</div>

<style>
  .cover { position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 40; background: rgba(0, 0, 0, .7); display: grid; place-items: center; padding: 48px; }
  .card { width: 100%; max-width: 980px; max-height: 100%; display: flex; flex-direction: column; padding: 28px 36px 36px; border-radius: 32px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
  .meta { display: flex; align-items: center; gap: 10px; font-size: 19px; font-weight: 600; color: var(--secondary); min-width: 0; }
  .x { flex: none; width: 72px; height: 72px; margin: -8px -14px 0 0; border-radius: 50%; display: grid; place-items: center; background: var(--track); color: var(--label); }
  .x:active { opacity: .6; }
  h1 { margin: 10px 0 0; font-size: 46px; font-weight: 700; letter-spacing: -.02em; line-height: 1.1; overflow-wrap: anywhere; }
  .body { margin: 18px 0 0; font-size: 28px; line-height: 1.35; white-space: pre-wrap; overflow-wrap: anywhere; overflow-y: auto; }
</style>
