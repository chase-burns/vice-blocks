// storage.js — save-game persistence. The profile (cash, story
// progress, arsenal, respect, garage upgrades) is stored as JSON in
// localStorage under a single key. When storage is unavailable —
// private mode, blocked cookies — an in-memory copy still lets the
// session keep its progress.
const SAVE_KEY = 'viceblocks-save';
let memoryFallback = null;

export function loadProfile() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    void err; // fall through to the in-memory copy
  }
  return memoryFallback;
}

export function saveProfile(s) {
  const data = {
    cash: s.cash,
    missionIdx: s.missionIdx,
    hasGun: s.hasGun,
    armor: s.armor,
    respect: s.respect,
    hasSmg: s.hasSmg,
    hasShotgun: s.hasShotgun,
    hasRifle: s.hasRifle,
    weapon: s.weapon,
    armorUp: s.armorUp,
    engineUp: s.engineUp,
  };
  memoryFallback = data;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (err) {
    void err; // the in-memory copy above is this session's save
  }
}
