const test = require('node:test');
const assert = require('node:assert/strict');

const { computeRankScore, encodeMember, decodeMember, sortEntries } = require('../rank/service');

test('computeRankScore follows mode rules', () => {
  assert.equal(computeRankScore('easy', 10, 999), 10);
  assert.equal(computeRankScore('coop', 10, 3), 13);
  assert.equal(computeRankScore('coop', 10, undefined), 10);
  assert.equal(computeRankScore('pvp', 10, 3), 10);
  assert.equal(computeRankScore('pvp', 10, 30), 30);
});

test('encodeMember/decodeMember roundtrip', () => {
  const m = encodeMember(1710000000123, 'abc');
  const d = decodeMember(m);
  assert.equal(d.id, 'abc');
  assert.equal(d.ts, 1710000000123);
  const d2 = decodeMember('no_delim');
  assert.equal(d2.id, 'no_delim');
});

test('sortEntries orders by rankScore desc then timestamp desc', () => {
  const base = Date.now();
  const entries = [
    { id: '1', rankScore: 10, timestamp: new Date(base - 1000) },
    { id: '2', rankScore: 10, timestamp: new Date(base) },
    { id: '3', rankScore: 11, timestamp: new Date(base - 5000) },
    { id: '4', rankScore: 9, timestamp: new Date(base + 9999) }
  ];

  sortEntries(entries);

  assert.equal(entries[0].id, '3');
  assert.equal(entries[1].id, '2');
  assert.equal(entries[2].id, '1');
  assert.equal(entries[3].id, '4');
});

test('sortEntries handles tied rankScore and timestamp with id', () => {
  const t = new Date(1710000000000);
  const entries = [
    { id: 'b', rankScore: 10, timestamp: t },
    { id: 'a', rankScore: 10, timestamp: t }
  ];
  sortEntries(entries);
  assert.equal(entries[0].id, 'b');
  assert.equal(entries[1].id, 'a');
});
