// hud.js — everything drawn over the 3D view: the DOM dashboard
// (health and armour bars, cash, wanted stars, the RESPECT rank,
// weapon line, speed, mission text, bust meter, prompts), the SBPD
// dispatch board that names every responding unit, the weapon-slot
// chips, and the rotating circular minimap painted on a 2D canvas.
import { roadCenters, CITY_HALF, districtAt } from './world.js';
import { WEAPONS, WEAPON_ORDER, ownsWeapon, activeWeapon } from './player.js';

export function mph(ms) {
  return Math.round(Math.abs(ms) * 2.23694);
}

const RANK_THRESHOLDS = [
  { at: 700, name: 'KINGPIN' },
  { at: 300, name: 'OPERATOR' },
  { at: 0, name: 'RUNNER' },
];
export function rankName(respect) {
  for (const r of RANK_THRESHOLDS) {
    if (respect >= r.at) return r.name;
  }
  return 'RUNNER';
}

// ---------------------------------------------------------------- minimap
export function drawMinimap(s, mm) {
  const SIZE = 168;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const yaw = s.player.inCar ? s.player.inCar.ry : s.camYaw;
  mm.clearRect(0, 0, SIZE, SIZE);
  mm.save();
  mm.beginPath();
  mm.arc(cx, cy, cx - 2, 0, 7);
  mm.clip();
  mm.fillStyle = '#ddd2b8';
  mm.fillRect(0, 0, SIZE, SIZE);
  mm.translate(cx, cy);
  mm.rotate(-yaw);
  mm.scale(0.55, 0.55); // pixels per metre
  mm.translate(-s.player.x, -s.player.z);

  mm.strokeStyle = '#8a7f6d';
  mm.lineWidth = 7;
  for (const c of roadCenters()) {
    mm.beginPath(); mm.moveTo(c, -CITY_HALF - 20); mm.lineTo(c, CITY_HALF + 20); mm.stroke();
    mm.beginPath(); mm.moveTo(-CITY_HALF - 20, c); mm.lineTo(CITY_HALF + 20, c); mm.stroke();
  }
  mm.lineWidth = 1;
  const dot = (x, z, color, r) => {
    mm.fillStyle = color;
    mm.beginPath();
    mm.arc(x, z, r, 0, 7);
    mm.fill();
  };
  const zones = s.city.zones;
  dot(zones.spray.x, zones.spray.z, '#3dff7a', 4);
  dot(zones.gunshop.x, zones.gunshop.z, '#ff4040', 4);
  mm.fillStyle = '#ffffff';
  mm.fillRect(zones.hospital.x - 4.5, zones.hospital.z - 1.5, 9, 3);
  mm.fillRect(zones.hospital.x - 1.5, zones.hospital.z - 4.5, 3, 9);
  for (const cop of s.cops) {
    if (cop.kind !== 'cop') continue;
    if (cop.roadblock) {
      mm.fillStyle = '#ff9020';
      mm.fillRect(cop.x - 4, cop.z - 4, 8, 8);
    } else {
      dot(cop.x, cop.z, Math.floor(s.time * 3) % 2 ? '#ff4040' : '#4080ff', 3.4);
    }
  }
  if (s.heli) dot(s.heli.x, s.heli.z, '#ffffff', 3.2);
  for (const car of s.cars) if (car.kind === 'traffic') dot(car.x, car.z, '#c8c8c8', 1.8);
  for (const pk of s.pickups) dot(pk.x, pk.z, '#3dff7a', 3);
  const target = (s.mission && s.mission.target) || (s.taxi && s.taxi.target);
  if (target) dot(target.x, target.z, '#ffe14f', 4.6);
  mm.restore();

  // Player arrow, fixed at the centre, pointing the way the view faces.
  mm.fillStyle = '#ffffff';
  mm.beginPath();
  mm.moveTo(cx, cy - 6);
  mm.lineTo(cx - 4, cy + 5);
  mm.lineTo(cx + 4, cy + 5);
  mm.closePath();
  mm.fill();
}

// ------------------------------------------------------------------- HUD
function starString(wanted) {
  let out = '';
  for (let i = 0; i < 5; i++) out += i < wanted ? '★' : '☆';
  return out;
}

