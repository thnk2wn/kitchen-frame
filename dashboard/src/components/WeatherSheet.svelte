<script>
  // A day's weather in detail, opened by tapping the weather on Home or in the header: the National
  // Weather Service's written forecast for the day and night (US only), the day's hours, and rain,
  // wind, UV and sun times. Tap another day along the top to switch. Beside Radar, while any are in
  // effect, the Weather Service's alerts: a list, worst first, with each one's text tidied into
  // sections and a short summary from Workers AI (lib/wxalerts.js, worker/wx-alert-ai.js). The furthest
  // day makes room for that button.
  import Icon from './Icon.svelte';
  import Radar from './Radar.svelte';
  import { ui, clock, weather } from '../lib/state.svelte.js';
  import { weatherInfo, dayInfo, dow, time, dayKey, formatDate } from '../lib/format.js';
  import { alertList, isWarning, isNew, until, shortEvent, sections, advice, summary, speech, readAll } from '../lib/wxalerts.js';
  import { say, speak } from '../lib/announce.svelte.js';

  let wx = $derived(weather.data);
  let i = $derived(ui.weatherDay);
  let d = $derived(wx && i != null ? wx.days[i] : null);
  let info = $derived(d ? dayInfo(d) : null);
  let metric = $derived(wx && wx.unit === 'C');
  let alerts = $derived(wx ? alertList(wx.alerts, clock.now) : []);
  // With alerts, the furthest day gives its place to the Alerts button.
  let days = $derived(wx ? (alerts.length ? wx.days.slice(0, -1) : wx.days) : []);
  // What's shown under the days: a day, the radar, or the alerts (?weather=0&radar or &alerts for screenshots).
  const q = new URLSearchParams(location.search);
  let pane = $state(q.has('radar') ? 'radar' : q.has('alerts') ? 'alerts' : 'day');
  let pick = $state(0);  // the alert shown beside the list
  let sel = $derived(alerts[Math.min(pick, alerts.length - 1)]);
  let parts = $derived(sel ? sections(sel) : []);
  // Opened from Home's alert: straight to the alerts, the worst one showing.
  $effect(() => { if (ui.weatherAlert && d) { pane = 'alerts'; pick = 0; ui.weatherAlert = false; } });
  // The last alert ending while they're on show: back to the day.
  $effect(() => { if (pane === 'alerts' && wx && !alerts.length) pane = 'day'; });
  // Read aloud: one alert (keyed by its id), or every alert's name and end time ('all').
  let reading = $state(null);
  function read(key, text) {
    reading = key;
    speak(text, { kind: 'weather', max: 1500 }).finally(() => { if (reading === key) reading = null; });
  }
  const tone = (a) => (isWarning(a) ? 'red' : /statement$/i.test(a.event) ? 'grey' : 'orange');
  // The home town ("Ames" of "Ames, IA"), picked out where an alert names it.
  let home = $derived(wx && wx.place ? wx.place.split(',')[0] : '');
  const mark = (text) => (home ? text.split(home).flatMap((bit, k) => (k ? [home, bit] : [bit])) : [text]);

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
  const hourLabel = (h) => formatDate(new Date(2000, 0, 1, h), { hour: 'numeric' });
  const dayLabel = (date, n) => (n === 0 && date === dayKey(clock.now) ? 'Today' : dow(date));
  const uvLabel = (u) => (u <= 2 ? 'Low' : u <= 5 ? 'Moderate' : u <= 7 ? 'High' : u <= 10 ? 'Very high' : 'Extreme');
  const amount = (p) => (p == null ? '—' : p <= 0 ? 'None' : metric ? p.toFixed(1) + ' mm' : p < 0.01 ? 'Trace' : p.toFixed(2) + ' in');
  const close = () => { ui.weatherDay = null; pane = 'day'; pick = 0; };
</script>

