# dmxsim

A 3D lighting simulator for DJ events. dmxsim receives **Art-Net** from your lighting software and lights up the fixtures in a 3D model of the venue, so you can check cues and presets before the event without the real rig.

```
lighting software ──Art-Net (UDP 6454)──▶ server.mjs ──SSE──▶ browser (3D view, three.js)
```

- Receives Art-Net (ArtDmx) on any universe and answers ArtPoll, so consoles can discover it
- Builds the venue (walls, pillars, glass doors) from the floor plan `commons.svg`
- Simulates moving heads, pars, lasers and an LED effect ball from their DMX charts
- Volumetric beams in haze, gobo projection, laser scanning, floor/wall spots
- Live per-fixture channel view and a 512-channel DMX monitor

## Requirements

- Node.js (tested with 22)
- A browser with WebGL 2 (recent Chrome, Edge, Firefox or Safari)

## Quick start

```bash
npm install       # first time only (fetches three.js)
npm run serve     # or: npm start
```

Open <http://localhost:8080/>.

Then point your lighting software at the simulator:

1. Set the output to **Art-Net**.
2. Send it to this machine's IP, UDP port **6454**. Use `127.0.0.1` if the software runs on the same machine. Broadcast (e.g. `192.168.x.255`) also works. The View tab lists this machine's addresses.
3. Art-Net Port-Address 0 (Net 0 / SubNet 0 / Universe 0) is `"universe": 0` in `config/patch.json`.

When Art-Net is arriving, the indicator at the top left turns green. If the signal stops, the last values are held, like HOLD mode on real fixtures.

### Options

| Option | Environment variable | Default |
|---|---|---|
| `--http <port>` | `HTTP_PORT` | `8080` |
| `--artnet <port>` | `ARTNET_PORT` | `6454` |
| `--bind <address>` | — | `0.0.0.0` |

```bash
npm run serve -- --http 8090
```

### Demo signal

To try the simulator without lighting software, run the demo sender in a second terminal. Options go after `--`:

```bash
npm run demo                                  # sends to 127.0.0.1:6454
npm run demo -- 192.168.50.10 --bpm 140       # another machine, faster tempo
npm run demo -- --scene 3 --only spot,laser   # hold look 3, drive only moving heads and lasers
npm run demo -- --help                        # list all options
```

| Option | Meaning | Default |
|---|---|---|
| `[host]`, `-H, --host <ip>` | Destination IP (a broadcast address also works) | `127.0.0.1` |
| `-p, --port <port>` | Destination UDP port | `6454` |
| `-b, --bpm <bpm>` | Tempo | `128` |
| `-s, --scene <1-4>` | Hold one look instead of cycling | cycle all four |
| `--bars <n>` | Bars per look when cycling | `4` |
| `--only <list>` | Drive only these fixture types: `spot`, `par`, `laser`, `ball` (others stay dark) | all |
| `--still <sec>` | Freeze the show at this time (for screenshots) | — |
| `--fps <n>` | Packets per second per universe | `40` |

The four looks:

1. Moving heads chase one at a time, lasers off
2. Gobos in, lasers change color
3. Wider moving-head sweep, lasers rotate, twinkle ball off
4. Gobo wheel spins, pars add amber, twinkle ball in sound mode

Each fixture is sent on the universe set in `patch.json`. Stop the demo before using real lighting software; otherwise both signals arrive and the output flickers.

## Using the simulator

| Location | Contents |
|---|---|
| Top left | Art-Net status (packets/s, universes, source IP) |
| Bottom left | Camera presets: Overview / Audience / DJ / Top |
| Fixtures tab | Level, color and state of each fixture. Click a fixture in the list or in 3D to see its channel values |
| DMX tab | 512-channel monitor; patched ranges are outlined in color |
| View tab | Haze, bloom, walls, work light, frame rate limit, resolution, and where to send Art-Net |

View settings are saved in the browser.

### Camera controls

The camera is first-person.

| Input | Action |
|---|---|
| Left drag | Look around (turn your head in place) |
| Right drag | Slide sideways / up and down |
| Wheel | Move forward / back |
| W A S D | Move forward / left / back / right |
| Space / Shift | Move up / down |

## Fixtures

The default patch (`config/patch.json`), all on universe 0:

| Fixture | Profile | Address | Channels |
|---|---|---|---|
| MINI SPOT 30 1–4 | `stage-evolution/minispot30` | 1, 10, 19, 28 | 9 |
| Twinkle Ball 1 | `user/twinkle-ball` | 37 | 8 |
| PAR 1–2 (ceiling, aimed at the stage) | `user/glp-185l` | 45, 50 | 5 |
| LASER SCAN 300 1–2 | `stage-evolution/laserscan300` | 55, 72 | 17 |
| PAR 3–4 (floor, crossing at 45° in front of the DJ booth) | `user/glp-185l` | 89, 94 | 5 |

## Configuration

### `config/patch.json` — fixture placement

