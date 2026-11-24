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
  const data = { cash: s.cash, missionIdx: s.missionIdx, hasGun: s.hasGun, armor: s.armor };
  mem = data;
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* keep mem copy */ }
}
