<script module>
  import { ICONS } from '../lib/icons.js';
  // Lucide icons on a 24px grid, 2px round strokes. Each icon's markup (constant, from ICONS) is parsed
  // once and its nodes copied after that: parsing per icon was a noticeable part of opening Home, which
  // shows about 30 of them.
  const parsed = new Map();
  function draw(name) {
    return (svg) => {
      let src = parsed.get(name);
      if (!src) {
        src = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        src.innerHTML = ICONS[name] || '';
        parsed.set(name, src);
      }
      svg.replaceChildren(...Array.from(src.childNodes, (n) => n.cloneNode(true)));
    };
  }
</script>

<script>
  let { name, size = 24 } = $props();
</script>

<svg class="i" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" {@attach draw(name)}></svg>
