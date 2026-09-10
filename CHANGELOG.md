# Changelog

All notable changes to this project are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.12.0] — 2026-09-09

### Added
- **Covering looks**: per-device "Drawn as" — Roller shutter, Roller shade, Curtain split, Curtain single,
  **Awning**. Awnings draw from outside (wall, interior behind the glass lit by its room's lights), with
  1–2 configurable openings, five opening types (window, full glass, French door, wide sliding door with
  two independently lit panes, push door), per-opening interior rooms, an invert-direction setting applied
  at the device boundary (position, Flows, widget and presets all physical), and Retract / Half / Extend
  preset labels in all-awning widgets.
- **Weather-aware windows**: Open-Meteo at Homey's location — clouds, animated rain and snow behind the
  glass, sun only on clear days, the moon on every night sky with clouds passing in front.
- **Grouped shutters layout**: a bordered box per room (name inside the frame, room-light pendant), plus a
  "Cards per row" setting (3 / 2 / 1) up to a full-width card with constant line weights.
- **Rocker-style stop**: pressing the direction a shutter already moves in stops it (position estimated from
  learned travel); works from widget presets, the slider endpoints and windowcoverings_state.
- **Assisted calibration wizard** (App settings → Devices): you tap the moment the shutter physically stops;
  measures true travel and the gateway's end-hold, saves manual travel times. Automatic variant as a
  maintenance button. Timeline notifications.
- **Lights widget room scenes**: side-view rooms with furniture inferred from the room name, lamps drawn in
  place by type and anchored to matching furniture.
- **Multi-vendor HomeKit gateways**: first non-Legrand bridge verified (Somfy TaHoma Switch, io awning).
  Pairing hardened — fresh mDNS advertisement before every attempt, automatic retry when the gateway moved
  port, TCP pre-flight, SRP timeout, plain-PairSetup-first method order (TaHoma ignores with-auth and a
  dangling attempt jams it Busy), background pairing with a polled verdict, full Log narration.
- **Endpoint "Devices…" preview**: what a paired bridge exposes and which driver each item maps to, before
  adding anything; unsupported accessories log their raw HAP services.
- **Diagnostics**: the log survives restarts and updates, Clear button, "wipe on restart" toggle,
  debug-level accessory inventory per DB refresh.
- **Pairing auto-dress**: awning/curtain/screen models pair with matching icon, class and look; new thin
  filled-path icon family (driver tile + five types).

### Changed
- Windows render ~30 % larger in the grouped layout; dark mode fully theme-aware (frames, mullions, slats,
  fabric, interior dividers); driver display name "Shutter / Covering"; widget device picker filters by
  capability so sunshade-class awnings appear.

### Fixed
- moods cached and the serial→device map (CPU per widget poll); device snapshot cache 4 s; zones manager
  connected (devices deliberately not — see Dead ends).
- Manual pairing address was ignored when the device was discovered; pairing could hang without a verdict;
  the failure handler crashed (`logger.log`); ManagerApi warning for the calibration helper.
- Sliding-door panes drawn at equal height; awning moving parts hidden at 0 %.

## [0.11.3] — 2026-09-08

### Added
- Scenes can include **lights on Homey** (any app): a lamp with on/off, brightness and its captured colour, a room
  "all off", or a Homey mood. "Capture current" adds every lamp that is on with its current level and colour.
- Scenes can include **thermostats and air conditioners from other apps**: power, mode, target, fan speed (unset = keep).
- Lights tab: group devices (Homey Group app and similar) shown with their members collapsed underneath; members
  inherit the group's lamp type unless set on their own ("Same as group" restores inheritance). One section per room,
  areas inside it; the glow switch only where the room has shutters. Expanded groups survive the refresh.

## [0.11.2] — 2026-09-08

### Added
- Lamp types **Wall switch** (Legrand plate with a rocker whose pressed half moves with the state), **Wall light** and
  **Outdoor** lantern. Legrand on/off switches default to Wall switch; terrace / balcony / wall names are guessed.

## [0.11.1] — 2026-09-08

### Added
- Shutters: `windowcoverings_state` is back as a Flow-only capability — "Set state" up / down opens / closes, "The state
  changed / is" reflects the motor direction. No buttons in the device UI (Legrand modules cannot stop mid-way; "idle" is refused).
- Hints (ⓘ) on all of the app's own Flow cards.

## [0.11.0] — 2026-09-08

### Added
- **Lights widget**: any light on Homey (Hue, IKEA, Legrand…). Tiles or room cards; each lamp drawn by type
  (ceiling, floor, table, bulb, strip, spot) in its real colour and brightness; tap to toggle; "All off";
  Homey moods of the room as buttons.
- **Climate widget**: any thermostat-class device. Gauge room cards that adapt to the device — Smarther rooms get
  ± setpoint, profile chips and "Plan"; air conditioners get modes, fan speed, swing / eco / boost and outside
  temperature; warm / cool / grey tints by state. Compact list layout.
- **Lights tab** in app settings: every light on Homey by room with a lamp-type picker (auto-guessed from the
  name) and the window-glow switch; Homey moods listed. "Rooms & lights" moved here from the Devices tab.
- Heating engine: per-room profile (sets the room to that profile's temperature as a manual hold).

## [0.10.6] — 2026-09-08

### Fixed
- Rooms & lights: a room now includes its sub-zones — lamps in areas inside a room count for that room's windows
  and are listed under it (with the area name) instead of only under "other rooms".

## [0.10.5] — 2026-09-08

### Added
- Shutters widget setting "Show the room light on the windows" (on by default) to hide the pendant and its glow.

## [0.10.4] — 2026-09-08

### Fixed
- Window glow reacts within a poll (≈5 s) of a lamp switching: the device snapshot behind the room-light lookup is
  refreshed on every poll instead of once a minute. Card tint removed; only the pendant's cone shows the light.

## [0.10.3] — 2026-09-08

### Fixed
- Shutters widget: light and sky changes are applied in place, so a running shutter animation no longer stops
  and jumps when a lamp switches. Lamp state is read fresh on every poll (5 s idle) instead of from a cached snapshot.
- The light cone now starts at the pendant (drawn inside the window graphic); larger pendant with a visible bulb.

## [0.10.2] — 2026-09-08

### Fixed
- Sky drawn as night during the day: the sunrise/sunset calculation used a midnight-based Julian day (12-hour offset).

## [0.10.1] — 2026-09-08

### Changed
- Window glow lamps are now configured **per room** (App settings → Devices → Rooms & lights): every Homey room
  containing shutters lists its lamps, all ticked by default; untick or add lamps from other rooms. Replaces the
  per-shutter editor.

### Fixed
- Glow drawn as a cone from the pendant downward over the window instead of a halo at the top.

## [0.10.0] — 2026-09-08

### Added
- Shutters widget: the window shows the real sky — a continuous blend through night, dawn, day and golden hour
  computed from Homey's sunrise/sunset (permission `homey:manager:geolocation`), with sun or moon.
- Shutters widget: a ceiling pendant above each window lights up (warm glow) when a lamp that lights that room is on.
  Which lamps: App settings → Devices → shutter → **Lights** — auto (lights in the same Homey room), chosen lamps
  (e.g. Hue bulbs rather than the wall switch), or none; "apply the same to" the other shutters of the room.

### Fixed
- Slat drawing inverted: on Legrand shutters 88° is shut and 0° fully open. Open slats now show the sky between them.
- Selecting a shutter in the widget no longer shifts the layout.

## [0.9.14] — 2026-09-07

### Changed
- Shutter travel-time learning skips runs that end fully closed on orientable shutters (the gateway reports the
  position only after the slat phase, so such runs cannot be timed). Manual travel-time settings per direction
  override learning; new "Reset learned travel times" maintenance action.

## [0.9.13] — 2026-09-07

### Changed
- Widgets: readable dark theme — cards lighter than the panel, brand colour lifted for contrast, light-grey values.
- Shutter travel-time learning now measures to "position reached" instead of "motor stopped", so the slat
  re-opening phase of orientable shutters no longer inflates the time; default pace 60 s until learned.

## [0.9.12] — 2026-09-07

### Added
- Shutters learn their real travel times: every completed run of 20 % or more is timed and kept as a
  rolling average per direction (up / down), shown in the device's Advanced settings. The Shutters widget
  animates each shutter at its own learned pace — one precise pass to the target, holding until the motor
  reports stopped (looping fallback until a shutter has been learned).

## [0.9.11] — 2026-09-07

### Added
- Remote button trigger: press type (single / double / long / any) as an argument and a token. Legrand remotes report single presses only; other HomeKit buttons may report all three.

## [0.9.10] — 2026-09-07

### Added (experimental — built from the HomeKit specification, not yet verified on hardware)
- **Socket / contactor** driver: connected sockets, contactors, teleruptors, cable outlets (Outlet / Switch services).
- **Sensor** driver: motion, smoke and CO sensors (and contact sensors, should any appear over HomeKit) with battery and tamper status.
- **Colour lights**: hue, saturation and colour temperature on lights that expose them (e.g. Zigbee third-party bulbs).
- Thermostat driver also accepts the standard HomeKit *Thermostat* service (older Smarther firmware / other vendors).
- Remote button trigger supports up to 8 buttons.

## [0.9.1] — 2026-09-07

### Fixed
- Shutters widget: room names ("Living Room", "Master Bedroom", …) no longer split across lines.

## [0.9.0] — 2026-09-07

### Added
- Dashboard widgets: **Scenes** (tiles with emoji, scene pickers), **Shutters** (live-drawn shutter
  state, looping motion while moving, tap-to-select, Open / Shade / Close presets, 3-per-row grid) and
  **Heating** (profile chips, room list with flame, resume-schedule button). Native device pickers.
- Per-widget preview images per App Store guideline 1.10.
- ESLint setup (`npm run lint`) covering app JS and inline scripts; `no-shadow` enforced.

### Changed
- Scene names keep hyphenated words together; shutter cards drop redundant "shutter/blind" words.
- Discovery ignores IPv6 link-local announcements; stored IPv6 addresses are healed on start.

### Fixed
- Variable shadowing in the shutters widget, `app.js` and the thermostat device.
- Widget device selection not resolving to app devices.

## [0.8.1] — 2026-09-07

### Added
- Multiple HAP endpoints (gateway + Smarther thermostats), pairing by id/IP, pairing import.
- Smarther thermostat driver: temperature, target, heating indicator, humidity, modes
  Schedule / Manual / Frost guard / Off, status text.
- Heating plan: weekly schedule with Comfort / Eco / Night per room and Away / Frost guard
  house-wide; overrides; per-room manual holds; timeline notifications.
- Scenes with emoji icons, duplicate, select all / none.
- Settings page redesign (grouped lists), Gateways tab with help and expert section.

## [0.1.0] — 2026-09-06

### Added
- Initial release: local control of the Legrand gateway via HAP — lights, shutters with slat
  tilt in degrees, wireless remotes; scenes; settings page with log.
