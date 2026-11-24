// localStorage profile persistence (WO Task: storage) with in-memory fallback.
const KEY = 'viceblocks-save';
let mem = null;
export function loadProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* private mode etc. */ }
  return mem;
}
export function saveProfile(s) {
  const data = { cash: s.cash, missionIdx: s.missionIdx, hasGun: s.hasGun, armor: s.armor, respect: s.respect, hasSmg: s.hasSmg, hasShotgun: s.hasShotgun, hasRifle: s.hasRifle, weapon: s.weapon, armorUp: s.armorUp, engineUp: s.engineUp };
  mem = data;
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* keep mem copy */ }
}
