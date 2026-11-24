// hud.js — everything drawn on top of the 3D view: the DOM dashboard
// (health and armour bars, cash, wanted stars, RESPECT rank, weapon
// line, speed, mission text, bust meter, contextual prompts), the SBPD
// dispatch board that names each responding unit, the weapon-slot
// chips, and the rotating circular minimap painted on a 2D canvas.
import { roadCenters, CITY_HALF, districtAt } from './world.js';
import { WEAPONS, WEAPON_ORDER, ownsWeapon, activeWeapon } from './player.js';

export function mph(ms) { return Math.round(Math.abs(ms) * 2.23694); }

const RANK_LADDER = [{ at: 700, name: 'KINGPIN' }, { at: 300, name: 'OPERATOR' }, { at: 0, name: 'RUNNER' }];
export function rankName(respect) {
  for (const tier of RANK_LADDER) if (respect >= tier.at) return tier.name;
  return 'RUNNER';
}

export function drawMinimap(s, mm) {
  const SIZE = 168, cx = SIZE / 2, cy = SIZE / 2;
  const heading = s.player.inCar ? s.player.inCar.ry : s.camYaw;
  mm.clearRect(0, 0, SIZE, SIZE);
  mm.save();
  mm.beginPath(); mm.arc(cx, cy, cx - 2, 0, 7); mm.clip();
  mm.fillStyle = '#ddd2b8'; mm.fillRect(0, 0, SIZE, SIZE);
  mm.translate(cx, cy); mm.rotate(-heading); mm.scale(0.55, 0.55);
  mm.translate(-s.player.x, -s.player.z);
  mm.strokeStyle = '#8a7f6d'; mm.lineWidth = 7;
  for (const c of roadCenters()) {
    mm.beginPath(); mm.moveTo(c, -CITY_HALF - 20); mm.lineTo(c, CITY_HALF + 20); mm.stroke();
    mm.beginPath(); mm.moveTo(-CITY_HALF - 20, c); mm.lineTo(CITY_HALF + 20, c); mm.stroke();
  }
  mm.lineWidth = 1;
  const dot = (x, z, color, r) => { mm.fillStyle = color; mm.beginPath(); mm.arc(x, z, r, 0, 7); mm.fill(); };
  const zoneSet = s.city.zones;
  dot(zoneSet.spray.x, zoneSet.spray.z, '#3dff7a', 4);
  dot(zoneSet.gunshop.x, zoneSet.gunshop.z, '#ff4040', 4);
  mm.fillStyle = '#ffffff';
  mm.fillRect(zoneSet.hospital.x - 4.5, zoneSet.hospital.z - 1.5, 9, 3);
  mm.fillRect(zoneSet.hospital.x - 1.5, zoneSet.hospital.z - 4.5, 3, 9);
  for (const cop of s.cops) {
    if (cop.kind !== 'cop') continue;
    if (cop.roadblock) { mm.fillStyle = '#ff9020'; mm.fillRect(cop.x - 4, cop.z - 4, 8, 8); }
    else dot(cop.x, cop.z, Math.floor(s.time * 3) % 2 ? '#ff4040' : '#4080ff', 3.4);
  }
  if (s.heli) dot(s.heli.x, s.heli.z, '#ffffff', 3.2);
  for (const car of s.cars) if (car.kind === 'traffic') dot(car.x, car.z, '#c8c8c8', 1.8);
  for (const pk of s.pickups) dot(pk.x, pk.z, '#3dff7a', 3);
  const goal = (s.mission && s.mission.target) || (s.taxi && s.taxi.target);
  if (goal) dot(goal.x, goal.z, '#ffe14f', 4.6);
  mm.restore();
  mm.fillStyle = '#ffffff';
  mm.beginPath(); mm.moveTo(cx, cy - 6); mm.lineTo(cx - 4, cy + 5); mm.lineTo(cx + 4, cy + 5); mm.closePath(); mm.fill();
}

function starsText(wanted) {
  let text = '';
  for (let i = 0; i < 5; i++) text += i < wanted ? '★' : '☆';
  return text;
}

