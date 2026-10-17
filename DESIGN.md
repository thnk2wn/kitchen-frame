---
name: "Photo Frame Dashboard"
description: "Flat iOS-style widgets for a household wall display, in daylight and after dark."
colors:
  light-ground: "#f2f2f7"
  light-sheet: "#ffffff"
  light-track: "#e3e3e8"
  light-thumb: "#ffffff"
  light-label: "#000000"
  light-secondary: "#6e6e73"
  light-sep: "#e5e5ea"
  light-blue: "#007aff"
  light-orange: "#ff9500"
  light-red: "#ff3b30"
  light-yellow: "#ff9f0a"
  light-red-text: "#d70015"
  light-blue-text: "#0060df"
  light-orange-text: "#c93400"
  light-ring: "#8e8e93"
  light-cal0: "#ff3b30"
  light-cal0-tint: "rgba(255, 59, 48, .12)"
  light-cal1: "#007aff"
  light-cal1-tint: "rgba(0, 122, 255, .12)"
  light-cal2: "#34c759"
  light-cal2-tint: "rgba(52, 199, 89, .14)"
  light-cal3: "#af52de"
  light-cal3-tint: "rgba(175, 82, 222, .12)"
  dark-ground: "#000000"
  dark-sheet: "#1c1c1e"
  dark-track: "#1c1c1e"
  dark-thumb: "#636366"
  dark-label: "#ffffff"
  dark-secondary: "#98989f"
  dark-sep: "#38383a"
  dark-blue: "#0a84ff"
  dark-orange: "#ff9f0a"
  dark-red: "#ff453a"
  dark-yellow: "#ffd60a"
  dark-red-text: "#ff6961"
  dark-blue-text: "#409cff"
  dark-orange-text: "#ffb340"
  dark-ring: "#7c7c80"
  dark-cal0: "#ff453a"
  dark-cal0-tint: "rgba(255, 69, 58, .22)"
  dark-cal1: "#0a84ff"
  dark-cal1-tint: "rgba(10, 132, 255, .24)"
  dark-cal2: "#30d158"
  dark-cal2-tint: "rgba(48, 209, 88, .2)"
  dark-cal3: "#bf5af2"
  dark-cal3-tint: "rgba(191, 90, 242, .22)"
  idle-night-red: "#b3261e"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "156px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-.04em"
  display-idle:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "300px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-.04em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "36px"
    fontWeight: 700
    letterSpacing: "-.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "24px"
    fontWeight: 700
    letterSpacing: "-.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "18px"
    lineHeight: 1.25
  task:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "21px"
  task-large:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "24px"
  event:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "22px"
    fontWeight: 600
    letterSpacing: "-.01em"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "17px"
  weather-display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "76px"
    fontWeight: 300
    lineHeight: 1
    letterSpacing: "-.03em"
rounded:
  sheet: "28px"
  segment-track: "15px"
  segment: "12px"
  calendar-event: "10px"
  circle: "50%"
spacing:
  "4": "4px"
  "6": "6px"
  "8": "8px"
  "10": "10px"
  "12": "12px"
  "14": "14px"
  "16": "16px"
  "18": "18px"
  "20": "20px"
  "24": "24px"
  "26": "26px"
  "28": "28px"
  "32": "32px"
  "40": "40px"
