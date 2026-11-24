# vice-blocks

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/chase-burns/vice-blocks/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/chase-burns/vice-blocks/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Vice Blocks 3D is a first-person open-world crime game that runs entirely offline in a desktop browser. You see the city the way the driver does — through the windshield, over a steering wheel that turns with your input, past a pair of live gauges — or on foot, gun in hand, in a pastel coastal city at dusk: Art Deco towers, palm-lined avenues, a beach and turquoise water on the east flank. The story is an eight-mission chain (a beachfront car theft, timed courier runs, a gun-store errand, a harbor holdup, a four-star survival escape, a midnight grand prix, a roadblock run, a stealth courier), with endless taxi fares on the side. The law answers on a five-star wanted system: patrols chase, ram and bust you, four stars puts angled roadblocks across your road, and five stars brings a helicopter whose spotlight stays locked on you. Wrecks smoke, burn and explode, and can chain into the car next to them. Money and RESPECT (Runner, then Operator, then Kingpin) buy a four-weapon arsenal at Ammu-Nation and armour and engine work at the Pay 'n Spray, and two procedurally synthesised radio stations play over a bicycle-model chassis with a real gearbox, Pacejka tyres, handbrake drifts and a trauma-shaken cockpit camera. The engine is hand-written WebGL — no libraries, no build step, no network. Serve the `game/` folder with any static server and play with keyboard and mouse. Progress persists in localStorage.

## Features

- **First-person driving and gunplay** — a full cockpit (steering wheel synced to input, working dash gauges, mirror, A-pillars, speed-sensitive FOV, drift smoke, skid marks) and on-foot aim/reload gunplay with per-weapon viewmodels, muzzle flash and tracers
- **8 story missions plus endless taxi jobs** — theft, checkpoint couriers, a rival-deal holdup, a 4-star survival escape, a grand prix, a roadblock run and a stealth night courier
- **5-star wanted system** — witnessed crimes with a dispatch delay, PIT-style pursuit, a bust meter, breakable 4-star roadblocks and a 5-star spotlight helicopter, all narrated live by the **SBPD dispatch board**, which names every responding unit (patrols, PIT units, roadblocks, and the KESTREL-1 air unit) with distances
- **Burn-and-explode chain** — damaged cars smoke, catch fire and detonate with radial damage that can set off their neighbours
- **Four weapons** — pistol, full-auto SMG, pump shotgun (six pellets per shell) and assault rifle, each with its own magazine, cadence, spread and damage, bought in a chain at Ammu-Nation, switched on keys 1–4, and shown as HUD slot chips
- **RESPECT ranks** — Runner → Operator → Kingpin, earned from missions and clean getaways
- **Pay 'n Spray** — a $100 respray clears your stars and repairs the car; the same shop fits armour (+50% hull) and an engine tune (+15% power)
- **Two radio stations** — Vice FM and Solmar, sequenced live in WebAudio alongside the RPM-tracking engine note, tyre screech, sirens and gunfire
- **A living city** — lane-following traffic in four body styles (sport, sedan, taxi, police), pedestrians who stroll, cross, flee and can be robbed at gunpoint, six named districts on the HUD (Downtown, Ocean Drive, Solmar Bay, Palm Heights, North Beach, The Harbor), and a rotating minimap with cops, roadblocks, the helicopter and mission markers

## Run it

```sh
node serve.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=chase-burns&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
