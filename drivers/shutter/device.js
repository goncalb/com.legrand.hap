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
    desired.push('shutter_moving', 'button.identify', 'button.rebuild', 'button.reset_travel');
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

    // Flow-only "Set state" card: up = open, down = close. Legrand modules have no stop, so idle is refused.
    this._listen('windowcoverings_state', async (state) => {
      if (state === 'up') return this.hap.setChar(this.serial, 'TargetPosition', 100);
      if (state === 'down') return this.hap.setChar(this.serial, 'TargetPosition', 0);
      throw new Error('Legrand shutters cannot stop mid-way; set a position instead');
    });
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
    this._listen('button.reset_travel', async () => this.resetTravel());

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
    // A position update while a run is pending marks the end of the *travel* (the orientable shutters keep
    // the motor busy afterwards re-opening the slats, which must not count as travel time).
    if (this._runStart && this._runStart.pos != null && pos !== this._runStart.pos) await this._learnTravel(pos);
    this._lastPos = pos;
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
    const wasMoving = this._moving;
    this._moving = state !== 2;
    this._direction = state === 1 ? 'up' : state === 0 ? 'down' : null;
    if (this._moving && !wasMoving) this._runStart = { t: Date.now(), pos: this._lastPos, dir: this._direction };
    else if (!this._moving && wasMoving && this._runStart) await this._learnTravel(this._lastPos);   // fallback: no position update seen
    await this.setCapabilityValue('shutter_moving', this._moving).catch(this.error);
    if (this.hasCapability('windowcoverings_state')) await this.setCapabilityValue('windowcoverings_state', this._direction || 'idle').catch(this.error);
    await this._updateStatus();
  }

  /**
   * Travel-time learning: every run of >= 20 % is timed from "motor started" to "position reached"
   * and converted to "seconds for a full 0-100 % travel", kept as a rolling average per direction
   * (up / down differ on most motors). Used by the widget to animate at the true pace.
   */
  async _learnTravel(endPos) {
    const run = this._runStart; this._runStart = null;
    if (!run || run.pos == null || endPos == null || !run.dir) return;
    if (Number(this.getSetting(`travel_${run.dir}_manual`)) > 0) return;   // manual time set: don't learn
    const delta = Math.abs(endPos - run.pos);
    const secs = (Date.now() - run.t) / 1000;
    if (delta < 20 || secs < 2) return;                       // too short to be a reliable sample
    // Orientable shutters run a slat phase at the fully closed end, and the gateway only reports the
    // position once everything has stopped — so a run ending at 0 % cannot be timed. Skip it.
    if (this.hasTilt() && endPos === 0) { this.log(`travel ${run.dir}: run ended fully closed on an orientable shutter — not used for learning`); return; }
    const full = Math.round((secs / delta) * 100 * 10) / 10;
    const key = `travel_${run.dir}`;
    const samples = (this.getStoreValue(key) || []).slice(-4); samples.push(full);
    await this.setStoreValue(key, samples).catch(this.error);
    const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length * 10) / 10;
    this.log(`travel ${run.dir}: ${delta} % in ${secs.toFixed(1)} s → ${full} s/100 % (avg ${avg} s over ${samples.length})`);
    await this.setSettings({ [key]: `${avg} s (${samples.length} runs)` }).catch(() => {});
  }

  /** Full-travel time in seconds for a direction: manual setting if set, else learned average, else null. */
  travelTime(dir) {
    const manual = Number(this.getSetting(`travel_${dir}_manual`));
    if (manual > 0) return manual;
    const samples = this.getStoreValue(`travel_${dir}`) || [];
    return samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length * 10) / 10 : null;
  }

  async resetTravel() {
    await this.unsetStoreValue('travel_up').catch(() => {});
    await this.unsetStoreValue('travel_down').catch(() => {});
    await this.setSettings({ travel_up: 'not learned yet', travel_down: 'not learned yet' }).catch(() => {});
    this.log('learned travel times reset');
    return true;
  }

  async onSettings({ changedKeys }) {
    if (changedKeys.some((k) => k.startsWith('travel_'))) this.log('travel time settings changed');
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
