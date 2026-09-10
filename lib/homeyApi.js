'use strict';

const { HomeyAPI } = require('homey-api');

/** Shared Homey Web API access (permission homey:manager:api) with a short-lived snapshot of devices and zones. */
let apiPromise = null;
let cache = { t: 0, devices: null, zones: null };

async function api(homey) {
  if (!apiPromise) {
    apiPromise = (async () => {
      const a = await HomeyAPI.createAppAPI({ homey });
      // Zones connected: the cache updates on zone.update realtime events and zones rarely change.
      // Devices deliberately NOT connected — a connected devices manager serves cached items whose
      // capabilitiesObj is only patched on device.update events, not on capability changes, so all
      // lamp/shutter states freeze (see README Dead ends). Live values need the full fetch.
      try { if (typeof a.zones.connect === 'function') await a.zones.connect(); } catch { /* fall back to plain fetches */ }
      return a;
    })();
  }
  return apiPromise;
}

async function snapshot(homey, maxAgeMs = 4000) {
  if (Date.now() - cache.t < maxAgeMs && cache.devices) return cache;
  const a = await api(homey);
  const [devices, zones] = await Promise.all([a.devices.getDevices(), a.zones.getZones()]);
  cache = { t: Date.now(), devices, zones };
  return cache;
}

/** A room is a zone plus everything below it. */
function zoneTree(zones, zoneId) {
  const ids = new Set([zoneId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const z of Object.values(zones)) if (z.parent && ids.has(z.parent) && !ids.has(z.id)) { ids.add(z.id); grew = true; }
  }
  return ids;
}

const zoneName = (zones, id) => (zones[id] && zones[id].name) || '';
/** The room a zone belongs to: the zone two levels below the root (Home › Floor › Room); deeper zones are areas inside the room. */
function roomZone(zones, id) {
  let z = zones[id];
  if (!z) return id;
  const chain = []; while (z) { chain.unshift(z); z = z.parent ? zones[z.parent] : null; }
  return chain[Math.min(2, chain.length - 1)].id;
}
const zonePath = (zones, id) => { const out = []; let z = zones[id]; while (z) { out.unshift(z.name); z = z.parent ? zones[z.parent] : null; } return out.slice(1).join(' › '); };  // drop "Home"
const isLight = (d) => d.class === 'light' || d.virtualClass === 'light';
/** A device that belongs to this app (either driver field may carry the app id; serial match as a fallback). */
function isOurs(homey, d) {
  if (/com\.legrand\.hap/.test(String((d && d.driverId) || ''))) return true;
  const serial = d && d.data && d.data.serial;
  if (!serial) return false;
  try { return homey.drivers.getDrivers && Object.values(homey.drivers.getDrivers()).some((dr) => dr.getDevices().some((x) => x.getData().serial === serial)); } catch { return false; }
}
const cap = (d, id) => (d.capabilitiesObj && d.capabilitiesObj[id]) || null;
const capValue = (d, id) => { const c = cap(d, id); return c ? c.value : undefined; };
const isOn = (d) => !!(d.available !== false && capValue(d, 'onoff'));

async function setCapability(homey, deviceId, capabilityId, value) {
  return (await api(homey)).devices.setCapabilityValue({ deviceId, capabilityId, value });
}

/** Homey moods (light scenes per zone), or [] when unsupported. */
let moodsCache = { t: 0, list: null };
async function moods(homey, maxAgeMs = 5000) {
  // several widget instances poll in parallel; one fetch serves them all
  if (Date.now() - moodsCache.t < maxAgeMs && moodsCache.list) return moodsCache.list;
  try {
    const a = await api(homey);
    moodsCache = { t: Date.now(), list: a.moods ? Object.values(await a.moods.getMoods()) : [] };
  } catch { moodsCache = { t: Date.now() - (maxAgeMs - 2000), list: moodsCache.list || [] }; }
  return moodsCache.list;
}
/**
 * Apply a mood. Apps may read moods but are not allowed to set them ("Missing Scopes"), so the mood's
 * stored device states are applied one by one through the normal capability calls instead.
 */
async function setMood(homey, id) {
  const a = await api(homey);
  if (!a.moods) throw new Error('Moods are not available on this Homey');
  const mood = await a.moods.getMood({ id });
  const states = mood && mood.devices ? Object.entries(mood.devices) : [];
  if (!states.length) throw new Error('This mood has no device states');
  // Homey stores each device's target as { state: { onoff, dim, light_mode, light_temperature, light_hue, light_saturation } }
  const order = ['onoff', 'light_mode', 'dim', 'light_temperature', 'light_hue', 'light_saturation'];
  const results = await Promise.allSettled(states.map(async ([deviceId, entry]) => {
    const state = (entry && entry.state) || {};
    const keys = Object.keys(state).filter((k) => ['boolean', 'number', 'string'].includes(typeof state[k])).sort((x, y) => order.indexOf(x) - order.indexOf(y));
    for (const k of keys) {
      // skip colour keys for a lamp in white mode (and vice versa) — sending both makes some lamps flip back
      if (state.light_mode === 'temperature' && (k === 'light_hue' || k === 'light_saturation')) continue;
      if (state.light_mode === 'color' && k === 'light_temperature') continue;
      await a.devices.setCapabilityValue({ deviceId, capabilityId: k, value: state[k] });
    }
  }));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length === states.length) throw new Error(failed[0].reason && failed[0].reason.message);
  return mood;
}

module.exports = { api, snapshot, zoneTree, zoneName, zonePath, roomZone, isLight, isOurs, cap, capValue, isOn, setCapability, moods, setMood };
