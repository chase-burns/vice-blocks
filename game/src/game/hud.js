// hud.js — everything drawn on top of the 3D view: the DOM dashboard
// (health and armour bars, cash, wanted stars, RESPECT rank, weapon
// line, speed, mission text, bust meter, contextual prompts), the SBPD
// dispatch board that names each responding unit, the weapon-slot
// chips, and the rotating circular minimap painted on a 2D canvas.
import { roadCenters, CITY_HALF, districtAt } from './world.js';
import { WEAPONS, WEAPON_ORDER, ownsWeapon, activeWeapon } from './player.js';

export function mph(ms) { return Math.round(Math.abs(ms) * 2.23694); }

const RESPECT_RANKS = [{ at: 700, name: 'KINGPIN' }, { at: 300, name: 'OPERATOR' }, { at: 0, name: 'RUNNER' }];
export function rankName(respect) {
  for (const rank of RESPECT_RANKS) if (respect >= rank.at) return rank.name;
  return 'RUNNER';
}

export function drawMinimap(s, mm) {
  const MAP_SIZE = 168, centerX = MAP_SIZE / 2, centerY = MAP_SIZE / 2;
  const facingYaw = s.player.inCar ? s.player.inCar.ry : s.camYaw;
  mm.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
  mm.save();
  mm.beginPath(); mm.arc(centerX, centerY, centerX - 2, 0, 7); mm.clip();
  mm.fillStyle = '#ddd2b8'; mm.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
  mm.translate(centerX, centerY); mm.rotate(-facingYaw); mm.scale(0.55, 0.55);
  mm.translate(-s.player.x, -s.player.z);
  mm.strokeStyle = '#8a7f6d'; mm.lineWidth = 7;
  for (const c of roadCenters()) {
    mm.beginPath(); mm.moveTo(c, -CITY_HALF - 20); mm.lineTo(c, CITY_HALF + 20); mm.stroke();
    mm.beginPath(); mm.moveTo(-CITY_HALF - 20, c); mm.lineTo(CITY_HALF + 20, c); mm.stroke();
  }
  mm.lineWidth = 1;
  const blip = (x, z, color, r) => { mm.fillStyle = color; mm.beginPath(); mm.arc(x, z, r, 0, 7); mm.fill(); };
  const zones = s.city.zones;
  blip(zones.spray.x, zones.spray.z, '#3dff7a', 4);
  blip(zones.gunshop.x, zones.gunshop.z, '#ff4040', 4);
  mm.fillStyle = '#ffffff';
  mm.fillRect(zones.hospital.x - 4.5, zones.hospital.z - 1.5, 9, 3);
  mm.fillRect(zones.hospital.x - 1.5, zones.hospital.z - 4.5, 3, 9);
  for (const cop of s.cops) {
    if (cop.kind !== 'cop') continue;
    if (cop.roadblock) { mm.fillStyle = '#ff9020'; mm.fillRect(cop.x - 4, cop.z - 4, 8, 8); }
    else blip(cop.x, cop.z, Math.floor(s.time * 3) % 2 ? '#ff4040' : '#4080ff', 3.4);
  }
  if (s.heli) blip(s.heli.x, s.heli.z, '#ffffff', 3.2);
  for (const car of s.cars) if (car.kind === 'traffic') blip(car.x, car.z, '#c8c8c8', 1.8);
  for (const pk of s.pickups) blip(pk.x, pk.z, '#3dff7a', 3);
  const objective = (s.mission && s.mission.target) || (s.taxi && s.taxi.target);
  if (objective) blip(objective.x, objective.z, '#ffe14f', 4.6);
  mm.restore();
  mm.fillStyle = '#ffffff';
  mm.beginPath(); mm.moveTo(centerX, centerY - 6); mm.lineTo(centerX - 4, centerY + 5); mm.lineTo(centerX + 4, centerY + 5); mm.closePath(); mm.fill();
}

function starString(wanted) {
  let out = '';
  for (let i = 0; i < 5; i++) out += i < wanted ? '★' : '☆';
  return out;
}

function bottomRightLine(s, car) {
  if (car) {
    const gearLabel = car.gear === 0 ? 'R' : (car.gear == null ? 'N' : car.gear);
    let line = 'GEAR ' + gearLabel + ' · ' + (car.isDrifting ? 'DRIFT!' : '');
    if (s.radio) line += ' · RADIO ' + (s.radio === 1 ? 'VICE FM' : 'SOLMAR');
    return line;
  }
  if (!s.hasGun) return 'UNARMED';
  const def = WEAPONS[activeWeapon(s)];
  let line = def.label + ' ' + s[def.mag] + ' / ' + s.reserve;
  if (s.reloadT > 0) line += ' · RELOADING';
  return line;
}

