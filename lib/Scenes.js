'use strict';

const H = require('./homeyApi');

/**
 * App-level scenes: named sets of target states for shutters and lights,
 * stored in app settings under 'scenes' and executed locally via the devices.
 *
 * scene = { id, name, entries: [ { serial, klass, position?, tilt?, on? } ] }
 */
class Scenes {
  constructor(homey, log) {
    this.homey = homey;
    this.log = log;
  }

  list() { return this.homey.settings.get('scenes') || []; }

  save(scenes) {
    if (!Array.isArray(scenes)) throw new Error('scenes must be an array');
    for (const s of scenes) {
      if (!s.id) s.id = `scene_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      if (!s.name) throw new Error('Every scene needs a name');
      s.icon = typeof s.icon === 'string' ? s.icon.trim().slice(0, 4) : '';
      s.entries = Array.isArray(s.entries) ? s.entries : [];
      s.lights = Array.isArray(s.lights) ? s.lights : [];   // any Homey light: { kind: 'lamp'|'roomOff'|'mood', ... }
      s.climate = Array.isArray(s.climate) ? s.climate : []; // any Homey thermostat/AC: { id, mode?, target?, fan?, on? }
    }
    this.homey.settings.set('scenes', scenes);
    return scenes;
  }

  get(id) { return this.list().find((s) => s.id === id) || null; }

  /** All added Homey devices keyed by serial, with their driver id. */
  _devicesBySerial() {
    const map = new Map();
    for (const [driverId, driver] of Object.entries(this.homey.drivers.getDrivers())) {
      for (const dev of driver.getDevices()) {
        const serial = dev.getData() && dev.getData().serial;
        if (serial) map.set(serial, { dev, driverId });
      }
    }
    return map;
  }

  /** Snapshot of the current state of every added shutter/light (for "capture"). */
  capture() {
    const out = [];
    for (const [serial, { dev, driverId }] of this._devicesBySerial()) {
      if (driverId === 'shutter') {
        const pos = dev.getCapabilityValue('windowcoverings_set');
        out.push({
          serial, klass: 'shutter', name: dev.getName(),
          position: pos == null ? null : Math.round(pos * 100),
          tilt: dev.hasCapability('shutter_tilt') ? dev.getCapabilityValue('shutter_tilt') : null,
          hasTilt: dev.hasCapability('shutter_tilt'),
        });
      } else if (driverId === 'light') {
        out.push({ serial, klass: 'light', name: dev.getName(), on: !!dev.getCapabilityValue('onoff') });
      } else if (driverId === 'thermostat') {
        out.push({ serial, klass: 'thermostat', name: dev.getName(),
          target: dev.getCapabilityValue('target_temperature'), mode: dev.getCapabilityValue('thermostat_mode') || 'heat' });
      }
    }
    return out.sort((a, b) => a.klass.localeCompare(b.klass) || a.name.localeCompare(b.name));
  }

  async run(id) {
    const scene = this.get(id);
    if (!scene) throw new Error('Scene not found');
    const devices = this._devicesBySerial();
    this.log('info', null, `Scene "${scene.name}": ${scene.entries.length} device(s)`);

    const results = await Promise.allSettled(scene.entries.map(async (e) => {
      const hit = devices.get(e.serial);
      if (!hit) throw new Error(`${e.serial} not added in Homey`);
      const { dev, driverId } = hit;
      if (driverId === 'shutter') {
        if (e.position != null && e.tilt != null && dev.hasTilt && dev.hasTilt()) {
          await dev.setPositionAndTilt(e.position, e.tilt);
        } else if (e.position != null) {
          await dev.hap.setChar(dev.serial, 'TargetPosition', Math.round(e.position));
        } else if (e.tilt != null) {
          await dev.setTilt(e.tilt);
        }
      } else if (driverId === 'light' && e.on != null) {
        await dev.hap.setChar(dev.serial, 'On', !!e.on);
      } else if (driverId === 'thermostat') {
        if (e.mode === 'off') await dev._setActive(false);
        else { await dev._setActive(true); if (e.target != null) await dev._writeSetpoint(Number(e.target)); }
      }
    }));

    // lights on Homey (any app) via the Web API
    const lightResults = await Promise.allSettled((scene.lights || []).map(async (e) => {
      if (e.kind === 'mood') return H.setMood(this.homey, e.id);
      if (e.kind === 'roomOff') {
        const snap = await H.snapshot(this.homey, 0);
        const inRoom = H.zoneTree(snap.zones, e.zoneId);
        const lamps = Object.values(snap.devices).filter((d) => inRoom.has(d.zone) && H.isLight(d) && H.isOn(d));
        return Promise.all(lamps.map((d) => H.setCapability(this.homey, d.id, 'onoff', false)));
      }
      if (e.kind === 'lamp') {
        await H.setCapability(this.homey, e.id, 'onoff', !!e.on);
        if (e.on) {
          if (e.dim != null) await H.setCapability(this.homey, e.id, 'dim', Math.max(0.01, Math.min(1, e.dim / 100)));
          if (e.temp != null) await H.setCapability(this.homey, e.id, 'light_temperature', e.temp);
          if (e.hue != null && e.sat != null) { await H.setCapability(this.homey, e.id, 'light_hue', e.hue); await H.setCapability(this.homey, e.id, 'light_saturation', e.sat); }
        }
      }
      return null;
    }));

    // thermostats / air conditioners on Homey (any app) via the Web API
    const climateResults = await Promise.allSettled((scene.climate || []).map(async (e) => {
      if (e.on === false) { await H.setCapability(this.homey, e.id, 'onoff', false); return null; }
      if (e.on === true) await H.setCapability(this.homey, e.id, 'onoff', true);
      if (e.mode) await H.setCapability(this.homey, e.id, 'thermostat_mode', e.mode);
      if (e.target != null) await H.setCapability(this.homey, e.id, 'target_temperature', Number(e.target));
      if (e.fan) await H.setCapability(this.homey, e.id, 'thermostat_fan_speed', e.fan);
      return null;
    }));

    const failed = [...results, ...lightResults, ...climateResults].filter((r) => r.status === 'rejected');
    for (const f of failed) this.log('warn', null, `Scene "${scene.name}": ${f.reason && f.reason.message}`);
    const total = scene.entries.length + (scene.lights || []).length + (scene.climate || []).length;
    if (failed.length === total && total) throw new Error('Nothing in the scene could be reached');
    return true;
  }
}

module.exports = Scenes;
