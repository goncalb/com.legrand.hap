'use strict';

const H = require('./homeyApi');

/**
 * Resolve the Homey device ids selected in a widget's "devices" setting to this app's Device instances,
 * in the user's selection order. Empty selection = all devices of the driver.
 */
module.exports = async function widgetDevices(homey, driverId, ids) {
  let devices = [];
  try { devices = homey.drivers.getDriver(driverId).getDevices(); } catch { return []; }
  if (!Array.isArray(ids) || !ids.length) return devices;
  const { devices: all } = await H.snapshot(homey);
  const bySerial = new Map(devices.map((d) => [d.getData().serial, d]));
  const out = [];
  for (const id of ids) {
    const info = all[id];
    const serial = info && info.data && info.data.serial;
    if (serial && bySerial.has(serial)) out.push(bySerial.get(serial));
  }
  return out;
};
