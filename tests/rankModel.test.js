const test = require('node:test');
const assert = require('node:assert/strict');

const { getRankModel } = require('../rank/model');

test('getRankModel caches per game and uses game_rank collection', () => {
  const A1 = getRankModel('tetris');
  const A2 = getRankModel('tetris');
  const B = getRankModel('aircraft');

  assert.equal(A1, A2);
  assert.notEqual(A1, B);
  assert.equal(A1.collection.name, 'tetris_rank');
  assert.equal(B.collection.name, 'aircraft_rank');
});

