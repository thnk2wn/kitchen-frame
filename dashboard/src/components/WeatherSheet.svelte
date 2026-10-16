<script>
  // A day's weather in detail, opened by tapping the weather on Home or in the header: the National
  // Weather Service's written forecast for the day and night (US only), active alerts, the day's
  // hours, and rain, wind, UV and sun times. Tap another day along the top to switch.
  import Icon from './Icon.svelte';
  import Radar from './Radar.svelte';
  import { ui, clock, weather } from '../lib/state.svelte.js';
  import { weatherInfo, dayInfo, dow, time, dayKey } from '../lib/format.js';

  let wx = $derived(weather.data);
  let i = $derived(ui.weatherDay);
  let d = $derived(wx && i != null ? wx.days[i] : null);
  let info = $derived(d ? dayInfo(d) : null);
  let metric = $derived(wx && wx.unit === 'C');
  let openAlert = $state(-1);
  // Radar: shown in place of the day's details, from the button beside the days.
  let radar = $state(new URLSearchParams(location.search).has('radar')); // ?weather=0&radar for screenshots

  // Today: from the current hour, running on into tomorrow in the evening; other days: from 6 AM.
  // At most 12 columns, every other hour when the day has more than that.
  let hours = $derived.by(() => {
    if (!d || !d.hours) return [];
    const isToday = d.date === dayKey(clock.now);
    const from = isToday ? clock.now.getHours() : 6;
    let rest = d.hours.filter((h) => h.hour >= from);
    if (isToday && rest.length < 12 && wx.days[i + 1]) rest = rest.concat(wx.days[i + 1].hours || []);
    const step = rest.length > 12 && !isToday ? 2 : 1;
    return rest.filter((_, n) => n % step === 0).slice(0, 12).map((h, n) => ({ ...h, now: isToday && n === 0 }));
  });
  const hourLabel = (h) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
  const dayLabel = (date, n) => (n === 0 && date === dayKey(clock.now) ? 'Today' : dow(date));
  const uvLabel = (u) => (u <= 2 ? 'Low' : u <= 5 ? 'Moderate' : u <= 7 ? 'High' : u <= 10 ? 'Very high' : 'Extreme');
  const amount = (p) => (p == null ? '—' : p <= 0 ? 'None' : metric ? p.toFixed(1) + ' mm' : p < 0.01 ? 'Trace' : p.toFixed(2) + ' in');
  const until = (t) => (t ? 'until ' + (dayKey(new Date(t)) === dayKey(clock.now) ? '' : dow(dayKey(new Date(t))) + ' ') + time(new Date(t)) : '');
  const close = () => { ui.weatherDay = null; openAlert = -1; radar = false; };
</script>

