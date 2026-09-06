# Legrand with Netatmo (Local) — Homey Pro app

Local control of Legrand with Netatmo devices through the Legrand (Home + Control)
gateway using the HomeKit Accessory Protocol over IP. No cloud dependency.

## Devices

| Driver  | HAP service                        | Homey capabilities |
|---------|------------------------------------|--------------------|
| Light   | Lightbulb (On, optional Brightness) | `onoff`, `dim` (dynamic) |
| Shutter | WindowCovering (+ optional tilt)   | `windowcoverings_set`, `shutter_tilt` (degrees, dynamic), `shutter_moving`, `shutter_status` (tile text) |
| Remote  | StatelessProgrammableSwitch + Battery | `alarm_battery` + "Button pressed" trigger |

All drivers: `button.identify` (blink) and `button.rebuild` maintenance actions.

## Design

- `lib/HapSession.js`: single encrypted session, mDNS discovery with `c#` watching,
  periodic DB diff (15 min), reconnect with backoff, stored/manual gateway address.
- Devices keyed by serial; capabilities added/removed at runtime (`ensureCapabilities`)
  so mode changes on the gateway (aperture ↔ orientable) are picked up automatically.
- Tilt range/step read from the accessory (Legrand: 0..88 step 22 → 5 positions).
- Standard `windowcoverings_tilt_set` is opt-in (app setting) for HomeKit/Matter bridging.
- No stop command: Legrand exposes no HoldPosition and position-pinning does not stop travel.
- Scenes (`lib/Scenes.js`): named target states stored in app settings, Flow action
  "Activate scene". Shutters move first, then tilt once stopped.
- Energy: lights use the manifest approximation (8 W on / 0 W off); users edit per device.
- Settings page: Devices (status, blink, pre-add naming), Scenes, Log, Gateway (status,
  manual IP, pairing import, help, advanced).

## Development

```bash
npm install
homey app validate
homey app run
```

Pairing data lives in app settings (`hapPairing`, `gatewayId`, `gatewayAddress`).
The `hap-probe.js` script (separate) can pair/dump a gateway for analysis; its
`pairings.json` can be imported from the Gateway tab.