function weaponLine(s, car) {
  if (car) {
    const gear = car.gear === 0 ? 'R' : (car.gear == null ? 'N' : car.gear);
    let line = 'GEAR ' + gear + ' · ' + (car.isDrifting ? 'DRIFT!' : '');
    if (s.radio) line += ' · RADIO ' + (s.radio === 1 ? 'VICE FM' : 'SOLMAR');
    return line;
  }
  if (!s.hasGun) return 'UNARMED';
  const def = WEAPONS[activeWeapon(s)];
  let line = def.label + ' ' + s[def.mag] + ' / ' + s.reserve;
  if (s.reloadT > 0) line += ' · RELOADING';
  return line;
}

function renderSlots(s, ui, visible) {
  if (!ui.slots) return;
  const show = s.hasGun && visible;
  ui.slots.style.display = show ? 'flex' : 'none';
  if (!show) return;
  const html = WEAPON_ORDER.map((key, i) => {
    const owned = ownsWeapon(s, key);
    const current = activeWeapon(s) === key && !s.player.inCar;
    const style = current
      ? 'border:1px solid #ffd94f;color:#ffd94f;background:rgba(30,22,4,.72)'
      : owned
        ? 'border:1px solid rgba(255,255,255,.5);color:#fff;background:rgba(10,6,16,.6)'
        : 'border:1px solid rgba(255,255,255,.18);color:rgba(255,255,255,.35);background:rgba(10,6,16,.45)';
    return '<div style="' + style + ';border-radius:6px;padding:4px 8px;font-size:11.5px;font-weight:800;letter-spacing:1px;text-shadow:0 1px 0 #000">'
      + (i + 1) + ' ' + WEAPONS[key].short + '</div>';
  }).join('');
  if (ui.slots._html !== html) {
    ui.slots.innerHTML = html;
    ui.slots._html = html;
  }
}

function renderDispatch(s, ui, visible) {
  if (!ui.dispatch) return;
  const units = [];
  if (s.heli) units.push('▲ KESTREL-1 · AIR SUPPORT');
  for (const cop of s.cops) {
    if (cop.kind !== 'cop') continue;
    const dist = Math.round(Math.hypot(cop.x - s.player.x, cop.z - s.player.z));
    if (cop.roadblock) {
      units.push('■ ROADBLOCK · ' + dist + 'm');
    } else {
      const role = Math.abs(cop.z - s.player.z) > Math.abs(cop.x - s.player.x)
        ? 'PIT UNIT' : 'PATROL';
      units.push((units.length % 2 ? '◆' : '●') + ' ' + role + ' · ' + dist + 'm');
    }
  }
  const show = s.wanted > 0 && visible && units.length > 0;
  ui.dispatch.style.display = show ? 'block' : 'none';
  if (!show) return;
  const rows = units.slice(0, 5).join('<br>')
    + (units.length > 5 ? '<br>+' + (units.length - 5) + ' more' : '');
  const html = '<span class="dhead">SBPD DISPATCH · ' + units.length + ' UNITS</span><br>' + rows;
  if (ui.dispatch._html !== html) {
    ui.dispatch.innerHTML = html;
    ui.dispatch._html = html;
  }
}

function computePrompt(s, nearCarFn, inCarNow) {
  const p = s.player;
  const distTo = (zone) => (p.x - zone.x) ** 2 + (p.z - zone.z) ** 2;
  if (!inCarNow) {
    if (nearCarFn()) return 'F — STEAL / ENTER CAR';
    const zones = s.city.zones;
    if (distTo(zones.gunshop) < zones.gunshop.r * zones.gunshop.r) {
      const next = WEAPON_ORDER.find((w) => !ownsWeapon(s, w));
      return next
        ? 'AMMU-NATION — E BUY ' + WEAPONS[next].label + ' $' + WEAPONS[next].price
        : 'AMMU-NATION — E RESTOCKS AMMO';
    }
    if (distTo(zones.hospital) < zones.hospital.r * zones.hospital.r) {
      return 'HOSPITAL — HEALING…';
    }
    return '';
  }
  const spray = s.city.zones.spray;
  return distTo(spray) < spray.r * spray.r
    ? "PAY 'N SPRAY — $100 CLEARS STARS"
    : 'F — EXIT CAR · T — TAXI JOB · SPACE — DRIFT';
}

const OVERLAY_TEXT = {
  title: ['VICE BLOCKS 3D', 'PRESS ANY KEY TO HIT THE STREETS'],
  paused: ['PAUSED', 'Click or press Enter to resume'],
  busted: ['BUSTED', ''],
  wasted: ['WASTED', ''],
};

