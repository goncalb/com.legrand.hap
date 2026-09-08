# Changelog

All notable changes to this project are documented here. Versions follow [Semantic Versioning](https://semver.org/).

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
