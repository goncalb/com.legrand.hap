'use strict';
const HapDevice = require('../../lib/HapDevice');

class RemoteDevice extends HapDevice {

  async sync() {
    const acc = await super.sync();
    if (!acc) return null;
    if (acc.chars.StatusLowBattery) {
      await this.setCapabilityValue('alarm_battery', acc.chars.StatusLowBattery.value === 1).catch(this.error);
    }
    return acc;
  }

  async onChar(type, value) {
    if (type === 'ButtonEvent') {
      await this.driver.buttonTrigger.trigger(this, { }, { button: value }).catch(this.error);
    } else if (type === 'StatusLowBattery') {
      await this.setCapabilityValue('alarm_battery', value === 1).catch(this.error);
    }
  }
}

module.exports = RemoteDevice;
