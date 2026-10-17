import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSetting } from './youtube.js';

test('youtube setting: groups of video and playlist links, in any mix and link form', () => {
  const g = parseSetting('Diggers: https://youtu.be/kK8ADbD7J_4 https://www.youtube.com/watch?v=x54I6dKA8s4&t=3 | Songs: https://www.youtube.com/playlist?list=PLabc-123_x | Bad: nothing here | : https://youtu.be/kK8ADbD7J_4');
  assert.deepEqual(g, [
    { name: 'Diggers', items: [{ video: 'kK8ADbD7J_4' }, { video: 'x54I6dKA8s4' }] },
    { name: 'Songs', items: [{ playlist: 'PLabc-123_x' }] },
  ]);
  assert.deepEqual(parseSetting(''), []);
  // A video link that also names a playlist is the video.
  assert.deepEqual(parseSetting('A: https://www.youtube.com/watch?v=kK8ADbD7J_4&list=PLzz')[0].items, [{ video: 'kK8ADbD7J_4' }]);
});
