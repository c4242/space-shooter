# Sable Rift

A 3D space combat and trading game that runs in the browser, in the spirit of classic cockpit space sims. You fly from a full cockpit with MFD screens, warning lights and a HUD. You trade cargo between stations, fight pirates, and stay away from the black hole at the edge of the system.

**Play:** https://c4242.github.io/space-shooter/

## Features

- **Cockpit:** an enclosed green-metal cockpit with canopy struts, an overhead panel of warning lights (SHLD, ARMR, INCM incoming missile, TRCK enemy tracking you, GRAV, FUEL, AUTO, DOCK) and blinking side-wall lights. The centre console has a red LED gun-energy bar, SET/SPD readouts, a shield display, a round radar (centre = ahead, edge = behind), a missile LOCK lamp, an ordnance readout and an afterburner fuel gauge.
- **Side screens:** two green screens showing live wireframes. The WEAPONS screen shows your own ship, loadout, credits and cargo. The TARGETING screen shows the target, turned the way it's facing you, with curved shield and armour gauges.
- **HUD:** target brackets, a lead indicator showing where to aim, missile lock-on, and nav and off-screen markers.
- **Star system:** a sun, three generated planets (one with rings), an asteroid belt, two trading stations and five nav points.
- **Black hole:** the *Sable Rift*. Its gravity pulls harder the closer you get, it has a glowing accretion disk and bends light around it, and crossing the event horizon kills you.
- **Combat:** twin lasers, homing missiles that need a lock, decoys, and pirate fighters with their own AI, missiles and bounties.
- **Trade:** buy cheap at one station and sell high at the other. Stations also repair armour, refuel the afterburner, and sell missiles and decoys.
- **Autopilot:** a cinematic external shot of your ship streaking across the screen, then you arrive at the selected nav point.
- **Graphics:** bloom, tone mapping, procedural textures, particle explosions and a lensing effect.
- **Sound:** all effects are generated in code with the Web Audio API, so there are no audio files.

## Controls

| Action | Keys |
|---|---|
| Steer | Mouse (toggle with **F**), or **Arrow keys** (Up = nose down, **I** inverts) |
| Roll | **Q / E** |
| Throttle | **W / S** or **+ / −**, **Backspace** = full stop |
| Afterburner | hold **Tab** |
| Lasers | **Space** or left click |
| Missile | **Enter** or right click (lock on by keeping a hostile in your sights) |
| Decoy | **X** |
| Targets | **T** cycle, **R** nearest hostile |
| Navigation | **N** cycle nav points, **M** nav map (click to select), **A** autopilot |
| Docking | **D** within 2.2 km of a station |
| External view | **V** |
| Pause / help, mute | **P**, **Esc** or **H**; **K** |

Autopilot doesn't work with hostiles nearby, with an incoming missile, or inside the black hole's gravity well.

## Running locally

The game is plain HTML and JavaScript modules with no build step. Three.js is loaded from a CDN. Browsers won't load JavaScript modules from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Code layout

| File | What it does |
|---|---|
| `index.html`, `css/style.css` | Page, cockpit dashboard layout, menus |
| `js/main.js` | Renderer, post-processing, game loop, input, autopilot, docking, encounters |
| `js/world.js` | Procedural star system: sky, sun, planets, stations, black hole, asteroids, nav points, market data |
| `js/ships.js` | Ship models, flight model, pirate AI, lasers, missiles, decoys, damage |
| `js/hud.js` | HUD overlay: crosshair, target brackets, lead indicator, nav markers, messages |
| `js/cockpit.js` | Cockpit frame, console instruments, radar, warning lights, wireframe screens |
| `js/ui.js` | Nav map, trade screen, menus |
| `js/effects.js` | GPU particle system (explosions, trails, sparks) |
| `js/lensing.js` | Black-hole lensing post-process shader |
| `js/audio.js` | Synthesized sound effects and engine/gravity ambience |