components:
  sheet-light:
    backgroundColor: "{colors.light-sheet}"
    rounded: "{rounded.sheet}"
    padding: "24px 26px"
  navigation-light:
    backgroundColor: "{colors.light-track}"
    rounded: "{rounded.segment-track}"
    padding: "3px"
  segment-selected-light:
    backgroundColor: "{colors.light-thumb}"
    textColor: "{colors.light-label}"
    rounded: "{rounded.segment}"
    height: "48px"
    padding: "0 20px"
  button-link-light:
    textColor: "{colors.light-blue-text}"
    padding: "8px 0 0"
  input-light:
    textColor: "{colors.light-label}"
    height: "52px"
    padding: "0"
  sheet-dark:
    backgroundColor: "{colors.dark-sheet}"
    rounded: "{rounded.sheet}"
    padding: "24px 26px"
  navigation-dark:
    backgroundColor: "{colors.dark-track}"
    rounded: "{rounded.segment-track}"
    padding: "3px"
  segment-selected-dark:
    backgroundColor: "{colors.dark-thumb}"
    textColor: "{colors.dark-label}"
    rounded: "{rounded.segment}"
    height: "48px"
    padding: "0 20px"
  button-link-dark:
    textColor: "{colors.dark-blue-text}"
    padding: "8px 0 0"
  input-dark:
    textColor: "{colors.dark-label}"
    height: "52px"
    padding: "0"
  button-add-light:
    textColor: "{colors.light-blue-text}"
    padding: "10px 4px"
  button-add-dark:
    textColor: "{colors.dark-blue-text}"
    padding: "10px 4px"
  task-row:
    padding: "12px 0 0"
    typography: "{typography.task}"
  task-row-large:
    padding: "16px 0 0"
    typography: "{typography.task-large}"
  calendar-event:
    rounded: "{rounded.calendar-event}"
    padding: "7px 9px"
    width: "100%"
  standby-night:
    backgroundColor: "{colors.dark-ground}"
    textColor: "{colors.idle-night-red}"
    padding: "0 72px"
---

# Design System: Photo Frame Dashboard

## Overview

**Creative North Star: "iOS widgets on a wall"**

The frame uses the iOS widget and grouped-list language selected in the direction contract. Large time and weather values support a glance from across the room. Rounded sheets, inset separators, and direct text actions support touch use up close.

The built system uses flat fills and a system sans stack. Light mode has a pale grey ground and white sheets. Dark mode has a black ground and charcoal sheets. State and source colours carry meaning; they are not decorative borders. StandBy replaces the dashboard with a black clock screen after inactivity.

Recorded from `dashboard/src/style.css`, `App.svelte`, all four views, `TaskRow.svelte`, `EventRow.svelte`, `Icon.svelte`, and `lib/state.svelte.js` / `lib/format.js`. Hardware and performance constraints are in `CLAUDE.md`. This records the replacement visual world after the reported ship verdict. It is a source-based record, not a new device verification.

**Key Characteristics:**

- Large, steady numbers with tabular figures.
- Flat rounded sheets and inset list separators.
- Theme-specific text accents, separate from icon and fill accents.
- Sunrise/sunset themes and a red night idle screen.
- Fixed frame geometry and short, event-driven feedback.

## Colors

The palette pairs neutral sheets with iOS-style state colours. Frontmatter keys use a `light-` or `dark-` prefix plus the CSS custom-property name. Apply each theme as a complete set. Exact colour values live in the frontmatter.

### Primary

Blue marks To-do, navigation actions, focus outlines, the input caret, rain icons, and precipitation text. `blue-text` is the text variant; `blue` is the fill and icon variant. Selection uses the first blue calendar tint.

### Secondary

Orange marks Groceries. Its heading and Add action use `orange-text`; its plus disc and completion ring use `orange`. Red marks the current calendar date; `red-text` marks overdue dates and warning text. Yellow marks sun icons. The special `idle-night-red` applies only to the night idle screen.

Calendar sources cycle through four colours with `event.cal % 4`: red, blue, green, purple. Home uses solid source dots. The week view uses the paired translucent `cal0-tint` through `cal3-tint` fills. These are valid source encoding, not a general card decoration.

### Neutral

`ground` is the outer canvas; `sheet` is the widget fill; `track` and `thumb` distinguish the segmented control and its selection. `label` carries primary text, `secondary` carries supporting text, `sep` draws hairline separators, and `ring` outlines incomplete tasks. The declared but unused `press` and `tertiary` variables are not promoted to documented primitives.

**The Text Accent Rule.** Use the text accent tokens for coloured text. Use the plain accents for fills, rings, and icons.

### Theme switching

The root `data-theme` attribute selects light or dark tokens. Automatic mode is light from sunrise inclusive to sunset exclusive, using the current local day's weather record. A missing sunrise or sunset falls back independently to 07:00 or 19:00 local time. Before sunrise and at or after sunset, the theme is dark.

