'use strict';
const widgetDevices = require('../../lib/widgetDevices');
module.exports = {
  async getState({ homey, query }) {
    const ids = query.ids ? String(query.ids).split(',').filter(Boolean) : [];
    const h = homey.app.heating;
    const status = h.status();
    let rooms = [];
    try {
      rooms = (await widgetDevices(homey, 'thermostat', ids)).map((d) => {
        const serial = d.getData().serial;
        const rs = h.roomState(serial);
        return { id: serial, name: d.getName(), temp: d.getCapabilityValue('measure_temperature'), target: d.getCapabilityValue('target_temperature'),
          heating: !!d.getCapabilityValue('thermostat_heating'), mode: d.getCapabilityValue('thermostat_mode'),
          manualUntil: rs.manual ? rs.manualUntil : null, follows: rs.follows };
      });
    } catch { /* ignore */ }
    return { status, rooms };
  },
  async override({ homey, body }) { await homey.app.heating.setOverride(body.profile, body.duration || 'next'); return true; },
  async resume({ homey }) { await homey.app.heating.resume(); return true; },
};
