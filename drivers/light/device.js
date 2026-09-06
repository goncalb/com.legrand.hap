'use strict';
const HapDevice = require('../../lib/HapDevice');

class LightDevice extends HapDevice {

  async onInit() {
    this.registerCapabilityListener('onoff', async (value) => {
      await this.hap.setChar(this.serial, 'On', !!value);
    });
    await super.onInit();
  }

  async sync() {
    const acc = await super.sync();
    if (!acc) return null;

    const dimmable = !!acc.chars.Brightness;
    await this.ensureCapability('dim', dimmable);
    if (dimmable && !this._dimListener) {
      this._dimListener = true;
      this.registerCapabilityListener('dim', async (value) => {
        await this.hap.setChar(this.serial, 'Brightness', Math.round(value * 100));
      });
    }

    if (acc.chars.On) await this.setCapabilityValue('onoff', !!acc.chars.On.value).catch(this.error);
    if (dimmable) await this.setCapabilityValue('dim', (acc.chars.Brightness.value || 0) / 100).catch(this.error);
    return acc;
  }

  async onChar(type, value) {
    if (type === 'On') await this.setCapabilityValue('onoff', !!value).catch(this.error);
    if (type === 'Brightness') await this.setCapabilityValue('dim', value / 100).catch(this.error);
  }
}

module.exports = LightDevice;
