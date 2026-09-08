'use strict';
const widgetDevices = require('../../lib/widgetDevices');
const { skyPalette } = require('../../lib/sun');
const roomLights = require('../../lib/roomLights');

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
    const lights = wantLights ? await Promise.all(list.map((d) => roomLights.lightOn(homey, d.getData().serial))) : list.map(() => false);
    const palette = sky(homey);
    return { sky: palette, shutters: list.map((d, i) => ({
      light: lights[i],
      id: d.getData().serial, name: d.getName(),
      position: Math.round((d.getCapabilityValue('windowcoverings_set') || 0) * 100),
      tilt: d.hasCapability('shutter_tilt') ? d.getCapabilityValue('shutter_tilt') : null,
      moving: !!d.getCapabilityValue('shutter_moving'),
      direction: d._direction || null,
      travelUp: d.travelTime('up'), travelDown: d.travelTime('down'),   // learned seconds per full run (null = default)
      target: (() => { const a = d.acc(); const t = a && a.chars.TargetPosition; return t ? Math.round(t.value) : null; })(),
    })) };
  },
  async preset({ homey, body }) {
    let list = await widgetDevices(homey, 'shutter', body.ids || []);
    // optional explicit selection (serials) made by tapping cards in the widget
    if (Array.isArray(body.serials) && body.serials.length) list = list.filter((d) => body.serials.includes(d.getData().serial));
    const shade = Number(body.shade) || 44;
    if (!list.length) throw new Error('No shutters matched the selection');
    const results = await Promise.allSettled(list.map(async (d) => {
      if (body.preset === 'open') return d.hap.setChar(d.serial, 'TargetPosition', 100);
      if (body.preset === 'close') return d.hap.setChar(d.serial, 'TargetPosition', 0);
      if (body.preset === 'shade') return d.hasTilt() ? d.setPositionAndTilt(0, shade) : d.hap.setChar(d.serial, 'TargetPosition', 0);
      throw new Error('unknown preset');
    }));
    const failed = results.map((r, i) => r.status === 'rejected' ? `${list[i].getName()}: ${r.reason && r.reason.message}` : null).filter(Boolean);
    if (failed.length) homey.app.hlog('warn', null, `widget preset ${body.preset}: ${failed.join(' | ')}`);
    return { ok: list.length - failed.length, failed: failed.join(' | ') };
  },
};
