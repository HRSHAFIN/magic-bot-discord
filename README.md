# Magic Bot Discord Version

A Chrome extension that **records your keyboard presses, mouse clicks and scroll
wheel** on *any* website (Discord, YouTube, web apps, games in the browser...) and
replays them on loop using **trusted browser input** (Chrome DevTools Protocol),
exactly like a real keyboard and mouse.

You control everything from the popup or with hotkeys:

- `Alt+R` — start / stop recording on the active tab
- `Alt+P` — start / stop loop playback on the active tab
- `Alt+S` — stop everything

> Use at your own risk. Automating a website may violate its terms of service and
> could lead to a warning or ban on your account.

---

## How it works

1. **Record** — pick the tab you want (the Discord tab, for example), press
   **Start recording** (or `Alt+R`), then do the actions you want repeated:
   type messages, click buttons/channels, scroll, press `Enter`, etc. A red
   **REC** pill floats at the top of the page — click it (or `Alt+R`, or **Stop &
   save** in the popup) when you're done.
2. **Loop** — press **Loop play** (or `Alt+P`). The bot replays your recording
   over and over, sending each key and click as **trusted input** so websites see
   a real user. It pauses between loops so you can tune the rhythm.
3. **Stop** — press **Stop** (or `Alt+S`).

Because it replays *your* exact actions, it handles chat messages, button clicks,
scroll positions, and any site's UI — no per-site code needed.

---

## Install

1. Open Chrome → `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Optional: pin the extension (puzzle icon → pin) so the bot icon stays visible

> Note: this extension needs broad host permissions because it must run on every
> website (Discord, YouTube, etc.). That is expected.

---

## Usage

1. Open the site you want to automate (e.g. discord.com) in a tab.
2. Open the extension popup. The **Target tab** dropdown already points at your
   active tab; pick a different one if needed.
3. **Start recording**, do your actions in that tab, then **Stop & save**.
4. Set **Loop count** (`0` = forever) and **Pause between loops**.
5. **Loop play** — done.

> Tip: before recording, press **Test input** once. If it presses `Space`, the
> trusted-input bridge works on that site.

---

## Options

### Target tab
The tab the bot records from and plays into. Defaults to your active tab.
Hotkeys (`Alt+R/P/S`) always act on the currently active tab.

### Playback settings
- **Trusted input (CDP)** — on by default. Sends input through Chrome's DevTools
  Protocol so sites see real trusted events. Turn it off to use synthetic DOM
  events instead (no "debugging this browser" bar, but less reliable).
- **Mouse coordinates** — `Normalized` scales recorded click positions to any
  window size; `Absolute` replays exact pixels.
- **Loop count** — number of replays (`0` = forever).
- **Pause between loops (min/max ms)** — random break between replays.
- **Playback speed** — `1` = your original timing, `0.5` = twice as fast,
  `2` = half speed (range `0.3`–`3`).

### Macros
You can save several named macros and switch between them with the dropdown
(**New / Rename / Delete**). Recording always overwrites the selected macro.

- **Edit macro manually** — one action per line:
  - `delay_ms  key` — press a key, e.g. `0  Space`, `300  Enter`, `120  Shift+3`
  - `delay_ms  click nx ny` — click at normalized position, e.g. `0  click 0.5 0.3`
  - `delay_ms  scroll dx dy` — scroll wheel, e.g. `200  scroll 0 400`
- **Export / Import** — save or load all macros as a `.json` file.

### Log
Live log of everything the bot does (`Loop 1 - playing`, click positions,
warnings). **Clear** empties it.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "could not reach target tab" | The tab may be `chrome://`, the Web Store, or a page where extensions can't run. Pick a normal site tab. |
| Recording does nothing | Make sure the target tab is where you're typing/clicking. `Escape` is ignored while recording. |
| Keys/click don't fire during playback | Press **Test input**. If it fails, turn off **Trusted input** (synthetic mode) or re-select the target tab. |
| "debugging this browser" bar shows | Normal — that's the trusted-input bridge. It disappears when you Stop. |
| Click lands in the wrong place | Switch **Mouse coordinates** to `Absolute` (or re-record with the same window size). |
| Loop goes out of sync | Your recording must end where it started. Re-record so it returns to the exact starting state. |
| Page reloaded | Press **Loop play** again (recordings are stored in the extension, not the page). |

---

## Files

```
manifest.json          Extension manifest (MV3, all sites)
background.js          Service worker: CDP trusted input, target tab, hotkeys
content/engine.js      Bot engine: settings, playback loop, key/click/scroll steps
content/content.js     Recorder (keyboard/mouse/scroll capture) + message wiring
popup/                 Popup UI (record, play, macro manager, export/import, log)
icons/                 Extension icons
```
