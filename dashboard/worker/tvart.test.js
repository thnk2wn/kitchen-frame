import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickShow } from './tvart.js';

const show = (name, network, country, webChannel) => ({ show: {
  name, image: { medium: 'https://static.tvmaze.com/' + name + '/' + (network || webChannel) + '.jpg' },
  network: network ? { name: network, country: { code: country } } : null, webChannel: webChannel ? { name: webChannel } : null,
} });

test('tv art: the show of that name on the channel playing it, else an American one', () => {
  const dwts = [show('Dancing with the Stars', 'Seven Network', 'AU'), show('Dancing with the Stars', 'ABC', 'US', 'Disney+'), show('Dancing with the Stars', 'Three', 'NZ')];
  // YouTube TV names the local station: "ABC 11" is ABC.
  assert.equal(pickShow(dwts, 'Dancing With the Stars', 'ABC 11').network.name, 'ABC');
  assert.equal(pickShow(dwts, 'Dancing With the Stars', 'Seven').network.name, 'Seven Network');
  // No channel, or one that matches none: the American one.
  assert.equal(pickShow(dwts, 'Dancing With the Stars', '').network.name, 'ABC');
  assert.equal(pickShow(dwts, 'Dancing With the Stars', 'Fox 8').network.name, 'ABC');
  // A streaming-only show has no network.
  assert.equal(pickShow([show('Dark Matter', 'CTV Sci-Fi Channel', 'CA'), show('Dark Matter', null, null, 'Apple TV')], 'Dark Matter', '').webChannel.name, 'Apple TV');
  // "&" and punctuation don't stop a match.
  assert.ok(pickShow([show('Law & Order: SVU', 'NBC', 'US')], 'Law and Order SVU', 'NBC 5'));
});

test('tv art: nothing for a title that is only like a show, or a show without a picture', () => {
  assert.equal(pickShow([show('The Golden Bachelor', 'ABC', 'US')], 'The Bachelor', 'ABC'), null);
  assert.equal(pickShow([{ show: { name: 'News', image: null, network: { name: 'ABC' } } }], 'News', 'ABC'), null);
  assert.equal(pickShow(null, 'x', ''), null);
});
