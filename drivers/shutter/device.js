'use strict';
const HapDevice = require('../../lib/HapDevice');

// HomeKit: position 0..100, 100 = fully open. Homey windowcoverings_set: 0..1, 1 = open.
// PositionState: 0 = closing, 1 = opening, 2 = stopped.

class ShutterDevice extends HapDevice {

  get registerIdentify() { return false; }

  async onInit() {
    this._moving = false;
    this._listeners = new Set();
    await super.onInit();
  }

  _listen(cap, fn) {
    if (this._listeners.has(cap) || !this.hasCapability(cap)) return;
    this._listeners.add(cap);
    this.registerCapabilityListener(cap, fn);
  }

  _tiltChar() {
    const acc = this.acc();
    return acc && (acc.chars.TargetHorizontalTiltAngle || acc.chars.CurrentHorizontalTiltAngle);
  }

  /** Quantise a raw degree value to the hardware's reported range/step (e.g. 0..88 step 22). */
  _quantiseDeg(deg) {
    const ch = this._tiltChar();
    const min = ch.min ?? 0, max = ch.max ?? 90, step = ch.step || 1;
    return Math.min(max, Math.max(min, Math.round((deg - min) / step) * step + min));
  }

  _pctToDeg(value) {                      // Homey 0..1 -> degrees
    const ch = this._tiltChar();
    const min = ch.min ?? 0, max = ch.max ?? 90;
    return this._quantiseDeg(min + value * (max - min));
  }

  _degToPct(deg) {                        // degrees -> Homey 0..1
    const ch = this._tiltChar();
    const min = ch.min ?? 0, max = ch.max ?? 90;
    return max === min ? 0 : (deg - min) / (max - min);
  }

  async sync() {
    const acc = await super.sync();
    if (!acc) return null;

    const hasTilt = !!acc.chars.TargetHorizontalTiltAngle;

    // Capability layout (order matters for the UI):
    //   position slider, [tilt slider in degrees], [hidden standard tilt for flows/bridging],
    //   sensors: position %, [slat angle], moving, then maintenance button
    const exposeStd = !!this.homey.settings.get('exposeStandardTilt');
    const desired = ['shutter_status', 'windowcoverings_set'];
    if (hasTilt) desired.push('shutter_tilt');
    if (hasTilt && exposeStd) desired.push('windowcoverings_tilt_set');
    desired.push('shutter_moving', 'button.identify', 'button.rebuild');
    await this.ensureCapabilities(desired);

    if (hasTilt) {
      const ch = acc.chars.TargetHorizontalTiltAngle;
      await this.setCapabilityOptions('shutter_tilt', {
        min: ch.min ?? 0, max: ch.max ?? 90, step: ch.step || 1, decimals: 0,
      }).catch(() => {});
      if (exposeStd) {
        await this.setCapabilityOptions('windowcoverings_tilt_set', {
          uiComponent: null, title: { en: 'Slat tilt (%)' },
        }).catch(() => {});
      }
    }
    await this.setSettings({ tilt: hasTilt ? 'Yes' : 'No' }).catch(() => {});

    this._listen('windowcoverings_set', async (value) => {
      await this.hap.setChar(this.serial, 'TargetPosition', Math.round(value * 100));
    });
    this._listen('shutter_tilt', async (deg) => {
      await this.hap.setChar(this.serial, 'TargetHorizontalTiltAngle', this._quantiseDeg(deg));
    });
    if (exposeStd) {
      this._listen('windowcoverings_tilt_set', async (value) => {
        await this.hap.setChar(this.serial, 'TargetHorizontalTiltAngle', this._pctToDeg(value));
      });
    }
    this._listen('button.identify', async () => this.hap.identify(this.serial));
    this._listen('button.rebuild', async () => this.rebuild());

    if (acc.chars.CurrentPosition) await this._setPosition(acc.chars.CurrentPosition.value || 0);
    if (hasTilt && acc.chars.CurrentHorizontalTiltAngle) await this._setTilt(acc.chars.CurrentHorizontalTiltAngle.value || 0);
    if (acc.chars.PositionState) await this._setMoving(acc.chars.PositionState.value);
    return acc;
  }

  /** Clean, integer-only status text for the tile indicator (avoids 56.00000000000001 %). */
  async _updateStatus() {
    if (!this.hasCapability('shutter_status')) return;
    const raw = this.getCapabilityValue('windowcoverings_set');
    const pos = raw == null ? null : raw * 100;
    const deg = this.hasCapability('shutter_tilt') ? this.getCapabilityValue('shutter_tilt') : null;
    let text = pos == null ? '' : `${Math.round(pos)} %`;
    if (deg != null) text += ` · ${Math.round(deg)}°`;
    if (this._moving) text += this._direction === 'up' ? ' ▲' : this._direction === 'down' ? ' ▼' : ' ▲▼';
    await this.setCapabilityValue('shutter_status', text.trim()).catch(this.error);
  }

  async _setPosition(pos) {
    pos = Math.round(pos);
    await this.setCapabilityValue('windowcoverings_set', pos / 100).catch(this.error);
    await this._updateStatus();
  }

  async _setTilt(deg) {
    deg = Math.round(deg);
    if (this.hasCapability('shutter_tilt')) await this.setCapabilityValue('shutter_tilt', deg).catch(this.error);
    if (this.hasCapability('windowcoverings_tilt_set')) await this.setCapabilityValue('windowcoverings_tilt_set', this._degToPct(deg)).catch(this.error);
    await this._updateStatus();
  }

  /** PositionState: 0 = closing (down), 1 = opening (up), 2 = stopped. */
  async _setMoving(state) {
    this._moving = state !== 2;
    this._direction = state === 1 ? 'up' : state === 0 ? 'down' : null;
    await this.setCapabilityValue('shutter_moving', this._moving).catch(this.error);
    await this._updateStatus();
  }

  async onChar(type, value) {
    if (type === 'CurrentPosition') await this._setPosition(value);
    else if (type === 'CurrentHorizontalTiltAngle') await this._setTilt(value);
    else if (type === 'PositionState') await this._setMoving(value);
  }

  isMoving() { return this._moving; }

  hasTilt() { return !!(this.acc() && this.acc().chars.TargetHorizontalTiltAngle); }

  async setTilt(deg) {
    if (!this.hasTilt()) throw new Error('This shutter has no slat tilt (not in Orientable mode)');
    await this.hap.setChar(this.serial, 'TargetHorizontalTiltAngle', this._quantiseDeg(Number(deg)));
    return true;
  }

  /** Wait until the shutter reports stopped (or timeout). */
  _waitUntilStopped(timeoutMs = 90000) {
    if (!this._moving) return Promise.resolve();
    return new Promise((resolve) => {
      const started = Date.now();
      const t = setInterval(() => {
        if (!this._moving || Date.now() - started > timeoutMs) { clearInterval(t); resolve(); }
      }, 500);
    });
  }

  /** Move to position first, then set slats once the motor has stopped. */
  async setPositionAndTilt(positionPct, deg) {
    await this.hap.setChar(this.serial, 'TargetPosition', Math.round(Number(positionPct)));
    if (!this.hasTilt()) return true;
    // give the gateway a moment to report movement start, then wait for it to stop
    await new Promise((r) => setTimeout(r, 1500));
    await this._waitUntilStopped();
    await this.hap.setChar(this.serial, 'TargetHorizontalTiltAngle', this._quantiseDeg(Number(deg)));
    return true;
  }
}

module.exports = ShutterDevice;
