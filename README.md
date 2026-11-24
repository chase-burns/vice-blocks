# vice-blocks

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/chase-burns/vice-blocks/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/chase-burns/vice-blocks/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Vice Blocks 3D runs completely offline in a desktop browser and puts you in first person inside a pastel coastal city at dusk. Driving means looking over a turning steering wheel and two live gauges through the windshield; on foot you carry a visible weapon. Art Deco blocks, palms, a beach and turquoise sea fill the east side. Eight linked story jobs form the campaign — stealing a beachfront car, courier runs against the clock, collecting a gun, holding up a harbour deal, surviving at four stars, a midnight race, a roadblock run and a quiet night delivery — and taxi fares never run out. Police answer through five wanted stars: patrols pursue, ram and build a bust meter, angled roadblocks appear at four stars, and at five a helicopter keeps its spotlight on the player. Damaged vehicles smoke, burn, explode and may ignite neighbours. Cash and RESPECT — Runner, Operator, then Kingpin — unlock four weapons at Ammu-Nation plus armour and engine work at the Pay 'n Spray. Two radio stations are synthesised live while a bicycle-model car with a gearbox, Pacejka tyres, handbrake slides and a trauma-shaken cockpit camera does the driving. All rendering is hand-written WebGL with no libraries, no build and no network calls. Host the `game/` directory statically and play with keyboard and mouse; progress is kept in localStorage.

## Features

- **First-person on wheels and on foot** — cockpit wheel matched to steering input, working gauges, mirror, A-pillars, speed FOV, drift smoke and skid marks, plus aim/reload gunplay with viewmodels, flashes and tracers for each weapon
- **8 missions and endless taxis** — theft, checkpoint couriers, a rival holdup, four-star survival, a grand prix, a roadblock run and a stealth courier
- **Five-star law response** — witnessed crime with dispatch delay, PIT pursuit and bust pressure, breakable four-star roadblocks and a five-star spotlight helicopter, narrated by the **SBPD dispatch board** naming patrols, PIT units, roadblocks and the KESTREL-1 air unit with distances
- **Fire and explosion chains** — wrecks smoke, catch fire and detonate, dealing radial harm that can start the next car burning
- **Four-gun arsenal** — pistol, automatic SMG, pump shotgun firing six pellets, and assault rifle; distinct magazines, cadence, spread and damage, bought in sequence at Ammu-Nation, selected with keys 1–4 and displayed as HUD chips
- **RESPECT ladder** — Runner → Operator → Kingpin from missions and clean escapes
- **Pay 'n Spray** — $100 buys a respray, star clearance and repairs; the shop also sells +50% hull armour and a +15% engine tune
- **Two stations** — Vice FM and Solmar are sequenced in WebAudio beside an RPM-following engine tone, tyre screech, sirens and shots
- **Living districts** — traffic follows lanes in sport, sedan, taxi and police bodies; pedestrians walk, cross, flee and can be robbed; six districts are named on the HUD (Downtown, Ocean Drive, Solmar Bay, Palm Heights, North Beach, The Harbor); a rotating minimap marks police, roadblocks, the helicopter and objectives

## Run it

```sh
node serve.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=chase-burns&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
