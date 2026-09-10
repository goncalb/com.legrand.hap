'use strict';

function calibDevice(homey, serial) {
  const d = homey.drivers.getDriver('shutter').getDevices().find((x) => x.getData().serial === serial);
  if (!d) throw new Error('Shutter not found');
  return d;
}

module.exports = {
  async getLog({ homey, query }) { return homey.app.logger.get({ serial: query.device, limit: Number(query.limit) || 200 }); },
  async clearLog({ homey }) { homey.app.logger.clear(); homey.app.logger.add('info', null, '--- log cleared: new debug session ---'); return true; },

  async getDevices({ homey }) {
    const homeyBySerial = new Map();
    for (const driver of Object.values(homey.drivers.getDrivers())) {
      for (const dev of driver.getDevices()) {
        const serial = dev.getData() && dev.getData().serial;
        if (serial) homeyBySerial.set(serial, { homeyName: dev.getName() });
      }
    }
    const names = homey.settings.get('names') || {};
    const order = { gateway: 0, thermostat: 1, shutter: 2, light: 3, socket: 4, remote: 5, sensor: 6, unknown: 9 };
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
      if (a.klass === 'socket') return c.On ? (c.On.value ? 'On' : 'Off') : '';
      if (a.klass === 'sensor') {
        const st = { contact: c.ContactSensorState && (c.ContactSensorState.value === 1 ? 'Open' : 'Closed'),
          motion: c.MotionDetected && (c.MotionDetected.value ? 'Motion' : 'No motion'),
          smoke: c.SmokeDetected && (c.SmokeDetected.value === 1 ? 'SMOKE' : 'Clear'),
          co: c.CarbonMonoxideDetected && (c.CarbonMonoxideDetected.value === 1 ? 'CO ALARM' : 'Clear') }[a.sensorType] || '';
        return st + (c.StatusLowBattery && c.StatusLowBattery.value === 1 ? ' · battery low' : '');
      }
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
    return { endpoints: homey.app.session.listEndpoints(), discovered: homey.app.session.listDiscovered({ all: true }), lastPair: homey.app.session.lastPair || null };
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
    // SRP on slow gateways can exceed the settings request timeout: run in the background,
    // the settings page polls the result via /endpoints (lastPair)
    homey.app.session.pair(body.id, body.pin, address).catch((e) => {
      homey.app.session.lastPair = { id: body.id, t: Date.now(), state: 'failed', error: (e && e.message) || String(e) };
      homey.app.hlog('error', null, `pairing ${body.id} failed: ${(e && e.message) || e}`);
    });
    return true;
  },
  async removeEndpoint({ homey, body }) { return homey.app.session.removeEndpoint(body.id); },
  // what a paired bridge exposes, and which driver would pick each item up — before adding anything
  async endpointAccessories({ homey, query }) {
    const ep = homey.app.session.endpoints.get(String(query.id || '').toUpperCase());
    if (!ep) throw new Error('Endpoint not found');
    const driverOf = { light: 'Light', shutter: 'Shutter', thermostat: 'Thermostat', socket: 'Socket', sensor: 'Sensor', remote: 'Remote', bridge: null };
    return [...ep.accessories.values()]
      .filter((a) => !(a.aid === 1 && a.klass === 'unknown'))   // the bridge's own mandatory accessory
      .map((a) => ({
      serial: a.serial, name: a.name, model: a.model, manufacturer: a.manufacturer,
      klass: a.klass, driver: driverOf[a.klass] || null,
    })).sort((x, y) => String(x.name).localeCompare(String(y.name)));
  },

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

  /* ----- Lights tab: every light on Homey, by room, with type and window-glow flag ----- */
  async getLightsTab({ homey }) {
    const H = require('./lib/homeyApi'); const L = require('./lib/lights');
    const { devices, zones } = await H.snapshot(homey);
    const glowCfg = homey.settings.get('roomLights') || {};
    const excluded = new Set(Object.values(glowCfg).flatMap((c) => c.excluded || []));
    // zones whose room (zone + sub-zones) contains a shutter → the glow switch is meaningful there
    const shutterZones = Object.values(devices).filter((d) => d.class === 'windowcoverings' && d.data && d.data.serial).map((d) => d.zone);
    const glowZones = new Set(shutterZones.flatMap((z) => [...H.zoneTree(zones, z)]));
    // a lamp belongs to its room = the zone two levels below the root (Home › Floor › Room); deeper zones are areas inside the room
    const roomOf = (zoneId) => {
      let z = zones[zoneId]; if (!z) return null;
      const chain = []; while (z) { chain.unshift(z); z = z.parent ? zones[z.parent] : null; }
      return chain[Math.min(2, chain.length - 1)];
    };
    const groups = {};
    for (const d of Object.values(devices).filter(H.isLight)) {
      const room = roomOf(d.zone);
      const key = room ? room.id : '';
      const g = groups[key] = groups[key] || { zoneId: key, path: room ? H.zonePath(zones, room.id) : 'Unassigned', hasShutters: glowZones.has(key), lights: [] };
      const area = room && d.zone !== room.id ? H.zoneName(zones, d.zone) : '';
      g.lights.push({ ...L.describe(homey, d), area, glow: !excluded.has(d.id), guessed: !(homey.settings.get('lightTypes') || {})[d.id] });
    }
    const rooms = Object.values(groups).sort((a, b) => a.path.localeCompare(b.path));
    // Group devices (Homey's Group app and similar): recognised by their driver; members come from the group's
    // settings when readable, otherwise from the names (same words as the group's name plus a number).
    const isGroupDevice = (d) => /group/i.test(String(d.driverId || ''));
    const memberIdsOf = (d) => {
      const st = d.settings || {};
      const arr = st.devices || st.groupedDevices || st.members || st.deviceIds;
      return Array.isArray(arr) ? arr.map((x) => (typeof x === 'string' ? x : x && x.id)).filter(Boolean) : null;
    };
    // name fallback: same area, other lamp shares the group's first significant word (e.g. "Perifo …")
    const firstWord = (n) => (String(n).toLowerCase().match(/[a-z]{4,}/) || [''])[0];
    for (const r of rooms) {
      for (const l of r.lights) {
        const dev = devices[l.id];
        if (!isGroupDevice(dev)) continue;
        l.group = true;
        const ids = memberIdsOf(dev);
        const fw = firstWord(l.name);
        const members = ids ? r.lights.filter((m) => ids.includes(m.id)) : (fw ? r.lights.filter((m) => m !== l && m.zone === l.zone && !m.group && firstWord(m.name) === fw) : []);
        members.forEach((m) => { m.memberOf = l.id; if (m.guessed) { m.type = l.type; m.inherited = true; } });
      }
      r.lights.sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name));
    }
    return { rooms, types: L.TYPES };
  },
  async setLightType({ homey, body }) {
    const t = homey.settings.get('lightTypes') || {};
    if (body.type) t[body.id] = body.type; else delete t[body.id];
    homey.settings.set('lightTypes', t); return true;
  },
  async setLightGlow({ homey, body }) {
    // glow flag lives in the room-lights config of the lamp's own zone (and its ancestors that list it)
    const H = require('./lib/homeyApi');
    const { devices, zones } = await H.snapshot(homey);
    const d = devices[body.id]; if (!d) throw new Error('Unknown lamp');
    const cfg = homey.settings.get('roomLights') || {};
    // every zone whose room-tree contains this lamp keeps its own excluded list; update them all
    for (const z of Object.keys(zones)) {
      if (!H.zoneTree(zones, z).has(d.zone)) continue;
      const c = cfg[z] || { excluded: [], extra: [] };
      c.excluded = (c.excluded || []).filter((x) => x !== d.id);
      if (!body.glow) c.excluded.push(d.id);
      if (c.excluded.length || (c.extra || []).length) cfg[z] = c; else delete cfg[z];
    }
    homey.settings.set('roomLights', cfg); return true;
  },

  /* ----- rooms & lights (window glow in the Shutters widget) ----- */
  async getRoomLights({ homey }) { return require('./lib/roomLights').rooms(homey); },

  // ---- Assisted shutter calibration (settings wizard) ----
  async calibShutters({ homey }) {
    return homey.drivers.getDriver('shutter').getDevices()
      .map((d) => ({ serial: d.getData().serial, name: d.getName(), tilt: d.hasTilt() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  async calibCommand({ homey, body }) {
    const d = calibDevice(homey, body.serial);
    await d.hap.setChar(d.serial, 'TargetPosition', Math.round(body.value));
    return { t: Date.now() };
  },
  async calibState({ homey, query }) {
    const d = calibDevice(homey, query.serial);
    return { t: Date.now(), moving: !!d._moving, direction: d._direction || null, position: d.getCapabilityValue('windowcoverings_set') };
  },
  // ---- Awnings: which interior room lights the drawn window ----
  async awningsList({ homey }) {
    const H = require('./lib/homeyApi');
    const { zones } = await H.snapshot(homey);
    const rooms = Object.values(zones)
      .filter((z) => z.parent && zones[z.parent] && zones[z.parent].parent && !zones[zones[z.parent].parent].parent)
      .map((z) => ({ id: z.id, name: z.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const awnings = homey.drivers.getDriver('shutter').getDevices()
      .filter((d) => d.getSetting('look') === 'awning')
      .map((d) => {
        const c = d.getStoreValue('awn_config') || {};
        return { serial: d.getData().serial, name: d.getName(),
          n: c.n === 2 ? 2 : 1, z1: c.z1 || d.getStoreValue('interior_zone') || '', t1: c.t1 || 'window', z2: c.z2 || '', t2: c.t2 || 'window' };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { awnings, rooms };
  },
  async awningsSave({ homey, body }) {
    const d = calibDevice(homey, body.serial);
    const cfg = { n: body.n === 2 ? 2 : 1, z1: body.z1 || null, t1: body.t1 || 'window', z2: body.n === 2 || body.t1 === 'sliding' ? body.z2 || null : null, t2: body.t2 || 'window' };
    await d.setStoreValue('awn_config', cfg).catch(d.error);
    await d.setStoreValue('interior_zone', cfg.z1).catch(d.error);   // legacy key stays in sync
    const tName = (t) => ({ window: 'Window', full: 'Full glass', french: 'French door', sliding: 'Sliding door', door: 'Door' }[t] || t);
    const part = (zn, t) => (zn || '?') + ' (' + tName(t) + ')';
    const summary = cfg.n === 2 ? part(body.z1Name, cfg.t1) + ' + ' + part(body.z2Name, cfg.t2) : part(body.z1Name, cfg.t1) + (cfg.z2 && body.z2Name ? ' / right pane: ' + body.z2Name : '');
    await d.setSettings({ interior_room: body.z1Name ? summary : 'not set' }).catch(d.error);
    d.log(`awning openings: ${summary}`);
    return true;
  },
  async calibSave({ homey, body }) {
    const d = calibDevice(homey, body.serial);
    const up = Math.round(body.up * 10) / 10, down = Math.round(body.down * 10) / 10;
    const holdUp = Math.max(0, Math.round(body.holdUp)), holdDown = Math.max(0, Math.round(body.holdDown));
    await d.setSettings({ travel_up_manual: up, travel_down_manual: down, end_hold: `close ${holdDown} s · open ${holdUp} s` });
    await d.setStoreValue('hold_up', holdUp).catch(d.error);
    await d.setStoreValue('hold_down', holdDown).catch(d.error);
    d.log(`assisted calibration saved: up ${up} s, down ${down} s, end hold close ${holdDown} s / open ${holdUp} s`);
    homey.notifications.createNotification({ excerpt: `Assisted calibration of **${d.getName()}** saved: up ${up} s, down ${down} s, end hold ${holdDown} s (closed) / ${holdUp} s (open).` }).catch(d.error);
    return true;
  },
  async saveRoomLights({ homey, body }) { return require('./lib/roomLights').save(homey, body.zoneId, body); },

  /* ----- scene editor: lights on Homey (any app) with their current state ----- */
  async getSceneLights({ homey }) {
    const H = require('./lib/homeyApi'); const L = require('./lib/lights');
    const { devices, zones } = await H.snapshot(homey);
    const moods = (await H.moods(homey)).map((m) => ({ id: m.id, name: m.name, zone: m.zone }));
    const byZone = {};
    for (const d of Object.values(devices).filter((x) => H.isLight(x) && !H.isOurs(homey, x))) {
      const z = byZone[d.zone] = byZone[d.zone] || { zoneId: d.zone, name: H.zonePath(zones, d.zone) || 'Unassigned', lamps: [], moods: moods.filter((m) => m.zone === d.zone) };
      const info = L.describe(homey, d);
      z.lamps.push({ id: d.id, name: d.name, type: info.type, on: info.on, dim: info.dim, hasDim: info.hasDim, hasColour: info.hasColour, hasTemp: info.hasTemp,
        hue: H.capValue(d, 'light_hue'), sat: H.capValue(d, 'light_saturation'), temp: H.capValue(d, 'light_temperature'), colour: info.colour, group: /group/i.test(String(d.driverId || '')) });
    }
    return Object.values(byZone).sort((a, b) => a.name.localeCompare(b.name)).map((z) => ({ ...z, lamps: z.lamps.sort((a, b) => (b.group ? 1 : 0) - (a.group ? 1 : 0) || a.name.localeCompare(b.name)) }));
  },

  /* ----- scene editor: climate devices on Homey (any app) except this app's own thermostats ----- */
  async getSceneClimate({ homey }) {
    const H = require('./lib/homeyApi');
    const { devices, zones } = await H.snapshot(homey);
    const opts = (d, id) => { const c = H.cap(d, id); return c ? { value: c.value, values: (c.values || []).map((v) => ({ id: v.id, title: (v.title && (v.title.en || v.title)) || v.id })) } : null; };
    return Object.values(devices).filter((d) => d.class === 'thermostat' && !H.isOurs(homey, d))
      .map((d) => ({ id: d.id, name: d.name, zone: H.zonePath(zones, d.zone) || '', target: H.capValue(d, 'target_temperature'), temp: H.capValue(d, 'measure_temperature'),
        mode: opts(d, 'thermostat_mode'), fan: opts(d, 'thermostat_fan_speed'), onoff: H.cap(d, 'onoff') ? !!H.capValue(d, 'onoff') : null,
        min: (H.cap(d, 'target_temperature') || {}).min ?? 5, max: (H.cap(d, 'target_temperature') || {}).max ?? 30, step: (H.cap(d, 'target_temperature') || {}).step ?? 0.5 }))
      .sort((a, b) => a.zone.localeCompare(b.zone) || a.name.localeCompare(b.name));
  },

  /* ----- scenes ----- */
  async getScenes({ homey }) { return homey.app.scenes.list(); },
  async saveScenes({ homey, body }) { return homey.app.scenes.save(body.scenes); },
  async captureScene({ homey }) { return homey.app.scenes.capture(); },
  async runScene({ homey, body }) { await homey.app.scenes.run(body.id); return true; },
};
