'use strict';
const HapDevice = require('../../lib/HapDevice');

/** Contact / motion / smoke / CO sensors (HAP sensor services) with battery status. */
const MAP = {
  contact: { cap: 'alarm_contact', char: 'ContactSensorState', on: (v) => v === 1 },   // 1 = contact not detected (open)
  motion:  { cap: 'alarm_motion',  char: 'MotionDetected',     on: (v) => !!v },
  smoke:   { cap: 'alarm_smoke',   char: 'SmokeDetected',      on: (v) => v === 1 },
  co:      { cap: 'alarm_co',      char: 'CarbonMonoxideDetected', on: (v) => v === 1 },
};

class SensorDevice extends HapDevice {

  get registerIdentify() { return false; }

  async sync() {
    const acc = await super.sync();
    if (!acc) return null;
    const m = MAP[acc.sensorType];
    const desired = [];
    if (m) desired.push(m.cap);
    if (acc.chars.StatusLowBattery) desired.push('alarm_battery');
    if (acc.chars.StatusTampered) desired.push('alarm_tamper');
    desired.push('button.rebuild');
    await this.ensureCapabilities(desired);
    await this.setSettings({ kind: acc.sensorType || 'unknown' }).catch(() => {});
    if (!this._rebuildListener && this.hasCapability('button.rebuild')) { this._rebuildListener = true; this.registerCapabilityListener('button.rebuild', async () => this.rebuild()); }

    if (m && acc.chars[m.char]) await this.setCapabilityValue(m.cap, m.on(acc.chars[m.char].value)).catch(this.error);
    if (acc.chars.StatusLowBattery && this.hasCapability('alarm_battery')) await this.setCapabilityValue('alarm_battery', acc.chars.StatusLowBattery.value === 1).catch(this.error);
    if (acc.chars.StatusTampered && this.hasCapability('alarm_tamper')) await this.setCapabilityValue('alarm_tamper', acc.chars.StatusTampered.value === 1).catch(this.error);
    return acc;
  }

  async onChar(type, value) {
    const acc = this.acc(); const m = acc && MAP[acc.sensorType];
    if (m && type === m.char) await this.setCapabilityValue(m.cap, m.on(value)).catch(this.error);
    else if (type === 'StatusLowBattery' && this.hasCapability('alarm_battery')) await this.setCapabilityValue('alarm_battery', value === 1).catch(this.error);
    else if (type === 'StatusTampered' && this.hasCapability('alarm_tamper')) await this.setCapabilityValue('alarm_tamper', value === 1).catch(this.error);
  }
}

module.exports = SensorDevice;