{#if d}
  <div class="scrim" role="presentation" onclick={close}>
    <div class="panel sheet" role="dialog" aria-label="Weather for {dayLabel(d.date, i)}" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && close()}>
      <header>
        <nav class="days">
          <!-- Radar first: it's about right now and the next two hours. -->
          <button class="rbtn" class:on={pane === 'radar'} onclick={() => (pane = 'radar')}>
            <span class="dn">Radar</span>
            <span class="ic rain"><Icon name="rain" size={22} /></span>
            <span class="num">Now + 2 h</span>
          </button>
          {#if alerts.length}
            <button class="abtn {tone(alerts[0])}" class:on={pane === 'alerts'} onclick={() => { pane = 'alerts'; pick = 0; }}>
              <span class="dn"><Icon name="alert" size={18} /> {alerts.length} {alerts.length === 1 ? 'Alert' : 'Alerts'}</span>
              <span class="aw">{shortEvent(alerts[0].event)}</span>
              <span class="num">{until(alerts[0].ends, clock.now)}</span>
            </button>
          {/if}
          {#each days as day, n (day.date)}
            {@const di = dayInfo(day)}
            <button class:on={n === i && pane === 'day'} onclick={() => { ui.weatherDay = n; pane = 'day'; }}>
              <span class="dn">{dayLabel(day.date, n)}</span>
              <span class="ic {di.tint}"><Icon name={di.icon} size={22} /></span>
              <span class="num"><b>{day.hi}°</b> {day.lo}°</span>
            </button>
          {/each}
        </nav>
        <button class="x" onclick={close} aria-label="Close"><Icon name="close" size={26} /></button>
      </header>

      {#if pane === 'radar'}
        <Radar width={1072} height={470} />
      {:else if pane === 'alerts' && sel}
        <div class="apane">
          <div class="alist">
            <div class="ahead">
              <span>In effect</span>
              {#if say.on}<button class="aread" disabled={reading === 'all'} onclick={() => read('all', readAll(alerts, clock.now))}><Icon name="speaker" size={20} />{reading === 'all' ? 'Reading…' : 'Read all'}</button>{/if}
            </div>
            {#each alerts as a, n (a.event)}
              <button class="arow {tone(a)}" class:on={a === sel} onclick={() => (pick = n)}>
                <span class="at">
                  <span class="ae">{a.event}{#if isNew(a, clock.now.getTime())}<span class="tag">New</span>{/if}{#if a.count > 1}<span class="x2">×{a.count}</span>{/if}</span>
                  <span class="as">{summary(a)}</span>
                </span>
                <span class="au num">{until(a.ends, clock.now)}</span>
              </button>
            {/each}
          </div>
          <div class="adetail">
            <div class="adh">
              <div>
                <h2 class={tone(sel)}>{sel.event}</h2>
                <div class="when">{until(sel.ends, clock.now)}{#if sel.sender} · {sel.sender}{/if}{#if home && (sel.description || '').includes(home)} · <b>includes {home}</b>{/if}</div>
              </div>
              {#if say.on}<button class="aread" disabled={reading === sel.id} onclick={() => read(sel.id, speech(sel, clock.now))}><Icon name="speaker" size={20} />{reading === sel.id ? 'Reading…' : 'Read aloud'}</button>{/if}
            </div>
            {#if sel.ai}<p class="lead">{sel.ai.summary}.</p>{/if}
            {#if advice(sel)}<div class="todo"><b>What to do</b>{advice(sel)}</div>{/if}
            <dl>
              {#each parts as p, n (n)}
                {#if p.label}<dt>{p.label}</dt>{/if}
                <dd class:wide={!p.label}>{#if p.label === 'Places'}{#each mark(p.text) as bit, k (k)}{#if k % 2}<b>{bit}</b>{:else}{bit}{/if}{/each}{:else}{p.text}{/if}</dd>
              {/each}
            </dl>
          </div>
        </div>
      {:else}
      {#if i === 0 && alerts.length}
        <!-- Today: one line for them all; the list is behind the Alerts button. -->
        <button class="aline {tone(alerts[0])}" onclick={() => { pane = 'alerts'; pick = 0; }}>
          <Icon name="alert" size={22} />
          <span class="atitle">{alerts[0].event} <span class="aend">{until(alerts[0].ends, clock.now)}</span>{#if alerts.length > 1}<span class="aend">&nbsp;· {alerts.slice(1, 3).map((a) => a.event).join(', ')}{alerts.length > 3 ? ' +' + (alerts.length - 3) : ''}</span>{/if}</span>
          <span class="amore">Alerts ›</span>
        </button>
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

  /* The Alerts button: the worst alert's colour, white text. */
  .days .abtn { flex: 0 0 132px; color: #fff; background: var(--orange); }
  .days .abtn.red { background: var(--red); }
  .days .abtn.grey { background: var(--secondary); }
  .days .abtn .dn, .days .abtn.on .dn { display: flex; align-items: center; gap: 4px; color: #fff; }
  .days .abtn.on { box-shadow: inset 0 0 0 3px var(--label); }
  .aw { font-size: 15px; font-weight: 700; max-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .abtn .num { font-size: 14px; }

  .aline { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 14px; border-radius: 14px; background: var(--orange); color: #fff; text-align: left; font-size: 18px; font-weight: 700; }
  .aline.red { background: var(--red); }
  .aline.grey { background: var(--secondary); }
  .aline:active, .arow:active { opacity: .6; }
  .atitle { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .aend, .amore { font-weight: 500; opacity: .9; }
  .aread { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 12px; background: var(--fill); color: var(--label); font-size: 16px; font-weight: 600; }
  .aread:disabled { opacity: .6; }

  .apane { flex: 1; min-height: 0; display: grid; grid-template-columns: 440px 1fr; gap: 18px; }
  .alist { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  .ahead { display: flex; align-items: center; justify-content: space-between; font-size: 22px; font-weight: 700; }
  .arow { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 16px; background: var(--fill); border-left: 8px solid var(--orange); text-align: left; color: var(--label); }
  .arow.red { border-left-color: var(--red); }
  .arow.grey { border-left-color: var(--secondary); }
  .arow.on { box-shadow: inset 0 0 0 2px var(--blue); }
  .at { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .ae { font-size: 19px; font-weight: 700; }
  .as { font-size: 15px; color: var(--secondary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .au { flex: none; font-size: 15px; font-weight: 600; color: var(--secondary); }
  .tag { margin-left: 8px; padding: 1px 7px; border-radius: 6px; background: var(--blue); color: #fff; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; vertical-align: 2px; }
  .x2 { margin-left: 6px; font-size: 14px; font-weight: 600; color: var(--secondary); }

  .adetail { min-height: 0; overflow-y: auto; padding: 16px 20px; border-radius: 18px; background: var(--fill); }
  .adh { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .adh h2 { margin: 0; font-size: 26px; color: var(--orange-text); }
  .adh h2.red { color: var(--red-text); }
  .adh h2.grey { color: var(--label); }
  .when { margin-top: 4px; font-size: 16px; color: var(--secondary); }
  .when b { color: var(--label); }
  .lead { margin: 12px 0 0; font-size: 20px; font-weight: 600; line-height: 1.35; }
  .todo { margin-top: 12px; padding: 12px 16px; border-radius: 14px; background: rgba(255, 149, 0, .16); font-size: 18px; line-height: 1.4; }
  .todo b { display: block; margin-bottom: 2px; font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--orange-text); }
  dl { display: grid; grid-template-columns: 96px 1fr; gap: 10px 14px; margin: 14px 0 0; font-size: 17px; line-height: 1.4; }
  dt { padding-top: 3px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--secondary); }
  dd { margin: 0; white-space: pre-line; }
  dd.wide { grid-column: 1 / -1; }

  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: 1.45fr 1fr; gap: 28px; }
  .summary { min-height: 0; overflow-y: auto; }
  .big { display: flex; align-items: center; gap: 16px; margin-bottom: 8px; }
  .cond { font-size: 28px; line-height: 1.15; font-weight: 700; letter-spacing: -.01em; }
  .hl { font-size: 19px; font-weight: 500; color: var(--secondary); }
  .fc { margin: 10px 0 0; font-size: 19px; line-height: 1.45; }
  .fc b { display: block; font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--orange-text); }
  .fc b.night { color: var(--blue-text); }
  .fc.none { color: var(--secondary); }

  .facts { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
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
