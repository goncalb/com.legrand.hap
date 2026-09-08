'use strict';
const H = require('../../lib/homeyApi');
const L = require('../../lib/lights');

/** A representative colour for a mood: the first colour or white-temperature value it sets on a lamp. */
function moodColour(m) {
  for (const entry of Object.values(m.devices || {})) {
    const c = (entry && entry.state) || {};
    if (c.onoff === false) continue;
    if (c.light_mode === 'color' && c.light_hue != null) return L.colourFrom({ hue: c.light_hue, sat: c.light_saturation ?? 1, temp: null });
    if (c.light_temperature != null) return L.colourFrom({ hue: null, sat: null, temp: c.light_temperature });
    if (c.light_hue != null) return L.colourFrom({ hue: c.light_hue, sat: c.light_saturation ?? 1, temp: null });
  }
  return null;
}

async function pick(homey, ids, fresh = false) {
  const { devices, zones } = await H.snapshot(homey, fresh ? 0 : undefined);
  const list = (ids && ids.length ? ids.map((id) => devices[id]).filter(Boolean) : Object.values(devices).filter(H.isLight));
  return { list, devices, zones };
}

module.exports = {
  async getLights({ homey, query }) {
    const ids = query.ids ? String(query.ids).split(',').filter(Boolean) : [];
    const { list, zones } = await pick(homey, ids, query.fresh === '1');
    const lamps = list.map((d) => ({ ...L.describe(homey, d), zoneName: H.zoneName(zones, d.zone) || 'Unassigned' }));
    const zoneIds = [...new Set(lamps.map((l) => l.zone))];
    const allMoods = query.moods === '0' ? [] : await H.moods(homey);
    const moods = allMoods.filter((m) => zoneIds.includes(m.zone)).map((m) => ({ id: m.id, name: m.name, zone: m.zone, colour: moodColour(m) }));
    return { lamps, moods };
  },
  async toggle({ homey, body }) {
    const { devices } = await H.snapshot(homey, 0);
    const d = devices[body.id]; if (!d) throw new Error('Unknown lamp');
    const on = !H.isOn(d);
    await H.setCapability(homey, d.id, 'onoff', on);
    return { on };
  },
  async allOff({ homey, body }) {
    const { list } = await pick(homey, body.ids || []);
    const targets = body.zone ? list.filter((d) => d.zone === body.zone) : list;
    await Promise.allSettled(targets.filter(H.isOn).map((d) => H.setCapability(homey, d.id, 'onoff', false)));
    return true;
  },
  async mood({ homey, body }) {
    try { const r = await H.setMood(homey, body.id); homey.app.hlog('info', null, `mood applied: ${body.id}${r && r.name ? ` (${r.name})` : ''}`); return true; } catch (e) { homey.app.hlog('warn', null, `mood ${body.id}: ${e && e.message}`); throw e; }
  },
  async set({ homey, body }) {
    const allowed = ['dim', 'light_temperature', 'light_hue', 'light_saturation', 'light_mode', 'onoff'];
    if (!allowed.includes(body.cap)) throw new Error('Not allowed');
    await H.setCapability(homey, body.id, body.cap, body.value); return true;
  },
};
