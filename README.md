# vice-blocks

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/chase-burns/vice-blocks/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/chase-burns/vice-blocks/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Vice Blocks 3D is a real-3D, first-person open-world crime game that plays offline in a desktop browser, built by an AI agent for make.fun's "Make GTA 6" bounty. See the city through the windshield — steering wheel, working gauges and all — or on foot with a gun in hand, in a pastel Miami-dusk coastal city of palms, towers and beachfront. Work an eight-mission story chain, run endless taxi fares, and survive a five-star wanted system: police chase, ram and bust you, throw up roadblocks at four stars, and put a spotlight helicopter over you at five. Cars burn and explode, taking nearby wrecks with them. Earn cash and RESPECT (Runner → Operator → Kingpin), spend it at Ammu-Nation and the Pay 'n Spray — which also fits armour and engine upgrades — and cruise to two procedural radio stations while a bicycle-model chassis, a real gearbox and Pacejka tyres, drifting and a trauma-shake cockpit camera keeps the driving honest. The 3D engine is hand-written WebGL with no libraries and no network: serve game/ with any static server and play with keyboard and mouse. Progress saves in localStorage.

## Features

- **First-person everything** — cockpit driving (steering wheel synced to your input, live dash gauges, FOV punch, drift smoke and skid marks) and on-foot gunplay with aim/reload
- **8 story missions** — car theft, checkpoint couriers, a rival-deal holdup, a 4-star survival escape, a midnight grand prix, a roadblock run and a stealth night courier — plus endless taxi jobs
- **5-star wanted system** — witness-based star gain, dispatch delay, PIT chases, bust meter, breakable 4-star roadblocks (marked on the minimap) and a 5-star police helicopter with a player-locked spotlight — all narrated live by the **SBPD dispatch board** on the HUD, which names every responding unit (patrol, PIT, roadblock, and the KESTREL-1 air unit)
- **Burn-and-explode vehicle chain** — wrecks smoke, burn and detonate with radial damage
- **Four weapons** — pistol, full-auto SMG, pump shotgun (6-pellet spread) and assault rifle, each with its own magazine, cadence and damage model, bought in a chain at Ammu-Nation and switched on keys 1–4, with the full arsenal shown as HUD slot chips
- **RESPECT ranks** — Runner / Operator / Kingpin, earned from missions and clean getaways
- **Pay 'n Spray garage upgrades** — armour (+50% hull) and engine (+15% power), on top of the classic $100 star-clearing respray
- **Two procedural radio stations** — Vice FM and Solmar, synthesised live in WebAudio alongside engine, siren and gunshot sound
- **A living city** — lane-following traffic, fleeing pedestrians, four modelled car styles (sport / sedan / taxi / police), pastel dusk lighting, named districts on the HUD (Downtown, Ocean Drive, Solmar Bay, Palm Heights, North Beach, The Harbor), minimap with cops, roadblocks, heli and mission markers

## Run it

```sh
node serve.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=chase-burns&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
