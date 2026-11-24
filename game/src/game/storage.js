// storage.js — persistence for the player profile under one
// localStorage key. Saved fields: cash, story progress, owned weapons
// and the equipped one, respect, and the two garage upgrades. If the
// browser blocks storage (private mode, for instance), a module-level
// in-memory copy still carries the profile for the rest of the session.
const PROFILE_KEY = 'viceblocks-save';
let sessionCopy = null;

export function loadProfile() {
  try {
    const text = localStorage.getItem(PROFILE_KEY);
    if (text) return JSON.parse(text);
  } catch { /* storage unavailable — use the in-memory copy below */ }
  return sessionCopy;
}

export function saveProfile(s) {
  const record = {
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
  sessionCopy = record;
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(record));
  } catch { /* sessionCopy already holds this save */ }
}