export function updateHUD(s, ui, nearCarFn) {
  const playing = s.mode === 'play' || s.mode === 'paused';
  const visible = playing || (s.shotMode && s.mode !== 'title');
  ui.hud.style.display = visible ? 'block' : 'none';

  ui.health.style.width = Math.max(0, s.health) + '%';
  ui.armor.style.width = Math.max(0, s.armor) + '%';
  ui.cash.textContent = '$' + String(Math.max(0, s.cash)).padStart(7, '0');
  ui.stars.textContent = starString(s.wanted);
  ui.stars.style.color = s.wanted ? '#FFD700' : '#2A2A38';
  ui.stars.style.textShadow = s.wanted ? '0 0 10px rgba(255,215,0,.9)' : 'none';

  const car = s.player.inCar;
  ui.weapon.textContent = weaponLine(s, car);
  ui.speed.textContent = car ? mph(car.speed) + ' MPH' : '';

  renderSlots(s, ui, playing || !!s.shotMode);
  renderDispatch(s, ui, playing || !!s.shotMode);

  if (ui.district) {
    const name = visible ? districtAt(s.city, s.player.x, s.player.z) : '';
    if (ui.district._text !== name) {
      ui.district.textContent = name;
      ui.district._text = name;
    }
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

  const active = s.mission || s.taxi;
  ui.mission.textContent = playing && active
    ? (active.name || 'TAXI') + ' — ' + (active.desc || 'Pick up and drop off.')
    : '';
  const m = s.mission;
  const tx = s.taxi;
  const timer = m && m.timer > 0 ? m.timer : tx && tx.timer;
  ui.timer.textContent = playing && timer > 0
    ? Math.ceil(timer) + 's'
    : (m && m.idx === 4 && m.surviveT > 0 ? 'SURVIVE ' + Math.ceil(m.surviveT) + 's' : '');

  const busting = s.bustTimer > 0.15 && s.wanted > 0;
  ui.bustbar.style.display = busting ? 'block' : 'none';
  ui.bustfill.style.width = Math.min(100, s.bustTimer / 2.5 * 100) + '%';

  ui.prompt.textContent = playing ? computePrompt(s, nearCarFn, !!car) : '';
  ui.prompt.style.display = s.shotMode ? 'none' : 'block';

  if (ui.speedfx) {
    const spd = car ? Math.abs(car.speed || 0) : 0;
    ui.speedfx.style.opacity = String(Math.max(0, Math.min(1, (spd - 20) / 30)) * 0.9);
  }

  // Title / pause / busted / wasted overlay, plus the title screen's
  // feature strip and save summary line.
  if (ui.ovFeat) {
    ui.ovFeat.style.display = s.mode === 'title' ? 'block' : 'none';
    if (s.mode === 'title') {
      ui.ovFeat.textContent = '8 STORY MISSIONS · 5-STAR WANTED · HELICOPTER + ROADBLOCKS · 2 RADIO STATIONS · 4 WEAPONS · RESPECT RANKS · GARAGE UPGRADES';
    }
  }
  if (ui.ovSave) {
    ui.ovSave.style.display = s.mode === 'title' ? 'block' : 'none';
    if (s.mode === 'title') {
      const weaponCount = WEAPON_ORDER.filter((w) => ownsWeapon(s, w)).length;
      ui.ovSave.textContent = s.missionIdx > 0
        ? 'CONTINUE — MISSIONS ' + s.missionIdx + '/8 · $' + s.cash + ' · RESPECT ' + rankName(s.respect || 0)
          + ' · ' + weaponCount + ' WEAPON' + (weaponCount === 1 ? '' : 'S')
        : 'NEW GAME — 8 MISSIONS AHEAD';
    }
  }
  const overlay = OVERLAY_TEXT[s.mode];
  if (overlay) {
    ui.overlay.style.display = 'flex';
    ui.ovTitle.textContent = overlay[0];
    ui.ovTitle.style.color = s.mode === 'busted' ? '#6ab0ff'
      : s.mode === 'wasted' ? '#ff5252' : '#ff8c42';
    ui.ovSub.textContent = s.mode === 'busted'
      ? 'Fine paid: $' + (s.fine || 0) + ' · Click to continue'
      : s.mode === 'wasted'
        ? 'Hospital bill $150 · Click to continue'
        : overlay[1];
  } else {
    ui.overlay.style.display = 'none';
  }
}