{#if d}
  <div class="scrim" role="presentation" onclick={close}>
    <div class="panel sheet" role="dialog" aria-label="Weather for {dayLabel(d.date, i)}" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && close()}>
      <header>
        <nav class="days">
          <!-- Radar first: it's about right now and the next two hours. -->
          <button class="rbtn" class:on={radar} onclick={() => (radar = true)}>
            <span class="dn">Radar</span>
            <span class="ic rain"><Icon name="rain" size={22} /></span>
            <span class="num">Now + 2 h</span>
          </button>
          {#each wx.days as day, n (day.date)}
            {@const di = dayInfo(day)}
            <button class:on={n === i && !radar} onclick={() => { ui.weatherDay = n; openAlert = -1; radar = false; }}>
              <span class="dn">{dayLabel(day.date, n)}</span>
              <span class="ic {di.tint}"><Icon name={di.icon} size={22} /></span>
              <span class="num"><b>{day.hi}°</b> {day.lo}°</span>
            </button>
          {/each}
        </nav>
        <button class="x" onclick={close} aria-label="Close"><Icon name="close" size={26} /></button>
      </header>

      {#if radar}
        <Radar width={1072} height={470} />
      {:else}
      {#if i === 0 && wx.alerts && wx.alerts.length}
        <div class="alerts">
          {#each wx.alerts as a, n (n)}
            <button class="alert" class:severe={a.severity === 'Severe' || a.severity === 'Extreme'} onclick={() => (openAlert = openAlert === n ? -1 : n)}>
              <span class="aic"><Icon name="alert" size={22} /></span>
              <span class="atitle">{a.event} <span class="aend">{until(a.ends)}</span></span>
              <span class="amore">{openAlert === n ? 'Less' : 'More'}</span>
            </button>
            {#if openAlert === n}<p class="atext">{a.text}</p>{/if}
          {/each}
        </div>
      {/if}

      <div class="body">
        <section class="summary">
          <div class="big">
            <span class="ic {info.tint}"><Icon name={info.icon} size={52} /></span>
            <div>
              <div class="cond">{info.label}</div>
              <div class="hl num">H:{d.hi}° L:{d.lo}°{#if d.rain >= 10} · <span class="pop">{d.rain}% rain</span>{/if}</div>
            </div>
          </div>
          {#if d.text && d.text.length}
            {#each d.text as p (p.name)}
              <p class="fc"><b class:night={p.night}>{p.name}</b>{p.text}</p>
            {/each}
          {:else}
            <p class="fc none">No written forecast for this day.</p>
          {/if}
        </section>

        <section class="facts">
          <div class="fact"><span class="ic rain"><Icon name="umbrella" size={22} /></span><span class="k">Chance of rain</span><span class="v num">{d.rain}%</span></div>
          <div class="fact"><span class="ic rain"><Icon name="droplets" size={22} /></span><span class="k">Rain amount</span><span class="v num">{amount(d.precip)}</span></div>
          {#if d.wind != null}
            <div class="fact"><span class="ic"><Icon name="wind" size={22} /></span><span class="k">Wind</span><span class="v num">{d.windDir || ''} {d.wind} {metric ? 'km/h' : 'mph'}{#if d.gusts > d.wind + 5}<small> · gusts {d.gusts}</small>{/if}</span></div>
          {/if}
          <!-- Today: the UV right now (as on Home's badge) and the day's peak; other days: the peak. -->
          {#if i === 0 && d.date === dayKey(clock.now) && wx.uvNow != null}
            <div class="fact"><span class="ic sun"><Icon name="sun" size={22} /></span><span class="k">UV now</span><span class="v num">{wx.uvNow} <small>{uvLabel(wx.uvNow)}</small></span></div>
          {/if}
          {#if d.uv != null}
            <div class="fact"><span class="ic sun"><Icon name="sun" size={22} /></span><span class="k">Peak UV</span><span class="v num">{d.uv} <small>{uvLabel(d.uv)}</small></span></div>
          {/if}
          <div class="fact"><span class="ic sun"><Icon name="sunrise" size={22} /></span><span class="k">Sunrise</span><span class="v num">{time(new Date(d.sunrise))}</span></div>
          <div class="fact"><span class="ic"><Icon name="sunset" size={22} /></span><span class="k">Sunset</span><span class="v num">{time(new Date(d.sunset))}</span></div>
        </section>
      </div>

      {#if hours.length}
        <div class="hours" style="grid-template-columns: repeat({hours.length}, 1fr)">
          {#each hours as h, n (n)}
            {@const hi = weatherInfo(h.code, h.day)}
            <div class="hour">
              <span class="hn">{h.now ? 'Now' : hourLabel(h.hour)}</span>
              <span class="ic {hi.tint}"><Icon name={hi.icon} size={24} /></span>
              <span class="pop num">{h.rain >= 20 ? h.rain + '%' : ''}</span>
              <span class="num ht">{h.temp}°</span>
            </div>
          {/each}
        </div>
      {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; background: rgba(0, 0, 0, .45); }
  .panel { width: 1120px; max-width: calc(100vw - 40px); max-height: calc(100vh - 40px); display: flex; flex-direction: column; gap: 16px; padding: 18px 24px 20px; border-radius: 26px; overflow: hidden; }

  header { display: flex; align-items: flex-start; gap: 12px; }
  .days { flex: 1; display: flex; gap: 6px; }
  .days button { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 0; border-radius: 14px; font-size: 16px; color: var(--secondary); }
  /* The day (or Radar) on show: a filled, blue-outlined tile with its name in blue. --track alone
     matched the sheet in dark mode, so the choice didn't show at night. */
  .days button.on { background: var(--fill); box-shadow: inset 0 0 0 2px var(--blue); }
  .days button.on .dn { color: var(--blue-text); }
  .days .rbtn { flex: 0 0 120px; }
  .days button:active { opacity: .6; }
  .days b { color: var(--label); font-weight: 600; }
  .dn { font-weight: 700; color: var(--label); }
  .x { flex: none; width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: var(--fill); color: var(--label); }

  .alerts { display: flex; flex-direction: column; gap: 6px; }
  .alert { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 14px; border-radius: 14px; background: var(--orange); color: #fff; text-align: left; font-size: 18px; font-weight: 700; }
  .alert.severe { background: var(--red); }
  .atitle { flex: 1; min-width: 0; }
  .aend, .amore { font-weight: 500; opacity: .9; }
  .atext { margin: 0; max-height: 150px; overflow-y: auto; white-space: pre-line; font-size: 16px; line-height: 1.4; color: var(--secondary); }

  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: 1.45fr 1fr; gap: 28px; }
  .summary { min-height: 0; overflow-y: auto; }
  .big { display: flex; align-items: center; gap: 16px; margin-bottom: 8px; }
  .cond { font-size: 28px; line-height: 1.15; font-weight: 700; letter-spacing: -.01em; }
  .hl { font-size: 19px; font-weight: 500; color: var(--secondary); }
  .fc { margin: 10px 0 0; font-size: 19px; line-height: 1.45; }
  .fc b { display: block; font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--orange-text); }
  .fc b.night { color: var(--blue-text); }
  .fc.none { color: var(--secondary); }

  .facts { display: flex; flex-direction: column; }
  .fact { display: flex; align-items: center; gap: 12px; min-height: 46px; border-bottom: 1px solid var(--sep); font-size: 18px; }
  .fact:last-child { border-bottom: 0; }
  .k { flex: 1; color: var(--secondary); }
  .v { font-weight: 600; }
  small { font-size: 15px; font-weight: 500; color: var(--secondary); }

  .hours { display: grid; padding-top: 14px; border-top: 1px solid var(--sep); }
  .hour { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 16px; color: var(--secondary); }
  .hn { font-weight: 600; }
  .ht { font-size: 18px; font-weight: 600; color: var(--label); }
  .pop { height: 15px; font-size: 14px; font-weight: 700; color: var(--blue-text); line-height: 15px; }
  .ic { color: var(--secondary); }
  .ic.sun { color: var(--yellow); }
  .ic.rain { color: var(--blue); }
</style>
