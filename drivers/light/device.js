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
    const colour = !!(acc.chars.Hue && acc.chars.Saturation);
    const ct = !!acc.chars.ColorTemperature;
    await this.ensureCapability('dim', dimmable);
    await this.ensureCapability('light_hue', colour);
    await this.ensureCapability('light_saturation', colour);
    await this.ensureCapability('light_temperature', ct);
    await this.ensureCapability('light_mode', colour && ct);
    this._listeners = this._listeners || new Set();
    const listen = (cap, fn) => { if (!this._listeners.has(cap) && this.hasCapability(cap)) { this._listeners.add(cap); this.registerCapabilityListener(cap, fn); } };
    listen('dim', async (value) => this.hap.setChar(this.serial, 'Brightness', Math.round(value * 100)));
    listen('light_hue', async (value) => this.hap.setChar(this.serial, 'Hue', Math.round(value * 360)));
    listen('light_saturation', async (value) => this.hap.setChar(this.serial, 'Saturation', Math.round(value * 100)));
    listen('light_temperature', async (value) => this.hap.setChar(this.serial, 'ColorTemperature', this._tempToMired(value)));
    listen('light_mode', async () => true);   // mode follows whichever of colour/temperature is written last

    if (acc.chars.On) await this.setCapabilityValue('onoff', !!acc.chars.On.value).catch(this.error);
    if (dimmable) await this.setCapabilityValue('dim', (acc.chars.Brightness.value || 0) / 100).catch(this.error);
    if (colour) {
      await this.setCapabilityValue('light_hue', (acc.chars.Hue.value || 0) / 360).catch(this.error);
      await this.setCapabilityValue('light_saturation', (acc.chars.Saturation.value || 0) / 100).catch(this.error);
    }
    if (ct) await this.setCapabilityValue('light_temperature', this._miredToTemp(acc.chars.ColorTemperature.value)).catch(this.error);
    return acc;
  }

  // HomeKit colour temperature is in mireds (typically 140..500); Homey's light_temperature is 0 (cold) .. 1 (warm)
  _ctRange() { const ch = this.acc().chars.ColorTemperature; return { min: ch.min ?? 140, max: ch.max ?? 500 }; }
  _tempToMired(t) { const { min, max } = this._ctRange(); return Math.round(min + t * (max - min)); }
  _miredToTemp(m) { const { min, max } = this._ctRange(); return max === min ? 0 : Math.max(0, Math.min(1, (m - min) / (max - min))); }

  async onChar(type, value) {
    if (type === 'On') await this.setCapabilityValue('onoff', !!value).catch(this.error);
    else if (type === 'Brightness') await this.setCapabilityValue('dim', value / 100).catch(this.error);
    else if (type === 'Hue' && this.hasCapability('light_hue')) await this.setCapabilityValue('light_hue', value / 360).catch(this.error);
    else if (type === 'Saturation' && this.hasCapability('light_saturation')) await this.setCapabilityValue('light_saturation', value / 100).catch(this.error);
    else if (type === 'ColorTemperature' && this.hasCapability('light_temperature')) await this.setCapabilityValue('light_temperature', this._miredToTemp(value)).catch(this.error);
  }
}

module.exports = LightDevice;
