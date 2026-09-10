'use strict';

const H = require('./homeyApi');

/**
 * Which lamps light a room (window glow in the Shutters widget).
 * Config (app setting 'roomLights'): { [zoneId]: { excluded: [deviceId], extra: [deviceId] } }
 * Default for every room: all light-class devices in that zone and its sub-zones.
 */
const config = (homey) => homey.settings.get('roomLights') || {};
const findBySerial = (devices, serial) => Object.values(devices).find((d) => d.data && d.data.serial === serial) || null;

function lampsForZone(devices, zones, zoneId, cfg) {
  const c = cfg[zoneId] || { excluded: [], extra: [] };
  const inRoom = H.zoneTree(zones, zoneId);
  const own = Object.values(devices).filter((d) => inRoom.has(d.zone) && H.isLight(d) && !(c.excluded || []).includes(d.id));
  const extra = (c.extra || []).map((id) => devices[id]).filter(Boolean);
  return [...own, ...extra];
}

async function lightOn(homey, shutterSerial, zoneOverride) {
  try {
    const { devices, zones } = await H.snapshot(homey);
    let zone = zoneOverride || null;
    if (!zone) {
      const me = findBySerial(devices, shutterSerial);
      if (!me || !me.zone) return false;
      zone = me.zone;
    }
    return lampsForZone(devices, zones, zone, config(homey)).some(H.isOn);
  } catch { return false; }
}

async function rooms(homey) {
  const { devices, zones } = await H.snapshot(homey);
  const cfg = config(homey);
  const zoneName = (id) => H.zoneName(zones, id) || 'Unassigned';
  const shutters = Object.values(devices).filter((d) => d.class === 'windowcoverings' && d.data && d.data.serial);
  const byZone = new Map();
  for (const s of shutters) { if (!byZone.has(s.zone)) byZone.set(s.zone, []); byZone.get(s.zone).push(s.name); }
  const allLights = Object.values(devices).filter(H.isLight);
  const out = [];
  for (const [zoneId, names] of byZone) {
    const c = cfg[zoneId] || { excluded: [], extra: [] };
    const inRoom = H.zoneTree(zones, zoneId);
    const own = allLights.filter((d) => inRoom.has(d.zone)).map((d) => ({ id: d.id, name: d.name, on: H.isOn(d), checked: !(c.excluded || []).includes(d.id), zone: d.zone === zoneId ? '' : zoneName(d.zone) }))
      .sort((a, b) => a.zone.localeCompare(b.zone) || a.name.localeCompare(b.name));
    const extra = (c.extra || []).map((id) => devices[id]).filter(Boolean).map((d) => ({ id: d.id, name: d.name, zone: zoneName(d.zone), on: H.isOn(d) }));
    const others = allLights.filter((d) => !inRoom.has(d.zone) && !(c.extra || []).includes(d.id)).map((d) => ({ id: d.id, name: d.name, zone: zoneName(d.zone) }))
      .sort((a, b) => a.zone.localeCompare(b.zone) || a.name.localeCompare(b.name));
    out.push({ zoneId, zone: zoneName(zoneId), shutters: names, lights: own, extra, others });
  }
  return out.sort((a, b) => a.zone.localeCompare(b.zone));
}

function save(homey, zoneId, { excluded = [], extra = [] } = {}) {
  const all = config(homey);
  all[zoneId] = { excluded: Array.isArray(excluded) ? excluded : [], extra: Array.isArray(extra) ? extra : [] };
  homey.settings.set('roomLights', all);
  return all[zoneId];
}

module.exports = { lightOn, rooms, save };
