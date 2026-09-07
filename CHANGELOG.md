# Changelog

All notable changes to this project are documented here. Versions follow [Semantic Versioning](https://semver.org/).

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
