// HUD (WO Task 12): DOM dashboard (cash ticker, gold stars, health/armor
// meters, LCD speedometer in MPH, ammo) + rotating circular minimap canvas.
import { roadCenters, CITY_HALF, districtAt } from './world.js';
import { WEAPONS, WEAPON_ORDER, ownsWeapon, activeWeapon } from './player.js';

export function mph(ms) { return Math.round(Math.abs(ms) * 2.23694); }

export function drawMinimap(s, mm) {
  const W = 168, cx = W / 2, cy = W / 2;
  const yaw = s.player.inCar ? s.player.inCar.ry : s.camYaw;
  mm.clearRect(0, 0, W, W);
  mm.save();
  mm.beginPath(); mm.arc(cx, cy, cx - 2, 0, 7); mm.clip();
  mm.fillStyle = '#ddd2b8'; mm.fillRect(0, 0, W, W);
  mm.translate(cx, cy);
  mm.rotate(-yaw);
  const scale = 0.55; // px per metre
  mm.scale(scale, scale);
  mm.translate(-s.player.x, -s.player.z);
  mm.strokeStyle = '#8a7f6d'; mm.lineWidth = 7;
  for (const c of roadCenters()) {
    mm.beginPath(); mm.moveTo(c, -CITY_HALF - 20); mm.lineTo(c, CITY_HALF + 20); mm.stroke();
    mm.beginPath(); mm.moveTo(-CITY_HALF - 20, c); mm.lineTo(CITY_HALF + 20, c); mm.stroke();
  }
  mm.lineWidth = 1;
  const dot = (x, z, col, r) => { mm.fillStyle = col; mm.beginPath(); mm.arc(x, z, r, 0, 7); mm.fill(); };
  const z = s.city.zones;
  dot(z.spray.x, z.spray.z, '#3dff7a', 4);
  dot(z.gunshop.x, z.gunshop.z, '#ff4040', 4);
  // hospital cross
  mm.fillStyle = '#ffffff';
  mm.fillRect(z.hospital.x - 4.5, z.hospital.z - 1.5, 9, 3);
  mm.fillRect(z.hospital.x - 1.5, z.hospital.z - 4.5, 3, 9);
  for (const c of s.cops) if (c.kind === 'cop') {
    if (c.roadblock) { mm.fillStyle = '#ff9020'; mm.fillRect(c.x - 4, c.z - 4, 8, 8); }
    else dot(c.x, c.z, Math.floor(s.time * 3) % 2 ? '#ff4040' : '#4080ff', 3.4);
  }
  if (s.heli) dot(s.heli.x, s.heli.z, '#ffffff', 3.2);
  for (const c of s.cars) if (c.kind === 'traffic') dot(c.x, c.z, '#c8c8c8', 1.8);
  for (const pk of s.pickups) dot(pk.x, pk.z, '#3dff7a', 3);
  const target = s.mission?.target || s.taxi?.target;
  if (target) dot(target.x, target.z, '#ffe14f', 4.6);
  mm.restore();
  // player arrow (fixed, pointing up = facing)
  mm.fillStyle = '#ffffff';
  mm.beginPath(); mm.moveTo(cx, cy - 6); mm.lineTo(cx - 4, cy + 5); mm.lineTo(cx + 4, cy + 5); mm.closePath(); mm.fill();
}

