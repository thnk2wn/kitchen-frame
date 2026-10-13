import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDashboard, miniMarkdown } from './dashboard.js';

test('a sections dashboard becomes groups of devices, cameras and templates', () => {
  const d = parseDashboard({ views: [{ title: 'Ours', header: { card: { type: 'markdown', content: '## {{ 1 }}' } }, sections: [
    { type: 'grid', cards: [
      { type: 'heading', heading: 'Key Devices' },
      { type: 'thermostat', entity: 'climate.up' },
      { type: 'tile', entity: 'light.kitchen', name: 'Kitchen' },
      { type: 'tile', entity: 'lock.front' },
      { type: 'tile', entity: 'sensor.temp' },
      { type: 'weird-custom-card', entity: 'x.y' },
    ] },
    { type: 'grid', cards: [{ type: 'heading', heading: 'Cameras' }, { type: 'picture-entity', entity: 'camera.door' }] },
    { type: 'grid', cards: [{ type: 'heading', heading: 'Empty' }] },
    { type: 'grid', cards: [{ type: 'heading', heading: 'Laundry' }, { type: 'vertical-stack', cards: [{ type: 'markdown', content: 'Washer {{ x }}' }] }] },
  ] }] });
  assert.equal(d.title, 'Ours');
  assert.equal(d.header, 'header');
  assert.deepEqual(d.groups.map((g) => g.title), ['Key Devices', 'Cameras', 'Laundry']);
  assert.deepEqual(d.groups[0].items.map((i) => i.kind), ['climate', 'toggle', 'lock', 'value']);
  assert.equal(d.groups[0].items[1].name, 'Kitchen');
  assert.deepEqual(d.groups[1].items, [{ kind: 'camera', entity: 'camera.door' }]);
  assert.equal(d.templates[d.groups[2].items[0].key], 'Washer {{ x }}');
});

test('dashboard markdown is escaped and only lightly formatted', () => {
  assert.equal(miniMarkdown('## 🔒 Locked · **2** open\n\n<script>x</script>'), '<p class="h">🔒 Locked · <b>2</b> open</p><p>&lt;script&gt;x&lt;/script&gt;</p>');
});

test('link-only lines are dropped and inline links keep their text', () => {
  assert.equal(miniMarkdown('Washer idle\n[Open Laundry →](/dashboard-laundry/overview)\nSee [docs](https://x.y) here'), '<p>Washer idle</p><p>See docs here</p>');
});
