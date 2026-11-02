# Sable Rift

A 3D space combat and trading game that runs in the browser, in the spirit of classic cockpit space sims, with Newtonian flight physics. Fly from a full cockpit across three star systems: trade, smuggle, hunt pirates, deal with the police, and play through a four-chapter story campaign. Works with keyboard + mouse, gamepad, or touch.

**Play:** https://c4242.github.io/space-shooter/

## Features

- **Newtonian flight:** the engine pushes along your nose and you keep drifting until you thrust the other way. Turning does not change your direction of travel. The HUD's prograde marker (green ⊕) shows where you're actually going, and the retrograde marker (amber ⊗) is where to point and burn to stop. Hold **C** for manoeuvring-thruster braking and **Z** for reverse thrust. Gravity adds to your momentum.
- **Three star systems linked by jump gates:** *Sable Rift* (black hole, frontier), *Corvane* (Authority core: shipyards and heavy patrols) and *Hollow Reach* (lawless red dwarf with the Ashfang outpost Gallows Rock). Fly to a gate and press **J**. The nav map includes a galaxy view.
- **Story campaign, "The Rift Signal":** four chapters with briefings, ambushes, a convoy interception and a final battle with the warlord Krell. Start it at Meridian Highport (STORY tab when docked).
- **Police and reputation:** Authority patrols scan your cargo for contraband and fight pirates. You have reputation with the Authority and with Ashfang. Shooting civilians or police, or being caught smuggling, makes you **WANTED**: patrols attack on sight and stations charge a fine before you can dock. Gallows Rock sells contraband and offers smuggling jobs.
- **Missile types:** Dart heat-seekers (fire and forget, 45 damage), Seekers (1.2 s lock, 85 damage) and Torpedoes (3 s lock, 320 damage, 2 rack slots; sold only at Corvane Shipyards and Gallows Rock). **G** switches type.
- **Touch controls:** on phones and tablets, a virtual stick and buttons appear automatically (play in landscape).
- **Cockpit:** an enclosed green-metal cockpit with canopy struts, an overhead panel of warning lights (SHLD, ARMR, INCM incoming missile, TRCK enemy tracking you, GRAV, FUEL, AUTO, DOCK) and blinking side-wall lights. The centre console has a red LED gun-energy bar, SET/SPD readouts, a shield display, a round radar (centre = ahead, edge = behind), a missile LOCK lamp, an ordnance readout and an afterburner fuel gauge.
- **Side screens:** two green screens showing live wireframes. The WEAPONS screen shows your own ship, loadout, credits and cargo. The TARGETING screen shows the target, turned the way it's facing you, with curved shield and armour gauges.
- **HUD:** target brackets, a lead indicator showing where to aim, missile lock-on, and nav and off-screen markers.
- **Star system:** a sun, three generated planets (one with rings), an asteroid belt, two trading stations and five nav points.
- **Black hole:** the *Sable Rift*. Its gravity pulls harder the closer you get, it has a glowing accretion disk and bends light around it, and crossing the event horizon kills you.
- **Combat:** twin lasers, homing missiles that need a lock, decoys, shield-impact flashes and smoking damaged ships. Two pirate types: nimble Raiders and heavily armed Marauders. Each has its own AI and missiles and pays a bounty.
- **Salvage:** destroyed pirates drop glowing cargo pods. Target them with **T**, match speed with **B** and fly through them to scoop the goods into your hold.
- **Ship damage:** armour hits can knock out your guns (slower fire), engine (less thrust and agility), shield generator (slower recharge) or sensors (radar drops contacts, slower missile locks). Damage-control patches systems up to 50% in flight; stations repair them fully.
- **Mining:** shoot asteroids to crack them open and scoop the ore chunks (water ice in Corvane's Glass Belt).
- **Hulls:** the agile *Kestrel* you start in, or the *Bastion* heavy fighter (four guns, thicker armour, bigger hold and missile rack, slower) from the shipyard.
- **Wingmen:** hire a wingman at a station. They fly in formation, attack pirates near you, follow you through autopilot and jump gates, and take half the bounty of their kills.
- **Capital ships:**
  - **Ashfang carrier Gorehaven (300 m):** turret batteries, launches raiders, appears in Hollow Reach and occasionally Sable Rift.
  - **AV Sovereign:** an Authority dreadnought (1.3 km) stationed at Corvane Shipyards.
  - **Ashfang Leviathan (1.5 km):** a pirate mothership at the Leviathan Drydock in Hollow Reach. Bounty 40,000 cr; bring torpedoes.
  - Capital ships are solid, shots must hit the actual hull, and they die in long chains of explosions.
- **Settings:** the pause screen has volume, mouse sensitivity, invert, mouse-flight and graphics-quality settings, saved in your browser.
- **Living system:** civilian freighters fly between the stations. Pirates will prey on them, and shooting one down gets you fined.
- **Docked at a station:**
  - **Market:** buy low and sell high at the other station.
  - **Contracts:** bounty hunts at a nav point, or cargo deliveries to the other station (up to 3 at once).
  - **Shipyard:** upgrade guns, shields, armour, engine and cargo hold.
  - **Services:** repairs, afterburner fuel, missiles and decoys.
- **Career save:** progress is saved in your browser whenever you dock or launch. After dying you can reload your last save or start over.
- **Autopilot:** a cinematic external shot of your ship streaking across the screen, then you arrive at the selected nav point.
- **Graphics:**
  - Pitch-black space with crisp pinpoint stars and no haze.
  - Panelled hull plating on ships and stations, textured asteroids, and engine plumes that grow with thrust.
  - An animated star surface and lens flares (starburst, streak, ghosts). Planets block the flare.
  - Planets with true day/night sides, city lights, ocean glints and glowing atmosphere rims.
  - Black-hole lensing, explosions with shockwaves and tumbling debris, bloom, MSAA, and a subtle vignette.
  - Add `?quality=low` to the URL on slower machines; touch devices use it automatically.
- **Sound:** all effects and the ambient music (with a combat layer) are generated in code with the Web Audio API, so there are no audio files.
- **Gamepad:** supported with the standard controller layout.

## Controls

| Action | Keys |
|---|---|
| Steer | Mouse (toggle with **F**), or **Arrow keys** (Up = nose down, **I** inverts) |
| Free the cursor | hold **Alt** (or turn mouse flight off with **F**), then click a ship, pod or station on screen to target it |
| Roll | **Q / E** |
| Thrust | **W / S** or **+ / −** (throttle = engine thrust), **Backspace** = cut thrust |
| Brake / reverse thrust | hold **C** (thrusters cancel drift) / hold **Z** |
| Flight assist / match velocity | **Y** toggles flight assist (thrusters cancel sideways drift) / hold **B** to match the target's velocity |
| Afterburner | hold **Tab** |
| Lasers | **Space** or left click |
| Missile | **Enter** or right click; **G** switches Dart / Seeker / Torpedo |
| Decoy | **X** |
| Targets | **T** cycle, **R** nearest hostile |
| Navigation | **N** cycle nav points, **M** nav map (click to select), **A** autopilot, **J** jump at a gate |
| Docking | **D** within 2.2 km of a station, below 150 m/s |
| Views | **V** fixed external view, **F2** chase camera (springy, banks with the ship, widens with speed) |
| Pause / help | **P**, **Esc** or **H** |
| Music / mute all | **U** / **K** |
| Gamepad | left stick pitch/yaw, right stick roll, RT fire, LT afterburner, A missile, B decoy, X/Y targets, RB/LB thrust, R3 brake, L3 missile type, D-pad autopilot/dock-or-jump/nav/map, Start pause, Back view |
| Touch | virtual stick + on-screen buttons (FIRE, MSL, TYPE, DCY, BURN, BRAKE, THR±, TGT, NAV, MAP, AUTO, DOCK, JUMP, VIEW, pause) |

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
| `js/world.js` | Star system definitions and procedural generation: sky, stars, planets, stations, black hole, asteroids, jump gates, market data |
| `js/ships.js` | Ship models, Newtonian flight model, AI (pirates, police, haulers), lasers, missile types, decoys, damage |
| `js/hud.js` | HUD overlay: crosshair, target brackets, lead indicator, nav markers, messages |
| `js/cockpit.js` | Cockpit frame, console instruments, radar, warning lights, wireframe screens |
| `js/ui.js` | Nav map, docked screen (market, contracts, shipyard, services), menus |
| `js/career.js` | Save/load, reputation, contracts, jump routing |
| `js/story.js` | Story campaign chapters |
| `js/touch.js` | Touch controls |
| `js/salvage.js` | Cargo pods dropped by destroyed ships |
| `js/effects.js` | GPU particle system (explosions, trails, sparks) |
| `js/lensing.js` | Black-hole lensing post-process shader |
| `js/shaders.js` | Star, planet and atmosphere shaders; lens flare and lens finish passes |
| `js/audio.js` | Synthesized sound effects and engine/gravity ambience |