export function updateHUD(s, ui, nearCarFn) {
  const playing = s.mode === 'play' || s.mode === 'paused';
  ui.hud.style.display = (playing || (s.shotMode && s.mode !== 'title')) ? 'block' : 'none';
  ui.health.style.width = Math.max(0, s.health) + '%';
  ui.armor.style.width = Math.max(0, s.armor) + '%';
  ui.cash.textContent = '$' + String(Math.max(0, s.cash)).padStart(7, '0');
  let stars = '';
  for (let i = 0; i < 5; i++) stars += i < s.wanted ? '★' : '☆';
  ui.stars.textContent = stars;
  ui.stars.style.color = s.wanted ? '#FFD700' : '#2A2A38';
  ui.stars.style.textShadow = s.wanted ? '0 0 10px rgba(255,215,0,.9)' : 'none';
  const car = s.player.inCar;
  ui.weapon.textContent = car ? `GEAR ${car.gear === 0 ? 'R' : (car.gear == null ? 'N' : car.gear)} · ${car.isDrifting ? 'DRIFT!' : ''}${s.radio ? ` · RADIO ${s.radio === 1 ? 'VICE FM' : 'SOLMAR'}` : ''}`
    : (s.hasGun ? `${WEAPONS[activeWeapon(s)].label} ${s[WEAPONS[activeWeapon(s)].mag]} / ${s.reserve}` + (s.reloadT > 0 ? ' · RELOADING' : '') : 'UNARMED');
  // Weapon-slot chips: the whole arsenal, owned lit, current gold, locked dim.
  if (ui.slots) {
    const show = s.hasGun && (playing || s.shotMode);
    ui.slots.style.display = show ? 'flex' : 'none';
    if (show) {
      const html = WEAPON_ORDER.map((w, i) => {
        const owned = ownsWeapon(s, w), cur = activeWeapon(s) === w && !car;
        const st = cur ? 'border:1px solid #ffd94f;color:#ffd94f;background:rgba(30,22,4,.72)'
          : owned ? 'border:1px solid rgba(255,255,255,.5);color:#fff;background:rgba(10,6,16,.6)'
          : 'border:1px solid rgba(255,255,255,.18);color:rgba(255,255,255,.35);background:rgba(10,6,16,.45)';
        return `<div style="${st};border-radius:6px;padding:4px 8px;font-size:11.5px;font-weight:800;letter-spacing:1px;text-shadow:0 1px 0 #000">${i + 1} ${WEAPONS[w].short}</div>`;
      }).join('');
      if (ui.slots._h !== html) { ui.slots.innerHTML = html; ui.slots._h = html; }
    }
  }
  // SBPD dispatch board: who is coming for you, named like a real response.
  if (ui.dispatch) {
    const units = [];
    if (s.heli) units.push('▲ KESTREL-1 · AIR SUPPORT');
    for (const c of s.cops) {
      if (c.kind !== 'cop') continue;
      const d = Math.round(Math.hypot(c.x - s.player.x, c.z - s.player.z));
      units.push(c.roadblock ? `■ ROADBLOCK · ${d}m` : `${units.length % 2 ? '◆' : '●'} ${c.roadblock ? '' : (Math.abs(c.z - s.player.z) > Math.abs(c.x - s.player.x) ? 'PIT UNIT' : 'PATROL')} · ${d}m`);
    }
    const showD = s.wanted > 0 && (playing || s.shotMode) && units.length > 0;
    ui.dispatch.style.display = showD ? 'block' : 'none';
    if (showD) {
      const rows = units.slice(0, 5).join('<br>') + (units.length > 5 ? `<br>+${units.length - 5} more` : '');
      const html = `<span class="dhead">SBPD DISPATCH · ${units.length} UNITS</span><br>${rows}`;
      if (ui.dispatch._h !== html) { ui.dispatch.innerHTML = html; ui.dispatch._h = html; }
    }
  }
  // District label: where in the city you are right now.
  if (ui.district) {
    const dn = (playing || s.shotMode) ? districtAt(s.city, s.player.x, s.player.z) : '';
    if (ui.district._t !== dn) { ui.district.textContent = dn; ui.district._t = dn; }
  }
  if (ui.respectfill) {
    const r = s.respect || 0;
    ui.respectfill.style.width = Math.min(100, (r % 300) / 3) + '%';
    ui.rank.textContent = 'RESPECT · ' + (r >= 700 ? 'KINGPIN' : r >= 300 ? 'OPERATOR' : 'RUNNER');
  }
  ui.speed.textContent = car ? mph(car.speed) + ' MPH' : '';
  ui.banner.style.display = s.bannerT > 0 ? 'block' : 'none';
  ui.banner.textContent = s.banner || '';
  ui.banner.style.color = s.bannerColor || '#ff7b3c';
  ui.msg.style.display = s.msgT > 0 ? 'block' : 'none';
  ui.msg.textContent = s.msg || '';
  const m = s.mission, tx = s.taxi;
  const active = m || tx;
  ui.mission.textContent = (playing && active) ? `${active.name || 'TAXI'} — ${active.desc || 'Pick up and drop off.'}` : '';
  const timer = m?.timer > 0 ? m.timer : tx?.timer;
  ui.timer.textContent = (playing && timer > 0) ? Math.ceil(timer) + 's' : (m?.idx === 4 && m.surviveT > 0 ? 'SURVIVE ' + Math.ceil(m.surviveT) + 's' : '');
  const bust = s.bustTimer > 0.15 && s.wanted > 0;
  ui.bustbar.style.display = bust ? 'block' : 'none';
  ui.bustfill.style.width = Math.min(100, s.bustTimer / 2.5 * 100) + '%';
  let prompt = '';
  if (playing && !car) {
    if (nearCarFn()) prompt = 'F — STEAL / ENTER CAR';
    else {
      const zz = s.city.zones;
      const d2 = (a) => (s.player.x - a.x) ** 2 + (s.player.z - a.z) ** 2;
      if (d2(zz.gunshop) < zz.gunshop.r * zz.gunshop.r) {
        const next = WEAPON_ORDER.find(w => !ownsWeapon(s, w));
        prompt = next ? `AMMU-NATION — E BUY ${WEAPONS[next].label} $${WEAPONS[next].price}` : 'AMMU-NATION — E RESTOCKS AMMO';
      }
      else if (d2(zz.hospital) < zz.hospital.r * zz.hospital.r) prompt = 'HOSPITAL — HEALING…';
    }
  } else if (playing && car) {
    const zz = s.city.zones.spray;
    prompt = (s.player.x - zz.x) ** 2 + (s.player.z - zz.z) ** 2 < zz.r * zz.r
      ? "PAY 'N SPRAY — $100 CLEARS STARS" : 'F — EXIT CAR · T — TAXI JOB · SPACE — DRIFT';
  }
  ui.prompt.textContent = prompt;
  const ov = { title: ['VICE BLOCKS 3D', 'PRESS ANY KEY TO HIT THE STREETS'], paused: ['PAUSED', 'Click or press Enter to resume'],
    busted: ['BUSTED', ''], wasted: ['WASTED', ''] }[s.mode];
  if (ui.ovFeat) {
    ui.ovFeat.style.display = s.mode === 'title' ? 'block' : 'none';
    if (s.mode === 'title') ui.ovFeat.textContent = '8 STORY MISSIONS · 5-STAR WANTED · HELICOPTER + ROADBLOCKS · 2 RADIO STATIONS · 4 WEAPONS · RESPECT RANKS · GARAGE UPGRADES';
  }
  if (ui.ovSave) {
    ui.ovSave.style.display = s.mode === 'title' ? 'block' : 'none';
    if (s.mode === 'title') {
      const nw = WEAPON_ORDER.filter(w => ownsWeapon(s, w)).length;
      const rk = (s.respect || 0) >= 700 ? 'KINGPIN' : (s.respect || 0) >= 300 ? 'OPERATOR' : 'RUNNER';
      ui.ovSave.textContent = s.missionIdx > 0
        ? `CONTINUE — MISSIONS ${s.missionIdx}/8 · $${s.cash} · RESPECT ${rk} · ${nw} WEAPON${nw === 1 ? '' : 'S'}`
        : 'NEW GAME — 8 MISSIONS AHEAD';
    }
  }
  if (ov) {
    ui.overlay.style.display = 'flex';
    ui.ovTitle.textContent = ov[0];
    ui.ovTitle.style.color = s.mode === 'busted' ? '#6ab0ff' : s.mode === 'wasted' ? '#ff5252' : '#ff8c42';
    ui.ovSub.textContent = s.mode === 'busted' ? `Fine paid: $${s.fine || 0} · Click to continue`
      : s.mode === 'wasted' ? 'Hospital bill $150 · Click to continue' : ov[1];
  } else ui.overlay.style.display = 'none';
}
