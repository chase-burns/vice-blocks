# vice-blocks

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/chase-burns/vice-blocks/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/chase-burns/vice-blocks/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Vice Blocks 3D is a first-person open-world crime game that runs entirely in a desktop browser. Everything is hand-written WebGL — no libraries, no build step, no downloads, no network calls once the page is loaded. You live in a pastel Art Deco city on the coast: tower blocks in peach, mint and powder blue, palm avenues, a sand strip and turquoise water down the eastern edge, and six named districts from Downtown to the Harbor.

You play two ways. On foot it is a first-person shooter with four purchasable weapons, pedestrians who stroll, flee or put their hands up, and wallets that can be lifted at gunpoint. Behind the wheel it is a proper cockpit game: you sit in the driver's seat with a steering wheel that turns as you steer, a live gauge cluster behind it, a rear-view mirror, A-pillars, and the car's bonnet stretching out past the dash. The chassis underneath is a bicycle model with Pacejka-style tyres, a five-speed gearbox, handbrake drifts, skid marks and tyre smoke.

The campaign is a chain of eight story missions — stealing a beach coupe, courier runs against the clock, a shooting-range test, a harbour shakedown, a four-star survival escape, a midnight grand prix, a roadblock run, and a $20,000 finale — with repeatable taxi fares in between. The law answers on a five-star scale: patrols hunt you down and fill a bust meter when you stall, four stars angles roadblocks across your road, and five stars sends up KESTREL-1, a helicopter whose spotlight pins you to the street. The SBPD dispatch board on the HUD narrates every unit as it joins the chase. Wrecks smoke, catch fire and explode, and an explosion can set the next car burning. Cash and RESPECT (Runner, then Operator, then Kingpin) buy the weapon chain at Ammu-Nation and armour and engine upgrades at the Pay 'n Spray, which also launders your wanted level for $100. Two radio stations are synthesised note by note in WebAudio next to an engine note that follows the rev counter. Progress persists in localStorage.

## How to play

Start a job at the glowing **contact** marker (press **E**), or press **T** anywhere for taxi work. Drive with **WASD** or the arrow keys, **Space** for the handbrake, and **F** to get in and out of cars — any car, including police cars, if you are feeling brave. On foot, hold the **right mouse button** to aim and click to shoot; **R** reloads, keys **1–4** swap weapons, and **Shift** runs. In a car, **R** cycles the radio instead. Watch the stars at the top right: the more lit, the heavier the response, so break line of sight and let the heat cool, or dive into a Pay 'n Spray. The minimap (bottom left) rotates with you and shows the mission marker in gold, patrols in red and roadblocks in orange. Money talks: the gunshop sells the pistol, SMG, shotgun and rifle in that order for $300/$600/$800/$1000, and the Pay 'n Spray fits hull armour for $400 and an engine tune for $500 once your paint is clean.

## Features

- **First-person driving and shooting** — input-synced steering wheel, live dash gauges, mirror, speed-sensitive FOV, drift smoke and skid marks; on foot, aim-down-sights gunplay with a per-weapon viewmodel, muzzle flash and tracer
- **8 story missions plus endless taxi work** — theft, checkpoint couriers, range targets, a harbour holdup, a four-star survival escape, a grand prix, a roadblock run and the $20,000 Rival Deal
- **Five-star wanted system** — witnessed crimes, patrol pursuit with rams and a bust meter, breakable four-star roadblocks, and the five-star spotlight helicopter; the **SBPD dispatch board** lists every unit with live distances
- **Burn, explode, chain** — damaged cars smoke, ignite and detonate, and the blast damages whatever is parked too close
- **Four weapons, bought in a chain** — pistol, full-auto SMG, pump shotgun and assault rifle at Ammu-Nation for $300/$600/$800/$1000, each with its own magazine, reserve, fire rate and spread, shown as HUD slot chips
- **RESPECT ranks** — Runner → Operator → Kingpin, earned from missions, taxi fares and clean getaways
- **Pay 'n Spray** — $100 respray repairs the car and clears your stars; the same garage fits +50% hull armour and a +15% engine tune
- **Two procedural radio stations** — Vice FM and Solmar, sequenced live in WebAudio beside an RPM-tracking engine note, gunfire, crashes and the cash register
- **A city that is awake** — lane-following traffic in sport, sedan and taxi bodies; pedestrians who stroll, flee and can be robbed; six districts on the HUD (Downtown, Ocean Drive, Solmar Bay, Palm Heights, North Beach, The Harbor); a rotating minimap with cops, roadblocks, the helicopter and mission markers

## Run it

```sh
node serve.ts
```

Then open http://localhost:8734/ in a desktop browser. Serve `game/` from any static host instead if you prefer — it is just files.

---

<sub>Entered on [make.fun](https://make.fun/?ref=chase-burns&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
