const DEFAULT_GAMES = [
  { game: 'tetris', modes: ['easy', 'medium', 'hard', 'pvp'] },
  { game: 'aircraft', modes: ['easy', 'medium', 'hard', 'coop'] }
];

function normalizeGame(s) {
  return String(s || '').trim().toLowerCase();
}

function normalizeMode(s) {
  return String(s || '').trim().toLowerCase();
}

function getRankConfig() {
  return DEFAULT_GAMES;
}

function isSupportedGameMode(game, mode) {
  const g = normalizeGame(game);
  const m = normalizeMode(mode);
  const item = DEFAULT_GAMES.find((x) => x.game === g);
  return Boolean(item && item.modes.includes(m));
}

module.exports = {
  getRankConfig,
  isSupportedGameMode,
  normalizeGame,
  normalizeMode
};

