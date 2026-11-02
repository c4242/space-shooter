# Space Shooter

A simple 3D space shooter that runs in the browser. It uses [Three.js](https://threejs.org/) loaded from a CDN, so there is no build step.

## Play

- **Locally:** open `index.html` in a modern browser (needs internet access to load Three.js).
- **From GitHub:** enable GitHub Pages (Settings → Pages → Deploy from branch → `main` / root). The game is then served at `https://<user>.github.io/space-shooter/`.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move | WASD / Arrow keys | Drag |
| Fire | Space | Auto-fire while dragging |

Red crystals take one hit (100 pts). Brown asteroids take three hits (50 pts). You have three lives. Enemies get faster and spawn more often over time.
