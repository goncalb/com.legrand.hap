'use strict';

module.exports = {
  async getLog({ homey, query }) { return homey.app.logger.get({ serial: query.device, limit: Number(query.limit) || 200 }); },
  async clearLog({ homey }) { homey.app.logger.clear(); return true; },

  async getDevices({ homey }) {
    const homeyBySerial = new Map();
    for (const driver of Object.values(homey.drivers.getDrivers())) {
      for (const dev of driver.getDevices()) {
        const serial = dev.getData() && dev.getData().serial;
        if (serial) homeyBySerial.set(serial, { homeyName: dev.getName() });
      }
    }
    const names = homey.settings.get('names') || {};
    const order = { gateway: 0, thermostat: 1, shutter: 2, light: 3, remote: 4, unknown: 9 };
    const statusOf = (a) => {
      const c = a.chars;
      if (a.klass === 'shutter') {
        const pos = c.CurrentPosition ? c.CurrentPosition.value : null;
        const tilt = c.CurrentHorizontalTiltAngle ? c.CurrentHorizontalTiltAngle.value : null;
        const st = c.PositionState ? c.PositionState.value : 2;
        let t = pos == null ? '' : `${Math.round(pos)} %`;
        if (tilt != null) t += ` · ${Math.round(tilt)}°`;
        if (st === 1) t += ' ▲'; else if (st === 0) t += ' ▼';
        return t;
      }
      if (a.klass === 'light') {
        if (!c.On) return '';
        let t = c.On.value ? 'On' : 'Off';
        if (c.Brightness && c.On.value) t += ` · ${c.Brightness.value} %`;
        return t;
      }
      if (a.klass === 'remote') return c.StatusLowBattery ? (c.StatusLowBattery.value === 1 ? 'Battery low' : 'Battery ok') : '';
      if (a.klass === 'thermostat') {
        const cur = c.CurrentTemperature ? c.CurrentTemperature.value : null;
        const tgt = c.HeatingThresholdTemperature ? c.HeatingThresholdTemperature.value : null;
        const heating = c.CurrentHeaterCoolerState && c.CurrentHeaterCoolerState.value === 2;
        const active = c.Active ? c.Active.value === 1 : true;
        let t = cur == null ? '' : `${cur} °C`;
        if (tgt != null) t += ` → ${tgt} °C`;
        if (!active) t += ' (off)'; else if (tgt != null && tgt <= 7) t += ' (frost guard)';
        if (active && heating) t += ' · heating';
        return t;
      }
      return '';
    };
    return homey.app.session.listAccessories().map((a) => {
      const h = homeyBySerial.get(a.serial);
      const klass = (a.aid === 1 && a.klass === 'unknown') ? 'gateway' : a.klass;
      return {
        serial: a.serial, name: a.name, friendlyName: names[a.serial] || null, homeyName: h ? h.homeyName : null, added: !!h,
        model: a.model, firmware: a.firmware, aid: a.aid, klass, endpoint: a.endpoint,
        hasTilt: !!a.chars.TargetHorizontalTiltAngle, hasDim: !!a.chars.Brightness,
        status: klass === 'gateway' ? (homey.app.session.isConnected(a.serial) ? 'connected' : 'offline') : statusOf(a),
      };
    }).sort((x, y) => (order[x.klass] ?? 9) - (order[y.klass] ?? 9)
      || String(x.homeyName || x.friendlyName || x.name).localeCompare(String(y.homeyName || y.friendlyName || y.name)));
  },

  async identify({ homey, body }) { await homey.app.session.identify(body.serial); return true; },
  async refresh({ homey }) { await homey.app.session.refreshAll('manual refresh'); return true; },

  async setName({ homey, body }) {
    const names = homey.settings.get('names') || {};
    const name = String(body.name || '').trim();
    if (name) names[body.serial] = name; else delete names[body.serial];
    homey.settings.set('names', names);
    return { serial: body.serial, name: name || null };
  },

  /* ----- endpoints (gateways / standalone HAP devices) ----- */
  async listEndpoints({ homey }) {
    return { endpoints: homey.app.session.listEndpoints(), discovered: homey.app.session.listDiscovered({ all: true }) };
  },

  // Import hap-controller pairing data: whole pairings.json ({ "<id>": {...}, ... }) or one inner object + id.
  async importPairing({ homey, body }) {
    const parsed = typeof body.json === 'string' ? JSON.parse(body.json) : body.json;
    const entries = [];
    const isId = (k) => /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(k);
    if (parsed && Object.keys(parsed).every(isId)) for (const [id, p] of Object.entries(parsed)) entries.push([id.toUpperCase(), p]);
    else if (body.id) entries.push([String(body.id).toUpperCase(), parsed]);
    else throw new Error('Paste the whole pairings.json, or provide the device id');
    const added = [];
    for (const [id, pairing] of entries) {
      if (!pairing || !pairing.AccessoryPairingID || !pairing.iOSDeviceLTSK) throw new Error(`${id}: not hap-controller pairing data`);
      const disc = homey.app.session.discovered.get(id);
      await homey.app.session.addEndpoint(id, { pairing, address: disc ? { address: disc.address, port: disc.port } : (body.address || null), name: disc ? disc.name : null });
      added.push(id);
    }
    return { added };
  },

  async pairDevice({ homey, body }) {
    let address = null;
    if (body.address) {
      const m = String(body.address).trim().match(/^([0-9.]+|[a-zA-Z0-9.-]+?)(?::(\d+))?$/);
      if (!m) throw new Error('Enter an IP, e.g. 192.168.1.80 or 192.168.1.80:5001');
      address = { address: m[1], port: m[2] ? Number(m[2]) : 5001 };
    }
    await homey.app.session.pair(body.id, body.pin, address);
    return true;
  },
  async removeEndpoint({ homey, body }) { return homey.app.session.removeEndpoint(body.id); },

  async setEndpointAddress({ homey, body }) {
    const m = String(body.address || '').trim().match(/^([0-9.]+|[a-zA-Z0-9.-]+?)(?::(\d+))?$/);
    if (!m) throw new Error('Enter an IP, e.g. 192.168.1.72 or 192.168.1.72:5001');
    const addr = { address: m[1], port: m[2] ? Number(m[2]) : 5001 };
    homey.app.session.setAddress(body.id, addr);
    homey.app.hlog('info', null, `Manual address for ${body.id}: ${addr.address}:${addr.port}`);
    return addr;
  },

  /* ----- heating plan ----- */
  async getHeating({ homey }) {
    const cfg = homey.app.heating.get();
    const rooms = [];
    try {
      for (const dev of homey.drivers.getDriver('thermostat').getDevices()) {
        const serial = dev.getData().serial;
        rooms.push({ serial, name: dev.getName(), target: dev.getCapabilityValue('target_temperature'),
          manual: homey.app.heating.isManual(serial), ...(cfg.rooms[serial] || { follow: true, temps: { comfort: 20, eco: 18.5, night: 17 } }) });
      }
    } catch { /* ignore */ }
    return { config: cfg, rooms, status: homey.app.heating.status() };
  },
  async saveHeating({ homey, body }) { return homey.app.heating.save(body.config); },
  async heatingOverride({ homey, body }) { await homey.app.heating.setOverride(body.profile, body.duration); return homey.app.heating.status(); },
  async heatingResume({ homey }) { await homey.app.heating.resume(); return homey.app.heating.status(); },

  /* ----- scenes ----- */
  async getScenes({ homey }) { return homey.app.scenes.list(); },
  async saveScenes({ homey, body }) { return homey.app.scenes.save(body.scenes); },
  async captureScene({ homey }) { return homey.app.scenes.capture(); },
  async runScene({ homey, body }) { await homey.app.scenes.run(body.id); return true; },
};
