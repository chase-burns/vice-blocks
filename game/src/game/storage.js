// storage.js — the player's profile, persisted under a single
// localStorage key. What gets saved: cash, story progress, which weapons
// are owned and which is equipped, respect, and both garage upgrades.
// When browser storage refuses (private windows do), an in-memory copy
// still keeps the profile alive for the rest of the session.
const SAVE_KEY = 'viceblocks-save';
let memoryFallback = null;

export function loadProfile() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* fall through to the in-memory copy */ }
  return memoryFallback;
}

export function saveProfile(s) {
  const snapshot = {
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
  memoryFallback = snapshot;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
  } catch { /* memoryFallback already captured this save */ }
}