The theme is checked on the minute-aligned clock tick and after a successful weather fetch. `?theme=light` or `?theme=dark` persists an override in `localStorage` under `frame-theme`; `?theme=auto` restores the sun-based path. Switching is immediate, without a crossfade. Night idle colour follows the resolved theme, including an override.

## Typography

The implemented display and body share the system sans stack recorded in frontmatter. There is no bundled display face or separate mono family. The actual face depends on platform availability; SF Pro is not guaranteed on Android. The type scale is task-specific, not a claimed mathematical ratio.

### Hierarchy

- Display: the Home clock; idle uses the larger `display-idle` role. Both show time without the trailing AM/PM token.
- Headline: full-list titles; list counts also use 36px bold text.
- Title: Home widget headings. Event titles use the separate `event` role.
- Body: global default. Tasks use `task`, or `task-large` on full lists.
- Label: event metadata and weather details. Due dates use 16px; week-event time and precipitation use 14px. These small values are supporting detail, not distance-reading targets.
- Weather display: current temperature. The idle temperature uses 44px at weight 300.
- Weekday labels: 15px, weight 600, uppercase, with .04em tracking. These are calendar labels, not decorative eyebrows.

**The Stable Numbers Rule.** Use tabular figures for clocks, temperatures, dates, times, and counts.

## Layout

The app is a fixed 1280×800 stage at DPR 1, with body overflow hidden. No responsive breakpoints or small-screen reflow are implemented. Hardware is Android 6, WebView 106, 1 GB RAM, Cortex-A7, and Mali-400.

The top bar has three columns (`1fr auto 1fr`), with 18px 28px 14px padding. Navigation stays centered, the temperature sits right, and a compact clock appears left outside Home. The content area flexes into the remaining height. Only the selected view mounts.

All main views use 10px 28px 28px outer padding. Home has a 412px time/weather column and two equal remaining columns, separated by 20px. Weather sits at the foot of the first column. Calendar and To-do content scroll inside their sheets; footer actions remain visible. This is the built exception to the brief's shorthand of one sheet per tab.

Calendar uses one sheet with seven equal day columns and 20px vertical padding. Each column has 10px horizontal padding and its own event scroll area. Groceries uses two equal item columns with a 40px gap; To-do uses one. List sheets use 26px 32px padding. The spacing tokens record observed recurring values, not a mandatory arithmetic scale.

## Elevation & Depth

Depth comes from the contrast between the ground, sheets, track, and selected segment. There are no shadows, blurs, or filters. The selected segment is a flat fill, despite the source comment calling it raised. Hairline separators and task ring borders remain part of the system; the brief's no-border direction applies to decorative container outlines, not every stroke.

**The Flat Surface Rule.** Use solid fills, spacing, and separators for hierarchy. Do not add shadows, blur, or filters.

## Shapes

Sheets use ordinary CSS rounded corners, with the `sheet` radius. The source does not implement a true continuous-corner curve. Navigation uses separate track and segment radii. Week events use compact rounded rectangles. Date badges, plus discs, task rings, and source dots are circles.

Separators are 1px solid strokes. Completion rings have a 2px stroke and measure 26px on Home or 30px on full lists. Source dots measure 10px; the current-date disc measures 46px. Avoid adding outer widget borders. The calendar's tinted event blocks are functional source markers, not generic chips; there is no standalone chip component.

## Components

### Buttons

Actions are direct coloured text. Home footer actions use 19px, weight 600, and the theme's blue text colour, with 8px top padding. Pressing them reduces opacity to .5. Add uses the list's text accent, 21px at weight 600, and 10px 4px padding. It appears only for a nonempty trimmed draft; while saving it is disabled at .4 opacity. No filled primary CTA or hover treatment is implemented.

The global keyboard focus style is a 3px blue outline with a 2px offset. Keep the distinction between keyboard focus and touch feedback.

### Cards / Containers

The shared sheet uses the frontmatter radius, fill, and padding. Home weather overrides padding to 22px 24px 18px. Lists and Calendar use the layout-specific padding above. Content is clipped to the rounded sheet; scroll is assigned to internal regions.

