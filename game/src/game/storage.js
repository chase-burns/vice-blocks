// storage.js — profile persistence in localStorage under one key.
// The saved shape covers cash, story position, owned weapons, respect and
// garage upgrades. If browser storage throws (private browsing and the
// like), an in-memory object keeps progress for the current session.
const KEY = 'viceblocks-save';
let sessionCopy = null;

export function loadProfile() {
  try {
    const text = localStorage.getItem(KEY);
    if (text) return JSON.parse(text);
  } catch { /* use the session copy below */ }
  return sessionCopy;
}

export function saveProfile(s) {
  const profile = {
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
  sessionCopy = profile;
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch { /* sessionCopy already holds this save */ }
}
