// storage.js — the persistent profile: cash, respect, story progress,
// owned weapons and garage upgrades, kept in localStorage under one
// key so a reload picks the run back up.

const SAVE_KEY = 'viceblocks-save';

export function defaultProfile() {
  return {
    cash: 0,
    respect: 0,
    missionIdx: 0,
    weapons: { pistol: false, smg: false, shotgun: false, rifle: false },
    armorUp: false,
    engineUp: false,
  };
}

export function loadProfile() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return { ...defaultProfile(), ...parsed, weapons: { ...defaultProfile().weapons, ...(parsed.weapons || {}) } };
  } catch {
    return null;
  }
}

export function saveProfile(state) {
  try {
    const data = {
      cash: Math.round(state.cash),
      respect: Math.round(state.respect),
      missionIdx: state.missionIdx,
      weapons: {
        pistol: !!state.hasGun,
        smg: !!state.hasSmg,
        shotgun: !!state.hasShotgun,
        rifle: !!state.hasRifle,
      },
      armorUp: !!state.armorUp,
      engineUp: !!state.engineUp,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Private mode / storage full: the run simply does not persist.
  }
}
