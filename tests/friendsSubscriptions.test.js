const test = require('node:test');
const assert = require('node:assert/strict');
const { createFriendsSubscriptions } = require('../realtime/friendsSubscriptions');

test('friendsSubscriptions replaceSubscription indexes watchers correctly', () => {
  const subs = createFriendsSubscriptions();
  subs.replaceSubscription('s1', ['a', 'b', 'b']);
  subs.replaceSubscription('s2', ['b', 'c']);
  assert.equal(subs.getWatchers('a').has('s1'), true);
  assert.equal(subs.getWatchers('b').has('s1'), true);
  assert.equal(subs.getWatchers('b').has('s2'), true);
  assert.equal(subs.getWatchers('c').has('s2'), true);
});

test('friendsSubscriptions unsubscribeSocket removes reverse indexes', () => {
  const subs = createFriendsSubscriptions();
  subs.replaceSubscription('s1', ['a', 'b']);
  subs.unsubscribeSocket('s1');
  assert.equal(subs.getWatchers('a').has('s1'), false);
  assert.equal(subs.getWatchers('b').has('s1'), false);
});

test('friendsSubscriptions replaceSubscription overwrites old set', () => {
  const subs = createFriendsSubscriptions();
  subs.replaceSubscription('s1', ['a', 'b']);
  subs.replaceSubscription('s1', ['c']);
  assert.equal(subs.getWatchers('a').has('s1'), false);
  assert.equal(subs.getWatchers('b').has('s1'), false);
  assert.equal(subs.getWatchers('c').has('s1'), true);
});
