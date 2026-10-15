<script>
  import Icon from './Icon.svelte';
  import { pin, closePad, tryPin, waitLeft, PIN_LENGTH } from '../lib/pin.svelte.js';
  // The keypad for the unlock PIN (lib/pin.svelte.js): four digits, checked as soon as the fourth is
  // in. Above everything but the doorbell. Closes itself after 30 seconds untouched.
  let digits = $state('');
  let msg = $state('');
  let busy = $state(false);
  let shake = $state(false);
  let wait = $state(0);
  let idle;

  const touch = () => { clearTimeout(idle); idle = setTimeout(() => closePad(null), 30000); };
  $effect(() => {
    if (!pin.ask) return;
    digits = ''; msg = pin.ask.mode === 'check' ? '' : pin.ask.note || ''; wait = pin.ask.mode === 'check' ? waitLeft() : 0;
    touch();
    return () => clearTimeout(idle);
  });
  // Counts the wait down once a second, only while one is shown.
  $effect(() => {
    if (!wait) return;
    const t = setInterval(() => (wait = pin.ask?.mode === 'check' ? waitLeft() : 0), 1000);
    return () => clearInterval(t);
  });
  const waitText = (ms) => { const s = Math.ceil(ms / 1000); return s >= 60 ? Math.ceil(s / 60) + ' min' : s + ' s'; };

  async function press(d) {
    if (busy || wait || digits.length >= PIN_LENGTH) return;
    touch();
    digits += d;
    if (digits.length < PIN_LENGTH) return;
    if (pin.ask.mode === 'enter') { const v = digits; return closePad(v); }
    busy = true;
    const r = await tryPin(digits);
    busy = false;
    if (r.ok) return closePad(true);
    digits = '';
    shake = true; setTimeout(() => (shake = false), 400);
    if (r.wait) { wait = r.wait; msg = ''; }
    else msg = 'Wrong PIN' + (r.left <= 2 ? ' · ' + r.left + (r.left === 1 ? ' try' : ' tries') + ' left' : '');
  }
  const back = () => { touch(); digits = digits.slice(0, -1); };
</script>

{#if pin.ask}
  <div class="scrim" onclick={() => closePad(null)} role="presentation">
    <section class="pad sheet" role="dialog" aria-label={pin.ask.title} onclick={(e) => e.stopPropagation()}>
      <h2>{pin.ask.title}</h2>
      {#if pin.ask.mode === 'check' && pin.ask.note}<p class="what">{pin.ask.note}</p>{/if}
      <div class="dots" class:shake aria-label={digits.length + ' of ' + PIN_LENGTH + ' digits'}>
        {#each Array(PIN_LENGTH) as _, i (i)}<span class:on={i < digits.length}></span>{/each}
      </div>
      <p class="msg" class:bad={msg && pin.ask.mode === 'check'}>{wait ? 'Too many tries · wait ' + waitText(wait) : busy ? 'Checking…' : msg || ' '}</p>
      <div class="keys">
        {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as d (d)}
          <button class="key" disabled={!!wait} onclick={() => press(d)}>{d}</button>
        {/each}
        <button class="key text" onclick={() => closePad(null)}>Cancel</button>
        <button class="key" disabled={!!wait} onclick={() => press('0')}>0</button>
        <button class="key text" disabled={!digits} onclick={back} aria-label="Delete"><Icon name="backspace" size={28} /></button>
      </div>
    </section>
  </div>
{/if}

<style>
  .scrim { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 55; display: grid; place-items: center; background: rgba(0, 0, 0, .45); }
  .pad { width: 380px; padding: 26px 28px 22px; text-align: center; }
  h2 { margin: 0; font-size: 24px; font-weight: 700; }
  .what { margin: 4px 0 0; font-size: 18px; color: var(--secondary); }
  .dots { display: flex; justify-content: center; gap: 18px; margin: 22px 0 8px; }
  .dots span { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--label); }
  .dots span.on { background: var(--label); }
  .shake { animation: shake .4s; }
  @keyframes shake { 20%, 60% { transform: translateX(-10px); } 40%, 80% { transform: translateX(10px); } }
  .msg { min-height: 22px; margin: 0 0 12px; font-size: 16px; color: var(--secondary); }
  .msg.bad { color: var(--red-text); }
  .keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .key { height: 66px; border-radius: 33px; background: var(--fill); color: var(--label); font-size: 28px; font-weight: 500; display: flex; align-items: center; justify-content: center; }
  .key.text { background: none; font-size: 18px; font-weight: 600; color: var(--blue-text); }
  .key:active:not(:disabled) { opacity: .5; }
  .key:disabled { opacity: .35; }
</style>
