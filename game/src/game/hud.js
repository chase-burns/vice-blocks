// hud.js — everything flat that sits over the 3D view: bars, cash,
// stars, the mission line and countdown, the SBPD dispatch board,
// weapon slots, prompts, and the rotating circular minimap. The DOM
// side only writes text and styles; the minimap is a 2D canvas.

import { clamp, dist2 } from '../rng.js';
import { districtAt, CITY_HALF } from './world.js';
import { weaponDef, WEAPONS, WEAPON_ORDER, rankFor } from './player.js';

const RANK_BANDS = [[0, 150], [150, 450], [450, 900]];
const RADIO_NAMES = ['OFF', 'VICE FM', 'SOLMAR'];
const SLOT_LABELS = { pistol: '9MM', smg: 'SMG', shotgun: '12G', rifle: 'AR' };
const OWNED_FIELD = { pistol: 'hasGun', smg: 'hasSmg', shotgun: 'hasShotgun', rifle: 'hasRifle' };

function fmtCash(cash) {
  return '$' + String(Math.max(0, Math.round(cash))).padStart(7, '0');
}

function playerPos(state) {
  const p = state.player;
  return p.inCar ? { x: p.inCar.x, z: p.inCar.z } : { x: p.x, z: p.z };
}

function dispatchLines(state) {
  const pos = playerPos(state);
  const units = [];
  if (state.heli) units.push({ tag: '▲ KESTREL-1 · AIR SUPPORT', d: Math.hypot(state.heli.x - pos.x, state.heli.z - pos.z) });
  for (const cop of state.cops) {
    const d = Math.round(Math.hypot(cop.x - pos.x, cop.z - pos.z));
    if (cop.roadblock) units.push({ tag: '■ ROADBLOCK', d });
    else if (cop.pit) units.push({ tag: '● PIT UNIT', d });
    else units.push({ tag: '◆ PATROL', d });
  }
  units.sort((a, b) => a.d - b.d);
  return units;
}

export function updateHUD(state, ui, nearCarFn) {
  const p = state.player;
  const titleLike = state.mode === 'title' || state.mode === 'busted' || state.mode === 'wasted' || state.mode === 'paused';
  ui.hud.style.display = titleLike ? 'none' : 'block';
  ui.overlay.style.display = titleLike ? 'flex' : 'none';
  if (state.mode === 'title') {
    ui.ovTitle.textContent = 'VICE BLOCKS 3D';
    ui.ovSub.textContent = 'PRESS ANY KEY TO HIT THE STREETS';
    ui.ovFeat.textContent = '8 STORY MISSIONS · 5-STAR WANTED · HELICOPTER + ROADBLOCKS · 2 RADIO STATIONS · 4 WEAPONS · RESPECT RANKS · GARAGE UPGRADES';
    const owned = WEAPON_ORDER.filter((w) => state[OWNED_FIELD[w]]).length;
    ui.ovSave.textContent = (state.missionIdx > 0 || state.cash > 0)
      ? `CONTINUE — MISSIONS ${state.missionIdx}/8 · $${Math.round(state.cash)} · RESPECT ${rankFor(state.respect)} · ${owned} WEAPONS`
      : 'NEW GAME — TAKE JOBS FROM THE CONTACT (E)';
    return;
  }
  if (state.mode === 'busted') { ui.ovTitle.textContent = 'BUSTED'; ui.ovSub.textContent = 'CLICK OR PRESS ANY KEY'; ui.ovFeat.textContent = ''; ui.ovSave.textContent = ''; return; }
  if (state.mode === 'wasted') { ui.ovTitle.textContent = 'WASTED'; ui.ovSub.textContent = 'CLICK OR PRESS ANY KEY'; ui.ovFeat.textContent = ''; ui.ovSave.textContent = ''; return; }
  if (state.mode === 'paused') { ui.ovTitle.textContent = 'PAUSED'; ui.ovSub.textContent = 'P OR CLICK TO RESUME'; ui.ovFeat.textContent = ''; ui.ovSave.textContent = ''; return; }

  ui.health.style.width = clamp(p.hp, 0, 100) + '%';
  ui.armor.style.width = clamp(p.armor, 0, 100) + '%';
  ui.cash.textContent = fmtCash(state.cash);
  ui.stars.textContent = '★'.repeat(state.stars) + '☆'.repeat(5 - state.stars);
  ui.stars.style.opacity = state.stars > 0 ? '1' : '0.35';
  const rank = rankFor(state.respect);
  ui.rank.textContent = 'RESPECT · ' + rank;
  const band = RANK_BANDS[rank === 'KINGPIN' ? 2 : rank === 'OPERATOR' ? 1 : 0];
  ui.respectfill.style.width = (clamp((state.respect - band[0]) / (band[1] - band[0]), 0, 1) * 100) + '%';

  // Mission / taxi line and the big centre countdown.
  let missionText = '';
  let timerText = '';
  if (state.mission) {
    missionText = state.mission.text;
    if (state.mission.timer != null) {
      const secs = Math.max(0, Math.ceil(state.mission.timer));
      timerText = state.mission.kind === 'survive' && state.mission.phase === 'main' ? 'SURVIVE ' + secs + 's' : secs + 's';
    }
  } else if (state.taxi) {
    missionText = state.taxi.phase === 'pickup' ? 'TAXI — PICK UP THE FARE' : 'TAXI — DROP THEM OFF';
    if (state.taxi.timer != null) timerText = Math.max(0, Math.ceil(state.taxi.timer)) + 's';
  }
  ui.mission.textContent = missionText;
  ui.timer.textContent = timerText;
  ui.timer.style.display = timerText ? 'block' : 'none';

  // Dispatch board while the law is interested.
  const units = dispatchLines(state);
  if (units.length && (state.stars > 0 || state.shotMode === 'chase')) {
    let html = `<div class="dhead">SBPD DISPATCH · ${units.length} UNITS</div>`;
    for (const u of units.slice(0, 5)) html += `<div>${u.tag}${u.tag.includes('KESTREL') ? '' : ' · ' + u.d + 'm'}</div>`;
    if (units.length > 5) html += `<div class="dmore">+${units.length - 5} more</div>`;
    ui.dispatch.innerHTML = html;
    ui.dispatch.style.display = 'block';
  } else {
    ui.dispatch.style.display = 'none';
  }

  ui.district.textContent = districtAt(p.x, p.z);
  ui.banner.textContent = state.bannerT > 0 ? state.banner : '';
  ui.banner.style.display = state.bannerT > 0 ? 'block' : 'none';
  ui.msg.textContent = state.msgT > 0 ? state.msg : '';
  ui.msg.style.display = state.msgT > 0 ? 'block' : 'none';

  // Speed block (in a car) or weapon readout (on foot).
  if (p.inCar) {
    const car = p.inCar;
    const mph = Math.round(Math.abs(car.speed || 0) * 2.23694);
    ui.speed.innerHTML = `${mph} MPH<div class="sgear">GEAR ${car.gear || 1}${car.isDrifting ? ' · DRIFT!' : ''} · RADIO ${RADIO_NAMES[state.radio] || 'OFF'}</div>`;
    ui.speed.style.display = 'block';
    ui.weapon.style.display = 'none';
  } else {
    ui.speed.style.display = 'none';
    if (state.hasGun) {
      const def = weaponDef(state);
      const ammo = state.ammo[state.weapon];
      ui.weapon.textContent = `${def.label === '9MM' ? 'PISTOL' : def.label === '12G' ? 'SHOTGUN' : def.label === 'SMG' ? 'SMG' : 'RIFLE'} ${ammo.mag} / ${ammo.res}${state.reloadT > 0 ? ' · RELOADING' : ''}`;
      ui.weapon.style.display = 'block';
    } else ui.weapon.style.display = 'none';
  }
  ui.slots.innerHTML = WEAPON_ORDER.map((w, i) => {
    const owned = state[OWNED_FIELD[w]];
    const cls = !owned ? 'slot dim' : state.weapon === w ? 'slot on' : 'slot';
    return `<span class="${cls}">${i + 1} ${SLOT_LABELS[w]}</span>`;
  }).join('');

  // Bust meter.
  const busting = state.bust > 0.02;
  ui.bustbar.style.display = busting ? 'block' : 'none';
  ui.bustfill.style.width = (state.bust * 100) + '%';

  // Context prompt.
  let prompt = '';
  const zones = state.city.zones;
  if (p.inCar) {
    if (dist2(zones.spray.x, zones.spray.z, p.x, p.z) < 7 * 7) prompt = "E — PAY 'N SPRAY";
  } else if (nearCarFn(state)) prompt = 'F — ENTER VEHICLE';
  else if (dist2(zones.gunshop.x, zones.gunshop.z, p.x, p.z) < 6 * 6) prompt = 'E — AMMU-NATION';
  else if (dist2(zones.contact.x, zones.contact.z, p.x, p.z) < 6 * 6) prompt = 'E — TAKE THE JOB';
  else if (dist2(zones.hospital.x, zones.hospital.z, p.x, p.z) < 6 * 6) prompt = 'E — GET PATCHED UP';
  else if (state.hasGun) prompt = 'T — TAXI WORK · F — CAR · E — INTERACT';
  ui.prompt.textContent = prompt;
}

