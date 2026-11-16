# dmxsim — lighting simulator for DJ events

dmxsim receives **Art-Net** from your lighting software and renders the fixtures in 3D, placed in the venue drawn in `commons.svg`.
Use it to check how cues and presets look before the event, without the real fixtures.

```
lighting software ──Art-Net (UDP 6454)──▶ server.mjs ──SSE──▶ browser (3D view, three.js)
```

## Usage

```bash
npm install          # first time only (fetches three.js)
npm run serve        # then open http://localhost:8080/ (npm start also works)
```

- Set your lighting software's output to **Art-Net** and send it to this machine's IP (`127.0.0.1` if it runs on the same machine), UDP port **6454**.
  Broadcast (e.g. `192.168.x.255`) also works.
- Art-Net Port-Address (Net/SubNet/Universe) 0 maps to `"universe": 0` in `patch.json`.
- The server answers ArtPoll, so software with node discovery lists it as "DMX SIM".
- If the signal stops, the last values are held (like HOLD mode on real fixtures).

You can test without lighting software by sending the demo signal:

```bash
npm run demo                       # sends to 127.0.0.1
node tools/artnet-demo.mjs 192.168.50.10 --bpm 140
```

Server options: `node server.mjs --http 8080 --artnet 6454 --bind 0.0.0.0`

## Screen

| Location | Contents |
|---|---|
| Top left | Art-Net status (packets/s, universes, source IP) |
| Bottom left | Camera presets: Overview / Audience / DJ / Top |
| Right panel, Fixtures tab | Level, color and state of each fixture. Click a fixture (in the list or in 3D) to see its channel values |
| Right panel, DMX tab | 512-channel monitor; patched ranges are outlined in color |
| Right panel, View tab | Haze amount, bloom, wall height, work light, frame rate limit (default 60 fps), render resolution |

Camera controls (first-person): left drag = look around (turns your head in place), right drag = slide, wheel = move forward/back, **W/A/S/D** = move forward/left/back/right, **Space** = up, **Shift** = down.

## Configuration

### `config/patch.json` — fixture placement

Coordinates are in meters. The origin is the top-left corner of the grid in `commons.svg`; **x = right (east)**, **y = down (toward the road)**, **h = height above the floor**.
The initial values were read off the plot in `layout.png`.

| Key | Meaning |
|---|---|
| `profile` | Key in `profiles.json` |
| `universe`, `address` | Art-Net universe and start address |
| `x`, `y`, `h` | Mounting position |
| `mount: "hang"`, `yaw` | Moving heads: hung from the ceiling. `yaw` is the pan reference direction (degrees, clockwise, 0 = north / lecture-building side) |
| `aim: [x, y, h]` | Pars and lasers: the point they aim at |

`props` places the stage, screens, booth and other objects. `venue.ceiling` is the ceiling height (3.2 m).

### `config/profiles.json` — channel layouts

| Profile | Source |
|---|---|
| `stage-evolution/minispot30` | `vendor/minispot30.pdf` (V1.00), 9-channel mode (pan 540° / tilt 270° / 12° beam) |
| `stage-evolution/laserscan300` | `vendor/laserscan300.pdf` (V1.00), 17-channel DMX chart and pattern table |
| `user/glp-185l` | R / G / B / W / A, 5 channels (no dimmer channel) |
| `user/twinkle-ball` | `vendor/twinkleballdmx.pdf` (TWINKLE BALL DMX, V1.00), 8-channel mode |

The manuals in `vendor/` are not committed to the repository (see `.gitignore`); get them from the manufacturer if you need them.

Channels are in the order of the `channels` array. Each `key` tells the simulator what the channel does, so you can match a real fixture just by reordering the entries.

### Floor plan `commons.svg`

The browser loads the SVG at startup and builds the 3D venue from its layer names. The layer names are in Japanese and must stay as they are:

- `罫線` (grid) — scale (1 square = 1 m) and origin
- `基本図/カーブ` (base drawing / curves) — thick lines = walls, thin lines = outdoor boundaries, dashed lines = glass automatic doors (rendered as glass; light passes through)
- `柱・障害物` (pillars / obstacles) — pillars, rendered as floor-to-ceiling boxes
- `文字列` (text) — ignored if present (it has been removed from `commons.svg`)

If you redraw the plan with the same layer structure, the changes show up automatically.

## What is simulated, and simplifications

- Moving heads: pan/tilt follow the target with simulated motor speed (ch7 speed is applied), color wheel (split colors shown as the midpoint color), 7 gobos (generic shapes, not the real gobo art), gobo shake, wheel rotation, strobe, ch8 built-in programs, ch9 movement/reset.
- Lasers: patterns (groups 1–2 drawn as shapes; groups 3+ approximated with emoji/text outlines), color, drawing, size/zoom, X/Y/Z roll, pan/tilt, auto/sound modes. The scan angle is assumed to be 50°.
- Twinkle Ball: master dimmer, strobe, motor angle/rotation. The R/G/B LEDs are not mixed: each beam is red, green or blue, and a spot of that color is drawn where it lands on the floor, walls or ceiling. The contents of the auto/sound programs are not documented, so they are approximated by stepping through colors.
- Beams approximate their appearance in haze by ray marching. They stop at walls, pillars, the floor and the ceiling, and pass through the glass doors. The ceiling is only visible from below, so it never blocks the overview camera.