function renderWeaponSlots(s, ui, hudActive) {
  if (!ui.slots) return;
  const showSlots = s.hasGun && hudActive;
  ui.slots.style.display = showSlots ? 'flex' : 'none';
  if (!showSlots) return;
  const html = WEAPON_ORDER.map((key, i) => {
    const owned = ownsWeapon(s, key);
    const equipped = activeWeapon(s) === key && !s.player.inCar;
    const chipStyle = equipped
      ? 'border:1px solid #ffd94f;color:#ffd94f;background:rgba(30,22,4,.72)'
      : owned
        ? 'border:1px solid rgba(255,255,255,.5);color:#fff;background:rgba(10,6,16,.6)'
        : 'border:1px solid rgba(255,255,255,.18);color:rgba(255,255,255,.35);background:rgba(10,6,16,.45)';
    return '<div style="' + chipStyle + ';border-radius:6px;padding:4px 8px;font-size:11.5px;font-weight:800;letter-spacing:1px;text-shadow:0 1px 0 #000">' + (i + 1) + ' ' + WEAPONS[key].short + '</div>';
  }).join('');
  if (ui.slots._html !== html) { ui.slots.innerHTML = html; ui.slots._html = html; }
}

function renderDispatchBoard(s, ui, hudActive) {
  if (!ui.dispatch) return;
  const unitLines = [];
  if (s.heli) unitLines.push('▲ KESTREL-1 · AIR SUPPORT');
  for (const cop of s.cops) {
    if (cop.kind !== 'cop') continue;
    const gap = Math.round(Math.hypot(cop.x - s.player.x, cop.z - s.player.z));
    if (cop.roadblock) unitLines.push('■ ROADBLOCK · ' + gap + 'm');
    else {
      const role = Math.abs(cop.z - s.player.z) > Math.abs(cop.x - s.player.x) ? 'PIT UNIT' : 'PATROL';
      unitLines.push((unitLines.length % 2 ? '◆' : '●') + ' ' + role + ' · ' + gap + 'm');
    }
  }
  const showBoard = s.wanted > 0 && hudActive && unitLines.length > 0;
  ui.dispatch.style.display = showBoard ? 'block' : 'none';
  if (!showBoard) return;
  const rowsHtml = unitLines.slice(0, 5).join('<br>') + (unitLines.length > 5 ? '<br>+' + (unitLines.length - 5) + ' more' : '');
  const html = '<span class="dhead">SBPD DISPATCH · ' + unitLines.length + ' UNITS</span><br>' + rowsHtml;
  if (ui.dispatch._html !== html) { ui.dispatch.innerHTML = html; ui.dispatch._html = html; }
}

function contextualPrompt(s, nearCarFn, inCarNow) {
  const p = s.player;
  const distSqTo = (zone) => (p.x - zone.x) ** 2 + (p.z - zone.z) ** 2;
  if (!inCarNow) {
    if (nearCarFn()) return 'F — STEAL / ENTER CAR';
    const zones = s.city.zones;
    if (distSqTo(zones.gunshop) < zones.gunshop.r * zones.gunshop.r) {
      const nextWeapon = WEAPON_ORDER.find((w) => !ownsWeapon(s, w));
      return nextWeapon ? 'AMMU-NATION — E BUY ' + WEAPONS[nextWeapon].label + ' $' + WEAPONS[nextWeapon].price : 'AMMU-NATION — E RESTOCKS AMMO';
    }
    if (distSqTo(zones.hospital) < zones.hospital.r * zones.hospital.r) return 'HOSPITAL — HEALING…';
    return '';
  }
  const sprayZone = s.city.zones.spray;
  return distSqTo(sprayZone) < sprayZone.r * sprayZone.r ? "PAY 'N SPRAY — $100 CLEARS STARS" : 'F — EXIT CAR · T — TAXI JOB · SPACE — DRIFT';
}

const MODE_OVERLAYS = {
  title: ['VICE BLOCKS 3D', 'PRESS ANY KEY TO HIT THE STREETS'],
  paused: ['PAUSED', 'Click or press Enter to resume'],
  busted: ['BUSTED', ''],
  wasted: ['WASTED', ''],
};

