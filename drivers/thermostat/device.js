'use strict';
const HapDevice = require('../../lib/HapDevice');

/**
 * BTicino Smarther over HAP exposes a HeaterCooler service:
 *   Active (0/1), TargetHeaterCoolerState (1 heat / 2 cool), CurrentHeaterCoolerState (0 inactive, 1 idle, 2 heating, 3 cooling),
 *   HeatingThresholdTemperature = the setpoint in heat mode, CurrentTemperature, plus a separate humidity sensor.
 */
class ThermostatDevice extends HapDevice {

  get registerIdentify() { return false; }

  async onInit() {
    this._listeners = new Set();
    this._heating = false;
    await super.onInit();
  }

  _listen(cap, fn) {
    if (this._listeners.has(cap) || !this.hasCapability(cap)) return;
    this._listeners.add(cap);
    this.registerCapabilityListener(cap, fn);
  }

  _setpointChar() {
    const acc = this.acc();
    return acc && (acc.chars.HeatingThresholdTemperature || acc.chars.CoolingThresholdTemperature);
  }

  async sync() {
    const acc = await super.sync();
    if (!acc) return null;

    const desired = ['thermostat_status', 'measure_temperature', 'target_temperature', 'thermostat_heating', 'thermostat_mode'];
    if (acc.chars.CurrentRelativeHumidity) desired.push('measure_humidity');
    desired.push('button.identify', 'button.rebuild');
    await this.ensureCapabilities(desired);

    const sp = this._setpointChar();
    if (sp) await this.setCapabilityOptions('target_temperature', { min: sp.min ?? 5, max: sp.max ?? 30, step: sp.step || 0.5 }).catch(() => {});

    this._listen('target_temperature', async (value) => {
      await this._writeSetpoint(value);
      this.homey.app.heating.noteSetpointChange(this.serial, value);   // user change -> manual hold until next switch point
    });
    this._listen('thermostat_mode', async (mode) => {
      const heating = this.homey.app.heating;
      if (mode === 'off') { await this.hap.setChar(this.serial, 'Active', 0); return; }
      if (mode === 'frost') { await this.setFrostGuard(); heating.noteSetpointChange(this.serial, this._frostTemp()); return; }
      if (mode === 'plan') {
        const ok = await heating.rejoin(this.serial);
        if (!ok) throw new Error('This room does not follow the heating plan, or the plan is off (see app settings → Heating)');
        await this._setMode();
        return;
      }
      // manual: keep the current setpoint (or a sensible one when leaving frost guard) and hold it
      if (acc.chars.TargetHeaterCoolerState) await this.hap.setChar(this.serial, 'TargetHeaterCoolerState', 1);
      await this.hap.setChar(this.serial, 'Active', 1);
      const setpoint = this._setpointChar();
      let v = setpoint ? Number(setpoint.value) : 20;
      if (v <= this._frostTemp()) { v = 20; await this.hap.setChar(this.serial, 'HeatingThresholdTemperature', v); }
      heating._expected.delete(this.serial);
      heating.noteSetpointChange(this.serial, v);
      await this._setMode();
    });
    this._listen('button.identify', async () => this.hap.identify(this.serial));
    this._listen('button.rebuild', async () => this.rebuild());

    if (acc.chars.CurrentTemperature) await this.setCapabilityValue('measure_temperature', acc.chars.CurrentTemperature.value).catch(this.error);
    if (acc.chars.CurrentRelativeHumidity && this.hasCapability('measure_humidity')) await this.setCapabilityValue('measure_humidity', acc.chars.CurrentRelativeHumidity.value).catch(this.error);
    if (sp) await this.setCapabilityValue('target_temperature', sp.value).catch(this.error);
    await this._setMode();
    if (acc.chars.CurrentHeaterCoolerState) await this._setHeating(acc.chars.CurrentHeaterCoolerState.value === 2);
    return acc;
  }

  _frostTemp() { return Number(this.getSetting('frost_temp')) || 7; }