Coordinates are in meters. The origin is the top-left corner of the grid in `commons.svg`; **x = right (east)**, **y = down (toward the road)**, **h = height above the floor**.

| Key | Meaning |
|---|---|
| `name` | Name shown in the Fixtures tab |
| `profile` | Key in `profiles.json` |
| `universe`, `address` | Art-Net universe and start address |
| `x`, `y`, `h` | Mounting position |
| `mount: "hang"`, `yaw` | Moving heads: hung from the ceiling. `yaw` is the pan reference direction in degrees, clockwise, 0 = north (lecture-building side) |
| `aim: [x, y, h]` | Pars and lasers: a point in the direction they face (only the direction matters) |

`props` places the stage, screens, booth and other objects. `venue.ceiling` is the ceiling height (3.2 m).

Overlapping addresses are reported at the top of the Fixtures tab.

### `config/profiles.json` — channel layouts

| Profile | Kind | Source |
|---|---|---|
| `stage-evolution/minispot30` | `moving-spot` | MINI SPOT 30 manual V1.00, 9-channel mode (pan 540° / tilt 270° / 12° beam) |
| `stage-evolution/laserscan300` | `laser` | LASER SCAN 300 manual V1.00, 17-channel DMX chart and pattern table |
| `user/glp-185l` | `par` | R / G / B / W / A, 5 channels (no dimmer channel) |
| `user/twinkle-ball` | `twinkle-ball` | TWINKLE BALL DMX manual V1.00, 8-channel mode |

Channels are listed in DMX order in the `channels` array. Each `key` tells the simulator what the channel does, so you can match a fixture by reordering the entries.

The manuals are kept in `vendor/`, which is not committed (see `.gitignore`). Get them from the manufacturer if you need them.

### Adding a fixture

1. If it is a new model, add a profile to `profiles.json`. `kind` must be one of `moving-spot`, `par`, `laser` or `twinkle-ball`, and the channel `key`s must be ones that kind understands (copy an existing profile of the same kind).
2. Add an entry to `fixtures` in `patch.json` with a unique `id`, `address` and position.
3. Reload the browser. The server does not need a restart.

### Floor plan `commons.svg`

The browser loads the SVG at startup and builds the venue from its layer names. The layer names are in Japanese and must stay as they are:

| Layer | Used for |
|---|---|
| `罫線` (grid) | Scale (1 square = 1 m) and origin |
| `基本図/カーブ` (base drawing / curves) | Thick lines = walls, thin lines = outdoor boundaries, dashed lines = glass automatic doors (light passes through) |
| `柱・障害物` (pillars / obstacles) | Pillars, rendered as floor-to-ceiling boxes |
| `文字列` (text) | Ignored |

If you redraw the plan with the same layer structure, the changes show up automatically.

## What is simulated

- **Moving heads**: pan/tilt follow the target at a simulated motor speed (ch7 is applied), color wheel (split colors shown as the midpoint color), 7 gobos (generic shapes, not the real gobo art), gobo shake, wheel rotation, strobe, ch8 built-in programs, ch9 movement/reset.
- **Lasers**: patterns (groups 1–2 drawn as shapes; groups 3+ approximated with emoji/text outlines), color, drawing, size/zoom, X/Y/Z roll, pan/tilt, auto/sound modes. The scan angle is assumed to be 50°.
- **Pars**: RGBWA additive mixing.
- **Twinkle Ball**: master dimmer, strobe, motor angle/rotation. The R/G/B LEDs are not mixed: each beam is red, green or blue, and a spot of that color is drawn where it lands. The auto/sound programs are not documented, so they are approximated by stepping through colors.
- **Beams** are ray-marched through haze. They stop at walls, pillars, the floor and the ceiling, and pass through the glass doors. The ceiling is only visible from below, so it never blocks the overview camera.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Indicator stays orange ("Waiting for Art-Net") | The software is sending to the right IP and UDP 6454; the firewall allows incoming UDP 6454; the output universe is 0 |
| `EADDRINUSE` on startup | Another program is using the port. Pick another with `--http` or `--artnet` |
| Output flickers | Two sources are sending to the same universe (e.g. the demo and your lighting software) |
| A fixture does not respond | Its address and universe in `patch.json` match your software's patch, and the address-overlap warning is not shown |
| High GPU usage | In the View tab, lower Resolution, turn off Bloom, or set the frame rate limit to 30 fps |

## Project structure

```
server.mjs              Art-Net receiver, HTTP server, SSE stream (no dependencies)
public/
  index.html, style.css UI
  main.js               scene setup, Art-Net stream, panels, camera controls
  venue.js              floor plan → 3D venue, ray casting against walls
  fixtures.js           fixture models (moving head, par, laser, twinkle ball)
  laser-patterns.js     laser pattern library
config/
  patch.json            fixture placement and addresses
  profiles.json         fixture channel layouts
tools/artnet-demo.mjs   demo Art-Net sender
commons.svg             venue floor plan
```

## License

[MIT](LICENSE)
