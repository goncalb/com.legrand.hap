'use strict';

const { HomeyAPI } = require('homey-api');

/**
 * Which lamps light a room (for the window glow in the Shutters widget).
 * Config (app setting 'roomLights'): { [zoneId]: { excluded: [deviceId], extra: [deviceId] } }
 * Default for every room: all light-class devices in that Homey zone. `excluded` unticks some,
 * `extra` adds lamps from other rooms. A shutter uses the config of the zone it is in.
 */
let apiPromise = null;
let cache = { t: 0, devices: null, zones: null };

async function api(homey) {
  if (!apiPromise) apiPromise = HomeyAPI.createAppAPI({ homey });
  return apiPromise;
}

async function snapshot(homey) {
  if (Date.now() - cache.t < 2500 && cache.devices) return cache;    // refreshed on practically every widget poll
  const a = await api(homey);
  const [devices, zones] = await Promise.all([a.devices.getDevices(), a.zones.getZones()]);
  cache = { t: Date.now(), devices, zones };
  return cache;
}

const config = (homey) => homey.settings.get('roomLights') || {};
const isLight = (d) => d.class === 'light' || d.virtualClass === 'light';
const isOn = (d) => !!(d.available !== false && d.capabilitiesObj && d.capabilitiesObj.onoff && d.capabilitiesObj.onoff.value);
const findBySerial = (devices, serial) => Object.values(devices).find((d) => d.data && d.data.serial === serial) || null;

/** Effective lamps for a zone: zone lights minus excluded, plus extras. */
function lampsForZone(devices, zoneId, cfg) {
  const c = cfg[zoneId] || { excluded: [], extra: [] };
  const own = Object.values(devices).filter((d) => d.zone === zoneId && isLight(d) && !(c.excluded || []).includes(d.id));
  const extra = (c.extra || []).map((id) => devices[id]).filter(Boolean);
  return [...own, ...extra];
}

/** true when any lamp of the shutter's room is on and reachable */
async function lightOn(homey, shutterSerial) {
  try {
    const { devices } = await snapshot(homey);
    const me = findBySerial(devices, shutterSerial);
    if (!me || !me.zone) return false;
    return lampsForZone(devices, me.zone, config(homey)).some(isOn);
  } catch { return false; }
}

/** Rooms that contain at least one of our shutters, with their lamps and current choice. */
async function rooms(homey) {
  const { devices, zones } = await snapshot(homey);
  const cfg = config(homey);
  const zoneName = (id) => (zones[id] && zones[id].name) || 'Unassigned';
  const shutters = Object.values(devices).filter((d) => d.class === 'windowcoverings' && d.data && d.data.serial);
  const byZone = new Map();
  for (const s of shutters) { if (!byZone.has(s.zone)) byZone.set(s.zone, []); byZone.get(s.zone).push(s.name); }
  const allLights = Object.values(devices).filter(isLight);
  const out = [];
  for (const [zoneId, names] of byZone) {
    const c = cfg[zoneId] || { excluded: [], extra: [] };
    const own = allLights.filter((d) => d.zone === zoneId).map((d) => ({ id: d.id, name: d.name, on: isOn(d), checked: !(c.excluded || []).includes(d.id) }));
    const extra = (c.extra || []).map((id) => devices[id]).filter(Boolean).map((d) => ({ id: d.id, name: d.name, zone: zoneName(d.zone), on: isOn(d) }));
    const others = allLights.filter((d) => d.zone !== zoneId && !(c.extra || []).includes(d.id)).map((d) => ({ id: d.id, name: d.name, zone: zoneName(d.zone) }))
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
