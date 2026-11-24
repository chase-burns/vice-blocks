# vice-blocks

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/chase-burns/vice-blocks/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/chase-burns/vice-blocks/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Vice Blocks 3D is a first-person open-world crime game for a desktop browser that needs no network at all once loaded. You drive from the driver's seat — steering wheel turning with your hands, two gauges alive behind it, hood visible past the dash — and you walk and shoot in first person too, in a pastel coastal city caught at dusk: Art Deco towers, palm avenues, sand and turquoise water down the east flank. The campaign is eight story missions in a chain: steal a beachfront coupe, run couriers against the clock, buy a pistol and shoot the range, rob a rival at the harbour, survive four stars, race a midnight circuit, smash through a roadblock run, and deliver one last package quietly at night. Taxi fares fill the gaps forever. The police work on five stars: patrols chase, ram and fill a bust meter when you stall, four stars angles roadblocks across your road, and five stars sends KESTREL-1, a helicopter whose spotlight will not let go. Wrecks smoke, catch fire, blow up, and the blast can start the next wreck burning. What you earn — cash and RESPECT, from Runner through Operator to Kingpin — buys four weapons in sequence at Ammu-Nation and armour and engine upgrades at the Pay 'n Spray. Two radio stations are synthesised note by note while you drive a bicycle-model chassis with a real gearbox, Pacejka tyres, handbrake drifts and a cockpit camera that shakes with trauma. The renderer is hand-written WebGL: no libraries, no build step, no downloads. Serve `game/` from any static host, play with keyboard and mouse, and your progress stays in localStorage.

## Features

- **First person, driving and shooting** — a cockpit with input-synced wheel, live dash gauges, mirror, A-pillars, speed-sensitive FOV, drift smoke and skid marks; on foot, aim and reload gunplay with a viewmodel, muzzle flash and tracer per weapon
- **8 story missions plus endless taxi work** — theft, checkpoint couriers, a harbour holdup, a four-star survival escape, a grand prix, a roadblock run and a stealth night courier
- **Five-star wanted system** — crimes need a witness and wait out a dispatch delay; pursuit units ram and bust, four-star roadblocks are breakable, five stars brings the spotlight helicopter; the **SBPD dispatch board** narrates it all, naming patrols, PIT units, roadblocks and KESTREL-1 with live distances
- **Burn, explode, chain** — damaged cars smoke, ignite and detonate with radial damage that can set neighbouring cars off in turn
- **Four weapons, bought in a chain** — pistol, full-auto SMG, six-pellet pump shotgun and assault rifle, each with its own magazine, fire rate, spread and damage, at Ammu-Nation for $300/$600/$800/$1000, switched on keys 1–4 and shown as HUD slot chips
- **RESPECT ranks** — Runner → Operator → Kingpin, earned from missions and clean getaways
- **Pay 'n Spray** — $100 resprays the car, repairs it and clears your stars; the same garage fits +50% hull armour and a +15% engine tune
- **Two procedural radio stations** — Vice FM and Solmar, sequenced live in WebAudio next to an engine note that tracks RPM, tyre screech, sirens and gunfire
- **A city that is awake** — lane-following traffic in sport, sedan, taxi and police bodies; pedestrians who stroll, cross, flee and can be robbed at gunpoint; six named districts on the HUD (Downtown, Ocean Drive, Solmar Bay, Palm Heights, North Beach, The Harbor); a rotating minimap with cops, roadblocks, the helicopter and mission markers

## Run it

```sh
node serve.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=chase-burns&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
