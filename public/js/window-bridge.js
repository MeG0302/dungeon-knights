// window-bridge.js — classic script, loaded AFTER engine scripts.
// Copies global lexical bindings (class declarations) onto window
// so Next.js React components can use window.AudioManager etc.
(function () {
  if (typeof window === 'undefined') return;
  var names = [
    'AudioManager',
    'Knight',
    'KnightManager',
    'RARITY',
    'LootNode',
    'Dungeon',
    'DUNGEONS',
    'DungeonRenderer',
    'PathfindingAI',
    'KnightAI',
    'CombatSystem',
    'UI',
    'Game',
    'CONFIG',
    'Web3Manager',
  ];
  names.forEach(function (name) {
    try {
      var value = (0, eval)('typeof ' + name + " !== 'undefined' ? " + name + ' : undefined');
      if (typeof value !== 'undefined' && typeof window[name] === 'undefined') {
        window[name] = value;
      }
    } catch (e) { /* ignore */ }
  });
})();
