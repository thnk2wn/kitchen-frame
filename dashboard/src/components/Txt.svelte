<script>
  // Text with any emoji this device can't draw shown as pictures (lib/emoji.js). Use it for text that
  // comes from people: event titles, list items, notices.
  import { emojiParts } from '../lib/emoji.js';
  let { text } = $props();
  let parts = $derived(emojiParts(text));
</script>

{#each parts as p, i (i)}{#if typeof p === 'string'}{p}{:else}<img class="emoji" src={p.src} alt={p.emoji} draggable="false" />{/if}{/each}

<style>
  .emoji { display: inline-block; width: 1.1em; height: 1.1em; margin: 0 .05em; vertical-align: -0.18em; }
</style>