  async _writeSetpoint(value) {
    const acc = this.acc();
    const ch = this._setpointChar();
    const step = (ch && ch.step) || 0.5;
    const v = Math.round(value / step) * step;
    if (acc.chars.TargetHeaterCoolerState && acc.chars.TargetHeaterCoolerState.value !== 1) await this.hap.setChar(this.serial, 'TargetHeaterCoolerState', 1);
    await this.hap.setChar(this.serial, acc.chars.HeatingThresholdTemperature ? 'HeatingThresholdTemperature' : 'CoolingThresholdTemperature', v);
    if (acc.chars.Active && acc.chars.Active.value !== 1) await this.hap.setChar(this.serial, 'Active', 1);
  }

  /** Called by the heating engine: apply a scheduled target (not a manual change). */
  async applyScheduleTarget(value) {
    const ch = this._setpointChar();
    if (ch && Math.abs(Number(ch.value) - value) < 0.01 && this.acc().chars.Active && this.acc().chars.Active.value === 1) return;
    await this._writeSetpoint(value);
  }

  async _setMode() {
    const acc = this.acc();
    const active = acc.chars.Active ? acc.chars.Active.value === 1 : true;
    const sp = this._setpointChar();
    const target = sp ? Number(sp.value) : null;
    const frost = active && target != null && Math.abs(target - this._frostTemp()) < 0.01;
    const heating = this.homey.app.heating;
    const rs = heating.roomState(this.serial);
    const onPlan = active && rs.active && rs.follows && !rs.manual;
    // Frost guard is a state in its own right: show it whoever set it (dial, override or schedule).
    const mode = !active ? 'off' : frost ? 'frost' : onPlan ? 'plan' : 'heat';
    await this.setCapabilityValue('thermostat_mode', mode).catch(this.error);

    const PROF = { comfort: 'Comfort', eco: 'Eco', night: 'Night', away: 'Away', frost: 'Frost guard' };
    const planName = (heating.status() || {}).plan || 'Schedule';
    let text;
    if (!active) text = 'Off';
    else if (frost) text = rs.override ? 'Frost guard (override)' : 'Frost guard';
    else if (onPlan) text = (rs.override ? `Override · ${PROF[rs.profile] || rs.profile}` : `${planName} · ${PROF[rs.profile] || rs.profile}`) + (target != null ? ` ${target} °C` : '');
    else {
      text = `Manual${target != null ? ` ${target} °C` : ''}`;
      if (rs.manual && rs.manualUntil) { const d = new Date(rs.manualUntil); text += ` until ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
    }
    if (this.hasCapability('thermostat_status')) await this.setCapabilityValue('thermostat_status', text).catch(this.error);
  }

  async onSettings({ changedKeys }) {
    if (changedKeys.includes('frost_temp')) await this._setMode();
  }

  async _setHeating(heating) {
    const changed = heating !== this._heating;
    this._heating = heating;
    await this.setCapabilityValue('thermostat_heating', heating).catch(this.error);
    if (changed) await this.driver.heatingTrigger.trigger(this, {}, { state: heating ? 'on' : 'off' }).catch(this.error);
  }

  async onChar(type, value) {
    if (type === 'CurrentTemperature') await this.setCapabilityValue('measure_temperature', value).catch(this.error);
    else if (type === 'CurrentRelativeHumidity' && this.hasCapability('measure_humidity')) await this.setCapabilityValue('measure_humidity', value).catch(this.error);
    else if (type === 'HeatingThresholdTemperature' || type === 'CoolingThresholdTemperature') {
      await this.setCapabilityValue('target_temperature', value).catch(this.error);
      await this._setMode();
      this.homey.app.heating.noteSetpointChange(this.serial, value);
    }
    else if (type === 'Active' || type === 'TargetHeaterCoolerState') await this._setMode();
    else if (type === 'CurrentHeaterCoolerState') await this._setHeating(value === 2);
  }

  isHeating() { return this._heating; }

  async setFrostGuard() {
    const t = this._frostTemp();
    if (this.acc().chars.TargetHeaterCoolerState) await this.hap.setChar(this.serial, 'TargetHeaterCoolerState', 1);
    await this.hap.setChar(this.serial, 'Active', 1);
    await this.hap.setChar(this.serial, 'HeatingThresholdTemperature', t);
    return true;
  }
}

module.exports = ThermostatDevice;
