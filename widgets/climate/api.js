'use strict';
const H = require('../../lib/homeyApi');

const PROF = { comfort: 'Comfort', eco: 'Eco', night: 'Night', away: 'Away', frost: 'Frost guard' };
const enumOpts = (d, id) => { const c = H.cap(d, id); return c ? { value: c.value, values: (c.values || []).map((v) => ({ id: v.id, title: (v.title && (v.title.en || v.title)) || v.id })) } : null; };
const num = (d, id) => { const c = H.cap(d, id); return c && typeof c.value === 'number' ? c.value : null; };
const bool = (d, id) => { const c = H.cap(d, id); return c ? !!c.value : null; };
const has = (d, id) => !!H.cap(d, id);

function ours(homey, d) {
  if (!d.data || !d.data.serial) return null;
  try { return homey.drivers.getDriver('thermostat').getDevices().find((x) => x.getData().serial === d.data.serial) || null; } catch { return null; }
}

module.exports = {
  async getClimate({ homey, query }) {
    const ids = query.ids ? String(query.ids).split(',').filter(Boolean) : [];
    const { devices, zones } = await H.snapshot(homey);
    const list = ids.length ? ids.map((id) => devices[id]).filter(Boolean) : Object.values(devices).filter((d) => d.class === 'thermostat');
    const heating = homey.app.heating;
    const status = heating.status();
    return list.map((d) => {
      const mine = ours(homey, d);
      const t = H.cap(d, 'target_temperature');
      const mode = enumOpts(d, 'thermostat_mode');
      const modeVal = mode ? mode.value : null;
      // what is the unit doing right now?
      let action = 'idle';
      if (d.available === false) action = 'unavailable';
      else if (has(d, 'onoff') && bool(d, 'onoff') === false) action = 'off';
      else if (modeVal === 'off') action = 'off';
      else if (bool(d, 'thermostat_heating')) action = 'heating';
      else if (modeVal === 'cool') action = 'cooling';
      else if (modeVal === 'heat' || modeVal === 'auto') action = 'idle';
      const plan = mine ? { serial: d.data.serial, ...heating.roomState(d.data.serial), profiles: Object.keys(PROF).filter((p) => p !== 'frost' && p !== 'away'), planName: status.plan } : null;
      const isAc = !!mode && (mode.values || []).some((v) => v.id === 'cool');
      return {
        id: d.id, name: d.name, zone: H.zoneName(zones, d.zone),
        temp: num(d, 'measure_temperature'), target: t ? t.value : null, min: t ? (t.min ?? (isAc ? 16 : 5)) : 5, max: t ? (t.max ?? 30) : 30, step: t ? (t.step ?? 0.5) : 0.5,
        humidity: num(d, 'measure_humidity'), outside: num(d, 'measure_temperature.outside'),
        onoff: has(d, 'onoff') ? bool(d, 'onoff') : null,
        mode, fan: enumOpts(d, 'thermostat_fan_speed'), swing: enumOpts(d, 'thermostat_swing_mode'),
        eco: has(d, 'thermostat_eco') ? bool(d, 'thermostat_eco') : null, boost: has(d, 'thermostat_boost') ? bool(d, 'thermostat_boost') : null,
        action, isAc, ours: !!mine, plan,
      };
    });
  },
  async setTarget({ homey, body }) { await H.setCapability(homey, body.id, 'target_temperature', Number(body.value)); return true; },
  async setValue({ homey, body }) {
    const allowed = ['thermostat_mode', 'thermostat_fan_speed', 'thermostat_swing_mode', 'thermostat_eco', 'thermostat_boost', 'onoff'];
    if (!allowed.includes(body.cap)) throw new Error('Not allowed');
    await H.setCapability(homey, body.id, body.cap, body.value); return true;
  },
  async profile({ homey, body }) { return homey.app.heating.setRoomProfile(body.serial, body.profile); },
  async rejoin({ homey, body }) { return homey.app.heating.rejoin(body.serial); },
};
