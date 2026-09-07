'use strict';

const { HomeyAPI } = require('homey-api');

let apiPromise = null;
const serialById = new Map();   // Homey device id -> data.serial (cached for the app's lifetime)

async function api(homey) {
  if (!apiPromise) apiPromise = HomeyAPI.createAppAPI({ homey });
  return apiPromise;
}

/**
 * Resolve the Homey device ids selected in a widget's "devices" setting to this app's Device instances,
 * in the user's selection order. Empty selection = all devices of the driver.
 * Uses the Web API (permission homey:manager:api) to read each device's data.serial.
 */
module.exports = async function widgetDevices(homey, driverId, ids) {
  let devices = [];
  try { devices = homey.drivers.getDriver(driverId).getDevices(); } catch { return []; }
  if (!Array.isArray(ids) || !ids.length) return devices;

  const bySerial = new Map(devices.map((d) => [d.getData().serial, d]));
  const out = [];
  for (const id of ids) {
    let serial = serialById.get(id);
    if (!serial) {
      try {
        const info = await (await api(homey)).devices.getDevice({ id });
        serial = info && info.data && info.data.serial;
        if (serial) serialById.set(id, serial);
      } catch (e) {
        homey.app.hlog('warn', null, `widget device lookup failed for ${id}: ${e && e.message}`);
      }
    }
    if (serial && bySerial.has(serial)) out.push(bySerial.get(serial));
  }
  return out;
};
