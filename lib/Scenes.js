'use strict';

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

    const failed = results.filter((r) => r.status === 'rejected');
    for (const f of failed) this.log('warn', null, `Scene "${scene.name}": ${f.reason && f.reason.message}`);
    if (failed.length === scene.entries.length && scene.entries.length) throw new Error('No device in the scene could be reached');
    return true;
  }
}

module.exports = Scenes;
