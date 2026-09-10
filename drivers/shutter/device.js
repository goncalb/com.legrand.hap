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
    desired.push('shutter_moving', 'button.identify', 'button.rebuild', 'button.reset_travel', 'button.calibrate');
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

    // "Set state" (device controls + Flow): up = open, down = close — but like the physical rocker,
    // the direction it is already moving in stops it. The stop square uses the approximate stop too;
    // it only works with a known travel time (calibrate or run fully once).
    this._listen('windowcoverings_state', async (state) => {
      if (this._moving && (state === 'idle' || state === this._direction)) return this.stopApproximate();
      if (state === 'up') return this.hap.setChar(this.serial, 'TargetPosition', this.rawOf(100));
      if (state === 'down') return this.hap.setChar(this.serial, 'TargetPosition', this.rawOf(0));
      if (state === 'idle') throw new Error('Not moving');
      throw new Error(`Unknown state "${state}"`);
    });
    this._listen('windowcoverings_set', async (value) => {
      const rawTarget = this.rawOf(Math.round(value * 100));
      // the slider's fully-open / fully-closed shortcuts behave like the rocker: pressing the
      // direction it is already moving in stops it; any other position is a normal retarget
      if (this._moving && ((rawTarget >= 100 && this._direction === 'up') || (rawTarget <= 0 && this._direction === 'down'))) return this.stopApproximate();
      await this.hap.setChar(this.serial, 'TargetPosition', rawTarget);
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
    this._listen('button.calibrate', async () => this.calibrateTravel());

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
    const dirPhys = this._inverted() ? (this._direction === 'up' ? 'down' : this._direction === 'down' ? 'up' : this._direction) : this._direction;
    if (this._moving) text += dirPhys === 'up' ? ' ▲' : dirPhys === 'down' ? ' ▼' : ' ▲▼';
    await this.setCapabilityValue('shutter_status', text.trim()).catch(this.error);
  }

  /** Inverted awnings: the gateway's raw 100 means retracted. Everything Homey-facing uses physical %. */
  _inverted() { return this.getSetting('look') === 'awning' && !!this.getSetting('awning_invert'); }
  physOf(raw) { return this._inverted() ? 100 - raw : raw; }
  rawOf(phys) { return this._inverted() ? 100 - phys : phys; }

  async _setPosition(pos) {
    pos = Math.round(pos);
    // A position update while a run is pending marks the end of the *travel* (the orientable shutters keep
    // the motor busy afterwards re-opening the slats, which must not count as travel time).
    if (this._runStart && this._runStart.pos != null && pos !== this._runStart.pos) await this._learnTravel(pos);
    this._lastPos = pos;
    await this.setCapabilityValue('windowcoverings_set', this.physOf(pos) / 100).catch(this.error);
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
    let secs = (Date.now() - run.t) / 1000;
    if (delta < 20 || secs < 2) return;                       // too short to be a reliable sample
    // At the fully closed / fully open end the motor holds its "moving" status for a while after the
    // real movement (measured by "Calibrate travel times"). Subtract it; without a measurement a
    // run ending fully closed on an orientable shutter cannot be timed — skip it (old behaviour).
    if (this._calibrating && (endPos === 0 || endPos === 100)) { this.log(`travel ${run.dir}: calibration endpoint run — not used for learning`); return; }
    const hold = endPos === 0 ? this.getStoreValue('hold_down') : endPos === 100 ? this.getStoreValue('hold_up') : null;
    if (hold != null) secs = Math.max(1, secs - hold);
    else if (this.hasTilt() && endPos === 0) { this.log(`travel ${run.dir}: run ended fully closed on an orientable shutter — not used for learning`); return; }
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

  /**
   * Approximate stop. Legrand modules have no stop command over HAP, so — like pressing the moving
   * direction again on the physical rocker — we aim the shutter at its estimated current position,
   * computed from the run start and the travel time. Refused without a travel time (the estimate
   * would be a blind guess).
   */
  async stopApproximate() {
    if (!this._moving || !this._runStart || this._runStart.pos == null || !this._direction) throw new Error('Not moving');
    const travel = this.travelTime(this._direction);
    if (!travel) throw new Error(`No travel time for "${this._direction}" yet — run it fully once or set a manual time`);
    const elapsed = (Date.now() - this._runStart.t) / 1000;
    const delta = (elapsed / travel) * 100;
    const raw = this._direction === 'up' ? this._runStart.pos + delta : this._runStart.pos - delta;
    if (raw >= 99.5 || raw <= 0.5) { this.log('stop ignored: run essentially complete, motor holding at the end'); return null; }
    const est = Math.round(Math.max(1, Math.min(99, raw)));   // never land on the full-run endpoints
    this.log(`stop while moving ${this._direction}: ${elapsed.toFixed(1)} s from ${this._runStart.pos} % → aiming at ${est} %`);
    await this.hap.setChar(this.serial, 'TargetPosition', est);
    return est;
  }

  /**
   * One-tap calibration: 90 → 10 → 90 % measures the true speeds (mid-range, no end effects; the
   * normal learning code records them), then a full close and a full open measure the end hold —
   * how long the motor keeps its "moving" status at 0 / 100 % after the real movement stopped.
   */
  async calibrateTravel() {
    if (this._calibrating) throw new Error('Calibration already running');
    this._calibrating = true;
    this._runCalibration()
      .catch(async (e) => {
        this.error('calibration failed:', e);
        await this.setWarning(`Calibration failed: ${e && e.message}`).catch(() => {});
        this._notify(`Travel calibration of **${this.getName()}** failed: ${e && e.message}`);
        setTimeout(() => this.unsetWarning().catch(() => {}), 30000);
      })
      .finally(() => { this._calibrating = false; });
    return true;   // runs in the background; progress on the device tile and in the Log
  }

  _notify(excerpt) {
    this.homey.notifications.createNotification({ excerpt }).catch(this.error);
  }

  async _runCalibration() {
    this._notify(`Travel calibration of **${this.getName()}** started — the shutter will run 90 → 10 → 90 %, then fully close and fully open. A few minutes.`);
    const step = async (label, pos) => {
      await this.setWarning(`Calibrating: ${label}`).catch(() => {});
      this.log(`calibration: ${label} (→ ${pos} %)`);
      const t0 = Date.now();
      await this.hap.setChar(this.serial, 'TargetPosition', pos);
      // wait for the gateway to report movement (or accept "already there"), then for it to stop
      await new Promise((resolve) => {
        const s0 = Date.now();
        const t = setInterval(() => { if (this._moving || Date.now() - s0 > 8000) { clearInterval(t); resolve(); } }, 200);
      });
      await this._waitUntilStopped(180000);
      return (Date.now() - t0) / 1000;
    };
    await step('moving to the start position', 90);
    const tDownMid = await step('measuring down speed (90 → 10 %)', 10);
    const tUpMid = await step('measuring up speed (10 → 90 %)', 90);
    const down = this.travelTime('down'), up = this.travelTime('up');
    if (!down || !up) throw new Error('speed runs were not learned — see the app Log');
    // the mid runs carry the same command + stop-detection latency as the full runs: measure it there
    const latency = Math.max(0, ((tDownMid - down * 0.8) + (tUpMid - up * 0.8)) / 2);
    this.log(`calibration: measured command/detection latency ${latency.toFixed(1)} s`);
    const tClose = await step('measuring the hold at full close (→ 0 %)', 0);
    const holdDown = Math.max(0, Math.round(tClose - down * 0.9 - latency));   // 90 % span
    const tOpen = await step('measuring the hold at full open (→ 100 %)', 100);
    const holdUp = Math.max(0, Math.round(tOpen - up - latency));              // full span
    await this.setStoreValue('hold_down', holdDown).catch(this.error);
    await this.setStoreValue('hold_up', holdUp).catch(this.error);
    await this.setSettings({ end_hold: `close ${holdDown} s · open ${holdUp} s` }).catch(() => {});
    this.log(`calibration done: up ${up} s, down ${down} s, end hold close ${holdDown} s / open ${holdUp} s`);
    this._notify(`Travel calibration of **${this.getName()}** done: up ${up} s, down ${down} s, end hold ${holdDown} s (closed) / ${holdUp} s (open).`);
    await this.setWarning(`Calibration done — up ${up} s, down ${down} s, end hold ${holdDown} s / ${holdUp} s`).catch(() => {});
    setTimeout(() => this.unsetWarning().catch(() => {}), 20000);
  }

  async resetTravel() {
    await this.unsetStoreValue('travel_up').catch(() => {});
    await this.unsetStoreValue('travel_down').catch(() => {});
    await this.setSettings({ travel_up: 'not learned yet', travel_down: 'not learned yet' }).catch(() => {});
    this.log('learned travel times reset');
    return true;
  }

  async onSettings({ changedKeys }) {
    if (changedKeys.includes('awning_invert') || changedKeys.includes('look')) {
      // re-report the position in the (possibly new) physical orientation right away
      setTimeout(() => { if (this._lastPos != null) this._setPosition(this._lastPos).catch(this.error); }, 300);
    }
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