export function drawMinimap(state, ctx) {
  const size = 168, centre = size / 2, scale = 0.52;
  const p = state.player;
  const heading = p.inCar ? p.inCar.ry : state.camYaw;
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(centre, centre, centre - 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#c9bda6';
  ctx.fillRect(0, 0, size, size);
  ctx.translate(centre, centre);
  ctx.rotate(-heading);
  ctx.translate(-p.x * scale, -p.z * scale);
  // Water east of the shore line.
  ctx.fillStyle = '#57b8ad';
  ctx.fillRect((CITY_HALF + 24) * scale, -400, 800, 1400);
  // Roads.
  ctx.strokeStyle = '#5a5a63';
  ctx.lineWidth = 13 * scale + 3;
  for (let k = -3; k <= 3; k++) {
    const c = k * 46 * scale;
    ctx.beginPath(); ctx.moveTo(c, -400); ctx.lineTo(c, 900); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-400, c); ctx.lineTo(900, c); ctx.stroke();
  }
  const dot = (x, z, r, color) => {
    ctx.beginPath();
    ctx.arc(x * scale, z * scale, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  };
  const objective = (state.mission && state.mission.target) || (state.taxi && state.taxi.target);
  if (objective) dot(objective.x, objective.z, 4.5, '#ffd23e');
  for (const cop of state.cops) dot(cop.x, cop.z, 3, cop.roadblock ? '#ff7b2e' : '#e33f4e');
  if (state.heli) dot(state.heli.x, state.heli.z, 3.5, '#ffffff');
  for (const pk of state.pickups) dot(pk.x, pk.z, 3, '#37e08a');
  ctx.restore();
  // Player arrow, fixed pointing up.
  ctx.save();
  ctx.translate(centre, centre);
  ctx.beginPath();
  ctx.moveTo(0, -8); ctx.lineTo(5.5, 7); ctx.lineTo(0, 3.4); ctx.lineTo(-5.5, 7);
  ctx.closePath();
  ctx.fillStyle = '#ff8c3a';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.stroke();
  ctx.restore();
}
