<p align="center">
  <img src="assets/icon.svg" width="96" alt="App icon"><br>
  <b>Legrand with Netatmo (Local)</b> — Homey Pro app<br>
  <sub>Local control of Legrand with Netatmo and BTicino devices over the HomeKit Accessory Protocol. No cloud.</sub>
</p>

<p align="center">
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#devices">Devices</a> ·
  <a href="#flows">Flows</a> ·
  <a href="#dashboard-widgets">Widgets</a> ·
  <a href="#heating-plan">Heating plan</a> ·
  <a href="#scenes">Scenes</a> ·
  <a href="#troubleshooting">Troubleshooting</a>
</p>

---

**Version 0.9.14 (beta)** · GPL-3.0 · requires Homey Pro (2023 or later), firmware ≥ 12.4.0

## What it does

The Legrand gateway (Home + Control) and the BTicino Smarther thermostats are HomeKit
accessories. This app pairs with them directly on your LAN — the way an iPhone would — and
turns them into native Homey devices: lights, shutters with slat tilt, wireless remotes and
thermostats. Everything stays local: no Legrand cloud, no Apple Home, no internet needed.

On top of the devices it adds **scenes**, a **house-wide heating plan** with per-room
temperatures, and **dashboard widgets**.

> The Home + Control app keeps working as before (it talks to the devices over Legrand's own
> channel). Only the HomeKit pairing moves to Homey — a HomeKit accessory accepts a single
> controller, so devices paired here must not be in Apple Home at the same time.

## Installation