function statusLine(s, car) {
  if (car) {
    const gearText = car.gear === 0 ? 'R' : (car.gear == null ? 'N' : car.gear);
    let line = 'GEAR ' + gearText + ' · ' + (car.isDrifting ? 'DRIFT!' : '');
    if (s.radio) line += ' · RADIO ' + (s.radio === 1 ? 'VICE FM' : 'SOLMAR');
    return line;
  }
  if (!s.hasGun) return 'UNARMED';
  const def = WEAPONS[activeWeapon(s)];
  let line = def.label + ' ' + s[def.mag] + ' / ' + s.reserve;
  if (s.reloadT > 0) line += ' · RELOADING';
  return line;
}

function paintWeaponSlots(s, ui, hudOn) {
  if (!ui.slots) return;
  const visible = s.hasGun && hudOn;
  ui.slots.style.display = visible ? 'flex' : 'none';
  if (!visible) return;
  const markup = WEAPON_ORDER.map((key, i) => {
    const owned = ownsWeapon(s, key);
    const equipped = activeWeapon(s) === key && !s.player.inCar;
    const chipCss = equipped
      ? 'border:1px solid #ffd94f;color:#ffd94f;background:rgba(30,22,4,.72)'
      : owned
        ? 'border:1px solid rgba(255,255,255,.5);color:#fff;background:rgba(10,6,16,.6)'
        : 'border:1px solid rgba(255,255,255,.18);color:rgba(255,255,255,.35);background:rgba(10,6,16,.45)';
    return '<div style="' + chipCss + ';border-radius:6px;padding:4px 8px;font-size:11.5px;font-weight:800;letter-spacing:1px;text-shadow:0 1px 0 #000">' + (i + 1) + ' ' + WEAPONS[key].short + '</div>';
  }).join('');
  if (ui.slots._html !== markup) { ui.slots.innerHTML = markup; ui.slots._html = markup; }
}

function paintDispatchBoard(s, ui, hudOn) {
  if (!ui.dispatch) return;
  const entries = [];
  if (s.heli) entries.push('▲ KESTREL-1 · AIR SUPPORT');
  for (const cop of s.cops) {
    if (cop.kind !== 'cop') continue;
    const range = Math.round(Math.hypot(cop.x - s.player.x, cop.z - s.player.z));
    if (cop.roadblock) entries.push('■ ROADBLOCK · ' + range + 'm');
    else {
      const role = Math.abs(cop.z - s.player.z) > Math.abs(cop.x - s.player.x) ? 'PIT UNIT' : 'PATROL';
      entries.push((entries.length % 2 ? '◆' : '●') + ' ' + role + ' · ' + range + 'm');
    }
  }
  const visible = s.wanted > 0 && hudOn && entries.length > 0;
  ui.dispatch.style.display = visible ? 'block' : 'none';
  if (!visible) return;
  const rows = entries.slice(0, 5).join('<br>') + (entries.length > 5 ? '<br>+' + (entries.length - 5) + ' more' : '');
  const markup = '<span class="dhead">SBPD DISPATCH · ' + entries.length + ' UNITS</span><br>' + rows;
  if (ui.dispatch._html !== markup) { ui.dispatch.innerHTML = markup; ui.dispatch._html = markup; }
}

function promptFor(s, nearCarFn, inCar) {
  const p = s.player;
  const distSq = (zone) => (p.x - zone.x) ** 2 + (p.z - zone.z) ** 2;
  if (!inCar) {
    if (nearCarFn()) return 'F — STEAL / ENTER CAR';
    const zoneSet = s.city.zones;
    if (distSq(zoneSet.gunshop) < zoneSet.gunshop.r * zoneSet.gunshop.r) {
      const nextUp = WEAPON_ORDER.find((w) => !ownsWeapon(s, w));
      return nextUp ? 'AMMU-NATION — E BUY ' + WEAPONS[nextUp].label + ' $' + WEAPONS[nextUp].price : 'AMMU-NATION — E RESTOCKS AMMO';
    }
    if (distSq(zoneSet.hospital) < zoneSet.hospital.r * zoneSet.hospital.r) return 'HOSPITAL — HEALING…';
    return '';
  }
  const spray = s.city.zones.spray;
  return distSq(spray) < spray.r * spray.r ? "PAY 'N SPRAY — $100 CLEARS STARS" : 'F — EXIT CAR · T — TAXI JOB · SPACE — DRIFT';
}

const OVERLAY_TEXT = {
  title: ['VICE BLOCKS 3D', 'PRESS ANY KEY TO HIT THE STREETS'],
  paused: ['PAUSED', 'Click or press Enter to resume'],
  busted: ['BUSTED', ''],
  wasted: ['WASTED', ''],
};

