'use strict';
const widgetDevices = require('../../lib/widgetDevices');
const { skyPalette } = require('../../lib/sun');
const roomLights = require('../../lib/roomLights');
const H = require('../../lib/homeyApi');
const weather = require('../../lib/weather');

function sky(homey) {
  let lat = null, lon = null;
  try { lat = homey.geolocation.getLatitude(); lon = homey.geolocation.getLongitude(); } catch { /* no permission: fixed times */ }
  return skyPalette(new Date(), lat, lon);
}

module.exports = {
  async getShutters({ homey, query }) {
    const ids = query.ids ? String(query.ids).split(',').filter(Boolean) : [];
    const list = await widgetDevices(homey, 'shutter', ids);
    const wantLights = query.lamp !== '0';
    const awCfg = (d) => {
      if (d.getSetting('look') !== 'awning') return null;
      const c = d.getStoreValue('awn_config') || {};
      return { n: c.n === 2 ? 2 : 1, z1: c.z1 || d.getStoreValue('interior_zone') || null, t1: c.t1 || 'window', z2: c.z2 || null, t2: c.t2 || 'window' };
    };
    const lights = wantLights ? await Promise.all(list.map(async (d) => {
      const c = awCfg(d);
      if (!c) return { l1: await roomLights.lightOn(homey, d.getData().serial), l2: null };
      const l1 = await roomLights.lightOn(homey, d.getData().serial, c.z1);
      const l2 = c.z2 ? await roomLights.lightOn(homey, d.getData().serial, c.z2) : null;
      return { l1, l2 };
    })) : list.map(() => ({ l1: false, l2: null }));
    const palette = sky(homey);
    palette.weather = await weather.current(homey);
    const { devices: all, zones } = await H.snapshot(homey);
    const bySerial = new Map(Object.values(all).filter((x) => x.data && x.data.serial).map((x) => [x.data.serial, x]));
    const roomOf = (serial) => {
      const hd = bySerial.get(serial);
      if (!hd || !hd.zone) return { room: '', roomName: '' };
      const r = H.roomZone(zones, hd.zone);
      return { room: r, roomName: H.zoneName(zones, r) };
    };
    return { sky: palette, shutters: list.map((d, i) => ({
      light: lights[i].l1, ...roomOf(d.getData().serial),
      id: d.getData().serial, name: d.getName(),
      look: d.getSetting('look') || 'shutter', invert: !!d.getSetting('awning_invert'),
      aw: (() => { const c = awCfg(d); return c ? { n: c.n, t1: c.t1, t2: c.t2, l2: lights[i].l2 } : null; })(),
      position: Math.round((d.getCapabilityValue('windowcoverings_set') || 0) * 100),   // already physical (device inverts)
      tilt: d.hasCapability('shutter_tilt') ? d.getCapabilityValue('shutter_tilt') : null,
      moving: !!d.getCapabilityValue('shutter_moving'),
      direction: d._direction ? (d._inverted() ? (d._direction === 'up' ? 'down' : 'up') : d._direction) : null,
      travelUp: d.travelTime('up'), travelDown: d.travelTime('down'),   // learned seconds per full run (null = default)
      target: (() => { const a = d.acc(); const t = a && a.chars.TargetPosition; return t ? d.physOf(Math.round(t.value)) : null; })(),
    })) };
  },
  async preset({ homey, body }) {
    let list = await widgetDevices(homey, 'shutter', body.ids || []);
    // optional explicit selection (serials) made by tapping cards in the widget
    if (Array.isArray(body.serials) && body.serials.length) list = list.filter((d) => body.serials.includes(d.getData().serial));
    const shade = Number(body.shade) || 44;
    if (!list.length) throw new Error('No shutters matched the selection');
    const results = await Promise.allSettled(list.map(async (d) => {
      const awning = d.getSetting('look') === 'awning';
      // raw TargetPosition for a physical coverage (0 = clear, 100 = covered/extended); the device
      // helper handles inverted awnings
      const rawFor = (cover) => d.rawOf(awning ? cover : 100 - cover);
      // physical-rocker behaviour: pressing the direction it is already moving in stops it
      const dir = d._moving ? d._direction : null;
      if (dir && (body.preset === 'open' || body.preset === 'close')) {
        const rawTarget = body.preset === 'open' ? rawFor(0) : rawFor(100);
        const sameWay = (rawTarget === 100 && dir === 'up') || (rawTarget === 0 && dir === 'down');
        if (sameWay) return d.stopApproximate();
      }
      if (body.preset === 'open') return d.hap.setChar(d.serial, 'TargetPosition', rawFor(0));
      if (body.preset === 'close') return d.hap.setChar(d.serial, 'TargetPosition', rawFor(100));
      if (body.preset === 'shade') {
        if (awning) return d.hap.setChar(d.serial, 'TargetPosition', rawFor(50));
        return d.hasTilt() ? d.setPositionAndTilt(0, shade) : d.hap.setChar(d.serial, 'TargetPosition', 0);
      }
      throw new Error('unknown preset');
    }));
    const failed = results.map((r, i) => r.status === 'rejected' ? `${list[i].getName()}: ${r.reason && r.reason.message}` : null).filter(Boolean);
    if (failed.length) homey.app.hlog('warn', null, `widget preset ${body.preset}: ${failed.join(' | ')}`);
    return { ok: list.length - failed.length, failed: failed.join(' | ') };
  },
};