1. Install the app (from the App Store once published, or `homey app install` from this repo).
2. **Add a device** → Legrand → any device type. The wizard lists Legrand / BTicino HomeKit
   devices found on your network; select the gateway and enter its 8-digit HomeKit setup code
   (on the gateway's label or in Home + Control → gateway → HomeKit).
3. Tick the devices to add. Repeat per device type; pairing happens only once.
4. Smarther thermostats are separate HomeKit accessories: pair each one with its own code
   (App settings → Gateways → Found on the network → Pair, or the wizard).

If Homey can't see a device via mDNS (different VLANs), pair it by HomeKit id + IP address
(App settings → Gateways → Expert). Give the gateway and thermostats DHCP reservations.

## Devices

| Driver | HomeKit service | Capabilities |
|---|---|---|
| **Light** | Lightbulb | `onoff`, `dim` (dimmers), `light_hue` / `light_saturation` / `light_temperature` (colour bulbs) — all added automatically. Energy approximation 8 W (editable). |
| **Shutter** | Window Covering | `windowcoverings_set` (position), `shutter_tilt` (slat angle in degrees, only on shutters in *Orientable sun shades* mode), `shutter_moving`, `shutter_status` (tile text, e.g. `56 % · 44° ▲`) |
| **Wireless remote** | Stateless Programmable Switch + Battery | `alarm_battery` + button-press Flow trigger |
| **Smarther thermostat** | Heater Cooler (or Thermostat) + Humidity Sensor | `measure_temperature`, `target_temperature` (5–30 °C, 0.5 steps), `thermostat_heating`, `thermostat_mode` (Schedule / Manual / Frost guard / Off), `measure_humidity`, `thermostat_status` |
| **Socket / contactor** *(experimental)* | Outlet / Switch | `onoff` — connected sockets, contactors, teleruptors, cable outlets |
| **Sensor** *(experimental)* | Contact / Motion / Smoke / CO Sensor + Battery | `alarm_contact` / `alarm_motion` / `alarm_smoke` / `alarm_co`, `alarm_battery`, `alarm_tamper` |

### Support status

| Status | What it means | Devices |
|---|---|---|
| ✅ **Verified** | Tested on real hardware by the author | Light switches (single/double), dimmers, roller shutters (aperture and orientable modes), wireless 2-button remotes, Smarther with Netatmo thermostat, the Legrand gateway itself |
| 🧪 **Experimental — likely** | Implemented from the HomeKit specification; Legrand documents these as HomeKit-compatible but they have not been seen on hardware yet | Sockets, contactors, teleruptors, cable outlets (Legrand lists all "with Netatmo" outlets as HomeKit devices) · colour / tunable-white third-party bulbs · Netatmo smoke and CO alarms (standalone HomeKit accessories, paired like a Smarther) · thermostats exposing the standard Thermostat service |
| 🧪 **Experimental — uncertain** | Code exists, exposure over HomeKit not confirmed | Wireless motion sensor (a gateway accessory in Legrand's US range) |
| ❌ **Not possible** | Not exposed over HomeKit by Legrand/Netatmo | Netatmo door/window sensors (they pair with Netatmo cameras, cloud only), Netatmo modulating thermostat and radiator valves, energy meter / load shedder, BTicino alarm system, sirens, Home + Control scenes, schedules and Boost |

Have an experimental device? Its dump from the app settings (Devices tab → status) or a log excerpt is all that's needed to promote it to verified — please open an issue.

All devices: **Blink** (identify the wall module) and **Rebuild device capabilities**
maintenance actions in Advanced settings. Devices are identified by serial number, so they
survive re-pairing the gateway, and their capabilities follow configuration changes made in
Home + Control (e.g. a shutter switched to orientable mode gains its tilt control automatically).

Slat tilt on Legrand orientable shutters has five positions (0 / 22 / 44 / 66 / 88°); the tilt
slider snaps to them.

## Flows

**Triggers**
- Remote: *Button [1–8] is pressed ([any | single | double | long])* — token: press type
- Thermostat: *Heating started / stopped*
- Heating plan: *Heating profile changed* (tokens: profile, previous profile)
- plus Homey's built-in cards for every standard capability (position changed, temperature changed, …)

**Conditions**
- Shutter *is / isn't moving*
- Thermostat *is / isn't heating*
- Heating profile *is / isn't [Comfort | Eco | Night | Away | Frost guard]*

**Actions**
- Shutter: *Set slats to [angle]* · *Set position to [x %] and slats to [angle]* (moves first, tilts once stopped)
- *Activate scene [scene]*
- Heating: *Set heating to [profile] [until next switch | 1 h | 2 h | 4 h | 8 h | 24 h | until cancelled]* · *Resume heating plan*
- Thermostat mode → Frost guard / Schedule / Manual / Off via the standard *Set thermostat mode* card

## Dashboard widgets

Three widgets for Homey Dashboards, each configurable per instance (which devices or scenes).

| Scenes | Shutters | Heating |
|---|---|---|
| ![Scenes widget](docs/images/widget-scenes.png) | ![Shutters widget](docs/images/widget-shutters.png) | ![Heating widget](docs/images/widget-heating.png) |
| Tiles with the scene's emoji; tap to run. Show all scenes or pick up to six. | Live-drawn shutters (curtain = position, slat gaps = tilt) that animate while the motor runs, at each shutter's own learned travel speed. Tap to select, then **Open / Shade / Close** — with nothing selected the buttons act on all shown shutters. | Current profile and next switch, profile chips to override, a resume button, and one row per room with temperature → target, a flame while heating and manual/off tags. |

### Roadmap — widgets under consideration

Design studies for the next widgets. Nothing here is built yet; feedback welcome in the issues.

| Candidates | Colour tints | Room thermostat gauge |
|---|---|---|
| ![Widget candidates](docs/images/roadmap-widgets.png) | ![Tint study](docs/images/roadmap-tints.png) | ![Gauge study](docs/images/roadmap-thermostat-gauge.png) |
| **Lights** (tile grid or room list, any Homey light incl. Hue), **room thermostat**, **today's heating timeline**, **gateway health**, **sensors strip** | Tile backgrounds follow the bulb's colour and brightness; thermostat tint follows heating / idle / off — all faint, brand red as accent | Arc gauge over the 5–30 °C range with the target marker, − / + setpoint, per-room profile chips and a "Plan" button to rejoin the schedule |

## Heating plan

*App settings → Heating.* A house-wide weekly schedule, like the one in Home + Control but run
by Homey, so presence, calendars and windows can drive it from Flows.

- **Profiles**: Comfort, Eco and Night with a temperature per room; Away and Frost guard as
  house-wide values.
- **Plans**: several named plans (Winter, Summer…), one active; per day a list of switch points
  (time → profile), copy days, colored week bars.
- **Overrides**: put the whole house on a profile until the next switch point, for N hours or
  until cancelled — from the settings page or a Flow.
- **Per room**: turning the dial (on the wall, in Homey or in Home + Control) holds that room
  manually until the next switch point; a room can opt out of the plan entirely. The device's
  mode picker shows *Schedule*, *Manual*, *Frost guard* or *Off* accordingly.
- Setpoints are re-applied every 30 minutes, which also defeats the Smarther's own 2-hour
  manual-mode expiry. Switch the thermostats to manual mode in Home + Control so both
  schedules don't compete.
- Optional timeline notifications for profile changes and room manual changes.

## Scenes

*App settings → Scenes.* A scene is a named set of target states — shutter position and slat
angle, light on/off, thermostat mode and target — with an emoji. "Capture current state"
pre-fills a new scene from how the house is right now. Run from the settings page, a Flow
(*Activate scene*) or the Scenes widget.

## Troubleshooting

- **"Already paired to another controller"**: remove the device from Apple Home, or reset its
  HomeKit pairing (gateway: hold the cogwheel button ~10 s and release at the first colour
  flash — *not* longer, that resets the installation). Full steps in App settings → Gateways → Help.
- **Device not found on the network**: enable mDNS reflection between VLANs on your router, or
  pair by id + IP (Gateways → Expert).
- **Log**: App settings → Log shows every event and write per device, filterable.

## Development

```bash
npm install
npm run lint       # ESLint (app JS + inline scripts): no-shadow, no-redeclare, no-undef
npm run validate   # homey app validate
homey app run
```

- `lib/HapSession.js` — endpoint pool: one encrypted HAP session per paired device, reconnect,
  `c#` watching, periodic accessory-DB diff, IPv4-only addressing.
- `lib/HapDevice.js` / `lib/HapDriver.js` — shared device/driver base (dynamic capabilities, pairing).
- `lib/Heating.js`, `lib/Scenes.js` — plan engine and scenes.
- `widgets/*` — dashboard widgets; `settings/index.html` — settings page.
- `homey-api` + permission `homey:manager:api` — resolves widget device selections.

### Dead ends (kept so nobody retries them)

- **Stop for shutters**: Legrand exposes no HoldPosition and re-writing CurrentPosition does not
  halt travel. No stop command.
- **"Exclude from Energy" on lights**: only metered devices get it; `setEnergy()` tricks detach
  devices from manifest defaults. Set "Power usage when on" to 0 W instead.
- **Custom number sensors as tile status**: only custom *string* capabilities are offered in the
  status-indicator picker.
- **hap-controller's mDNS inside the app container**: unreliable; Homey's discovery service is used.
- **Homey device id from the SDK `Device`**: not exposed; the Web API lookup is the supported way.
- **Friendly names over HAP**: the gateway advertises module names only.

## Credits

Built on [hap-controller](https://github.com/WebThingsIO/hap-controller-node). Not affiliated with
Legrand, BTicino, Netatmo or Apple. Licensed under GPL-3.0 — see [LICENSE](LICENSE).