export function updateHUD(s, ui, nearCarFn) {
  const playing = s.mode === 'play' || s.mode === 'paused';
  const hudOn = playing || (s.shotMode && s.mode !== 'title');
  ui.hud.style.display = hudOn ? 'block' : 'none';
  ui.health.style.width = Math.max(0, s.health) + '%';
  ui.armor.style.width = Math.max(0, s.armor) + '%';
  ui.cash.textContent = '$' + String(Math.max(0, s.cash)).padStart(7, '0');
  ui.stars.textContent = starsText(s.wanted);
  ui.stars.style.color = s.wanted ? '#FFD700' : '#2A2A38';
  ui.stars.style.textShadow = s.wanted ? '0 0 10px rgba(255,215,0,.9)' : 'none';
  const car = s.player.inCar;
  ui.weapon.textContent = statusLine(s, car);
  ui.speed.textContent = car ? mph(car.speed) + ' MPH' : '';
  paintWeaponSlots(s, ui, playing || !!s.shotMode);
  paintDispatchBoard(s, ui, playing || !!s.shotMode);
  if (ui.district) {
    const name = hudOn ? districtAt(s.city, s.player.x, s.player.z) : '';
    if (ui.district._text !== name) { ui.district.textContent = name; ui.district._text = name; }
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
  const job = s.mission || s.taxi;
  ui.mission.textContent = playing && job ? (job.name || 'TAXI') + ' — ' + (job.desc || 'Pick up and drop off.') : '';
  const m = s.mission, fare = s.taxi;
  const clock = m && m.timer > 0 ? m.timer : fare && fare.timer;
  ui.timer.textContent = playing && clock > 0 ? Math.ceil(clock) + 's' : (m && m.idx === 4 && m.surviveT > 0 ? 'SURVIVE ' + Math.ceil(m.surviveT) + 's' : '');
  const busting = s.bustTimer > 0.15 && s.wanted > 0;
  ui.bustbar.style.display = busting ? 'block' : 'none';
  ui.bustfill.style.width = Math.min(100, s.bustTimer / 2.5 * 100) + '%';
  ui.prompt.textContent = playing ? promptFor(s, nearCarFn, !!car) : '';
  ui.prompt.style.display = s.shotMode ? 'none' : 'block';
  if (ui.speedfx) {
    const speedMag = car ? Math.abs(car.speed || 0) : 0;
    ui.speedfx.style.opacity = String(Math.max(0, Math.min(1, (speedMag - 20) / 30)) * 0.9);
  }
  if (ui.ovFeat) {
    ui.ovFeat.style.display = s.mode === 'title' ? 'block' : 'none';
    if (s.mode === 'title') ui.ovFeat.textContent = '8 STORY MISSIONS · 5-STAR WANTED · HELICOPTER + ROADBLOCKS · 2 RADIO STATIONS · 4 WEAPONS · RESPECT RANKS · GARAGE UPGRADES';
  }
  if (ui.ovSave) {
    ui.ovSave.style.display = s.mode === 'title' ? 'block' : 'none';
    if (s.mode === 'title') {
      const ownedCount = WEAPON_ORDER.filter((w) => ownsWeapon(s, w)).length;
      ui.ovSave.textContent = s.missionIdx > 0
        ? 'CONTINUE — MISSIONS ' + s.missionIdx + '/8 · $' + s.cash + ' · RESPECT ' + rankName(s.respect || 0) + ' · ' + ownedCount + ' WEAPON' + (ownedCount === 1 ? '' : 'S')
        : 'NEW GAME — 8 MISSIONS AHEAD';
    }
  }
  const overlay = OVERLAY_TEXT[s.mode];
  if (overlay) {
    ui.overlay.style.display = 'flex';
    ui.ovTitle.textContent = overlay[0];
    ui.ovTitle.style.color = s.mode === 'busted' ? '#6ab0ff' : s.mode === 'wasted' ? '#ff5252' : '#ff8c42';
    ui.ovSub.textContent = s.mode === 'busted' ? 'Fine paid: $' + (s.fine || 0) + ' · Click to continue'
      : s.mode === 'wasted' ? 'Hospital bill $150 · Click to continue' : overlay[1];
  } else ui.overlay.style.display = 'none';
}
