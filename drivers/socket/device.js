'use strict';
const HapDevice = require('../../lib/HapDevice');

/** Outlet / Switch services: connected sockets, contactors (heavy loads), teleruptors, cable outlets. */
class SocketDevice extends HapDevice {

  async onInit() {
    this.registerCapabilityListener('onoff', async (value) => {
      await this.hap.setChar(this.serial, 'On', !!value);
    });
    await super.onInit();
  }

  async sync() {
    const acc = await super.sync();
    if (!acc) return null;
    if (acc.chars.On) await this.setCapabilityValue('onoff', !!acc.chars.On.value).catch(this.error);
    return acc;
  }

  async onChar(type, value) {
    if (type === 'On') await this.setCapabilityValue('onoff', !!value).catch(this.error);
  }
}

module.exports = SocketDevice;