export function updateHUD(s, ui, nearCarFn) {
  const inPlay = s.mode === 'play' || s.mode === 'paused';
  const hudVisible = inPlay || (s.shotMode && s.mode !== 'title');
  ui.hud.style.display = hudVisible ? 'block' : 'none';
  ui.health.style.width = Math.max(0, s.health) + '%';
  ui.armor.style.width = Math.max(0, s.armor) + '%';
  ui.cash.textContent = '$' + String(Math.max(0, s.cash)).padStart(7, '0');
  ui.stars.textContent = starString(s.wanted);
  ui.stars.style.color = s.wanted ? '#FFD700' : '#2A2A38';
  ui.stars.style.textShadow = s.wanted ? '0 0 10px rgba(255,215,0,.9)' : 'none';
  const car = s.player.inCar;
  ui.weapon.textContent = bottomRightLine(s, car);
  ui.speed.textContent = car ? mph(car.speed) + ' MPH' : '';
  renderWeaponSlots(s, ui, inPlay || !!s.shotMode);
  renderDispatchBoard(s, ui, inPlay || !!s.shotMode);
  if (ui.district) {
    const districtName = hudVisible ? districtAt(s.city, s.player.x, s.player.z) : '';
    if (ui.district._text !== districtName) { ui.district.textContent = districtName; ui.district._text = districtName; }
  }
  if (ui.respectfill) {
    const respect = s.respect || 0;
    ui.respectfill.style.width = Math.min(100, (respect % 300) / 3) + '%';
    ui.rank.textContent = 'RESPECT · ' + rankName(respect);
  }
  ui.banner.style.display = s.bannerT > 0 ? 'block' : 'none';
  ui.banner.textContent = s.banner || '';
  ui.banner.style.color = s.bannerColor || '#ff7b3c';
  ui.msg.style.display = s.msgT > 0 ? 'block' : 'none';
  ui.msg.textContent = s.msg || '';
  const currentJob = s.mission || s.taxi;
  ui.mission.textContent = inPlay && currentJob ? (currentJob.name || 'TAXI') + ' — ' + (currentJob.desc || 'Pick up and drop off.') : '';
  const m = s.mission, fare = s.taxi;
  const countdown = m && m.timer > 0 ? m.timer : fare && fare.timer;
  ui.timer.textContent = inPlay && countdown > 0 ? Math.ceil(countdown) + 's' : (m && m.idx === 4 && m.surviveT > 0 ? 'SURVIVE ' + Math.ceil(m.surviveT) + 's' : '');
  const bustInProgress = s.bustTimer > 0.15 && s.wanted > 0;
  ui.bustbar.style.display = bustInProgress ? 'block' : 'none';
  ui.bustfill.style.width = Math.min(100, s.bustTimer / 2.5 * 100) + '%';
  ui.prompt.textContent = inPlay ? contextualPrompt(s, nearCarFn, !!car) : '';
  ui.prompt.style.display = s.shotMode ? 'none' : 'block';
  if (ui.speedfx) {
    const speedNow = car ? Math.abs(car.speed || 0) : 0;
    ui.speedfx.style.opacity = String(Math.max(0, Math.min(1, (speedNow - 20) / 30)) * 0.9);
  }
  if (ui.ovFeat) {
    ui.ovFeat.style.display = s.mode === 'title' ? 'block' : 'none';
    if (s.mode === 'title') ui.ovFeat.textContent = '8 STORY MISSIONS · 5-STAR WANTED · HELICOPTER + ROADBLOCKS · 2 RADIO STATIONS · 4 WEAPONS · RESPECT RANKS · GARAGE UPGRADES';
  }
  if (ui.ovSave) {
    ui.ovSave.style.display = s.mode === 'title' ? 'block' : 'none';
    if (s.mode === 'title') {
      const weaponsOwned = WEAPON_ORDER.filter((w) => ownsWeapon(s, w)).length;
      ui.ovSave.textContent = s.missionIdx > 0
        ? 'CONTINUE — MISSIONS ' + s.missionIdx + '/8 · $' + s.cash + ' · RESPECT ' + rankName(s.respect || 0) + ' · ' + weaponsOwned + ' WEAPON' + (weaponsOwned === 1 ? '' : 'S')
        : 'NEW GAME — 8 MISSIONS AHEAD';
    }
  }
  const overlay = MODE_OVERLAYS[s.mode];
  if (overlay) {
    ui.overlay.style.display = 'flex';
    ui.ovTitle.textContent = overlay[0];
    ui.ovTitle.style.color = s.mode === 'busted' ? '#6ab0ff' : s.mode === 'wasted' ? '#ff5252' : '#ff8c42';
    ui.ovSub.textContent = s.mode === 'busted' ? 'Fine paid: $' + (s.fine || 0) + ' · Click to continue'
      : s.mode === 'wasted' ? 'Hospital bill $150 · Click to continue' : overlay[1];
  } else ui.overlay.style.display = 'none';
}
