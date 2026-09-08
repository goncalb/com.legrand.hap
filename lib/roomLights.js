'use strict';

const { HomeyAPI } = require('homey-api');

/**
 * Which lamps light the room of a shutter, and whether any is on.
 * Config (app setting 'shutterLights'): { [shutterSerial]: { mode: 'auto'|'lamps'|'none', lamps: [homeyDeviceId] } }.
 * 'auto' = every light-class device in the same Homey zone as the shutter.
 */
let apiPromise = null;
let cache = { t: 0, devices: null, zones: null };

async function api(homey) {
  if (!apiPromise) apiPromise = HomeyAPI.createAppAPI({ homey });
  return apiPromise;
}

async function snapshot(homey) {
  if (Date.now() - cache.t < 8000 && cache.devices) return cache;
  const a = await api(homey);
  const [devices, zones] = await Promise.all([a.devices.getDevices(), a.zones.getZones()]);
  cache = { t: Date.now(), devices, zones };
  return cache;
}

function config(homey) { return homey.settings.get('shutterLights') || {}; }

/** Homey device (from the Web API) that corresponds to one of our devices, by data.serial. */
function findBySerial(devices, serial) {
  return Object.values(devices).find((d) => d.data && d.data.serial === serial) || null;
}

function isLight(d) { return d.class === 'light' || d.virtualClass === 'light'; }
function isOn(d) { return !!(d.available !== false && d.capabilitiesObj && d.capabilitiesObj.onoff && d.capabilitiesObj.onoff.value); }

/** Lamps linked to a shutter (device objects) according to its config. */
async function lampsFor(homey, shutterSerial) {
  const { devices } = await snapshot(homey);
  const cfg = config(homey)[shutterSerial] || { mode: 'auto' };
  if (cfg.mode === 'none') return [];
  if (cfg.mode === 'lamps') return (cfg.lamps || []).map((id) => devices[id]).filter(Boolean);
  const me = findBySerial(devices, shutterSerial);
  if (!me || !me.zone) return [];
  return Object.values(devices).filter((d) => d.zone === me.zone && isLight(d));
}

/** true when any linked lamp is on and reachable */
async function lightOn(homey, shutterSerial) {
  try { return (await lampsFor(homey, shutterSerial)).some(isOn); } catch { return false; }
}

/** Data for the settings editor: all lights grouped by zone, the shutter's zone, current config. */
async function editorData(homey, shutterSerial) {
  const { devices, zones } = await snapshot(homey);
  const me = findBySerial(devices, shutterSerial);
  const zoneName = (id) => (zones[id] && zones[id].name) || '';
  const lights = Object.values(devices).filter(isLight).map((d) => ({ id: d.id, name: d.name, zone: zoneName(d.zone), on: isOn(d) }))
    .sort((a, b) => a.zone.localeCompare(b.zone) || a.name.localeCompare(b.name));
  return { config: config(homey)[shutterSerial] || { mode: 'auto', lamps: [] }, zone: me ? zoneName(me.zone) : '', lights };
}

/** Other shutters (our devices) in the same Homey zone — for "apply the same to". */
async function siblings(homey, shutterSerial) {
  const { devices } = await snapshot(homey);
  const me = findBySerial(devices, shutterSerial);
  if (!me) return [];
  return Object.values(devices).filter((d) => d.id !== me.id && d.zone === me.zone && d.class === 'windowcoverings' && d.data && d.data.serial)
    .map((d) => ({ serial: d.data.serial, name: d.name }));
}

function save(homey, shutterSerial, cfg, applyTo = []) {
  const all = config(homey);
  const clean = { mode: ['auto', 'lamps', 'none'].includes(cfg.mode) ? cfg.mode : 'auto', lamps: Array.isArray(cfg.lamps) ? cfg.lamps : [] };
  for (const s of [shutterSerial, ...applyTo]) all[s] = clean;
  homey.settings.set('shutterLights', all);
  return all;
}

module.exports = { lightOn, editorData, siblings, save, config };