### Inputs / Fields

The New item field is transparent and borderless, 52px high, with 24px text and a secondary-colour placeholder. Its row has a bottom separator, a 16px gap, and 6px vertical padding. A 30px accent circle contains an 18px inline SVG plus. The caret stays blue, including Groceries. The field removes its own outline; focus is shown on the row instead, whose separator becomes a 2px line in the list accent while the field has focus.

### Navigation

The four text segments are Home, Calendar, Groceries, and To-do. The track has 3px padding. Each segment is at least 150px wide and 48px high, with 0 20px padding and 18px text. Selection changes the fill to `thumb` and weight from 500 to 600. Pressing an unselected segment reduces opacity to .5. There is no mobile variant or sliding animation.

### Task rows

The whole row is a completion button. A ring precedes wrapping text; the inset separator starts under the text, not under the ring. Home uses a 14px gap and 12px vertical content spacing. Full lists use a 16px gap and 16px spacing. Due dates sit below the title; overdue text uses `red-text`.

On completion, the ring fills with the list accent and shows an inline SVG check. Background and border colour transition for .15s ease-out. The title becomes secondary-coloured. After 350ms the completion callback removes the row optimistically; failure restores the item. A normal press changes title opacity to .6. This brief feedback is allowed; continuous animation is not.

### Calendar events

Home rows pair a source dot with a wrapping title and supporting time/location text. A current event shows a bold Now marker. Home omits finished timed events; the week view keeps them. Week event buttons use source tints, 7px 9px padding, and a .7 pressed opacity. Titles initially clamp to two lines. A tap expands the title, time range, and location; another tap collapses it. Past events lose the tint and horizontal padding, and their title becomes secondary-coloured.

### StandBy idle screen

After five minutes without pointer activity, the app selects Home and places a full-stage button above it. The idle screen is always black. In light theme its clock and main content are white, with grey date and next-event time. In dark theme all foreground content uses `idle-night-red`.

The idle layout has 72px horizontal padding and a 56px gap. Its clock uses `display-idle`. The side column has a 22px gap and 40px top padding; it shows the date, available weather, and the next future timed event today. It omits all-day events and tomorrow's events. Tap wakes to Home and reloads the lists. List polling pauses during idle; the clock continues at minute intervals. No photo slideshow is built, and no continuous motion is used.

### Icons and preview scope

Icons are inline SVG strokes on a 24px viewBox, with a 2px stroke, rounded caps and joins, and currentColor. They do not use glyph icons or an icon font. Sidecar samples preserve source states and theme variables, with light-theme fallbacks for isolated previews. They are static HTML/CSS samples; business behavior still belongs to Svelte. Preview-only tonal strips are metadata rendered as compatible hex/rgba values, not an expanded application palette.

## Do's and Don'ts

### Do:

- Do use the theme tokens from dashboard/src/style.css and preserve their text-versus-fill roles.
- Do keep the fixed 1280×800 layout and scroll busy content inside its allocated sheet or day column.
- Do retain inset separators, calendar source colours, and completion rings where the built components use them.
- Do use inline SVG stroke icons and tabular figures.
- Do preserve sunrise/sunset switching, the five-minute idle timeout, and tap-to-wake behavior.

### Don't:

- Don't add shadows, blur, filters, or continuous animation on the Mali-400 GPU.
- Don't use oklch(), color-mix(), :has(), CSS nesting, or 4- or 8-digit hex colours in WebView 106.
- Don't turn every row into a bordered card or add decorative pills and kickers.
- Don't treat preview tonal ramps as production tokens or introduce hover effects that the app does not implement.
- Don't document a photo slideshow, mobile layout, or responsive breakpoint as shipped behavior.

Not canonized or repaired: the input's missing visible focus treatment is not a recommended pattern. The built system-font display is recorded as evidence of the user-pinned Apple direction, not promoted as a general display-font rule; the documenter floor flags system display faces. No source changes were authorized. Photo sourcing remains unresolved. The supplied ship verdict is retained; this documentation pass does not claim to repeat the finish review.
