'use strict';

const Homey = require('homey');

/** Base device: resolves its accessory by serial, resyncs on DB changes. */
class HapDevice extends Homey.Device {

  async onInit() {
    this.hap = this.homey.app.session;
    this.serial = this.getData().serial;

    this._onChar = (ev) => { if (ev.serial === this.serial) this.onChar(ev.type, ev.value).catch(this.error); };
    this._onDb = () => this.sync().catch(this.error);
    this._onConn = () => this.sync().catch(this.error);
    this._onDisc = (endpointId) => { const a = this.acc(); if (!a || a.endpoint === endpointId) this.setUnavailable('Connection lost').catch(() => {}); };

    if (this.registerIdentify !== false) {
      if (!this.hasCapability('button.identify')) await this.addCapability('button.identify').catch(() => {});
      if (this.hasCapability('button.identify')) {
        this.registerCapabilityListener('button.identify', async () => {
          await this.hap.identify(this.serial);
        });
      }
      if (!this.hasCapability('button.rebuild')) await this.addCapability('button.rebuild').catch(() => {});
      if (this.hasCapability('button.rebuild')) {
        this.registerCapabilityListener('button.rebuild', async () => this.rebuild());
      }
    }

    this.hap.on('char', this._onChar);
    this.hap.on('db', this._onDb);
    this.hap.on('connected', this._onConn);
    this.hap.on('disconnected', this._onDisc);

    await this.sync();
  }

  async onUninit() {
    this.hap.removeListener('char', this._onChar);
    this.hap.removeListener('db', this._onDb);
    this.hap.removeListener('connected', this._onConn);
    this.hap.removeListener('disconnected', this._onDisc);
  }

  onDeleted() { this.onUninit(); }

  acc() { return this.hap.get(this.serial); }

  /** Ensure capability presence matches the accessory (dynamic capabilities). */
  async ensureCapability(cap, shouldHave) {
    const has = this.hasCapability(cap);
    if (shouldHave && !has) await this.addCapability(cap);
    if (!shouldHave && has) await this.removeCapability(cap);
  }

  /**
   * Make the device's capability list match `desired` (order included).
   * Every step is individually guarded and logged; a final pass re-adds
   * anything still missing so a failed step can never leave the device empty.
   */
  async ensureCapabilities(desired) {
    const rm = async (cap) => {
      try { await this.removeCapability(cap); this.log(`capability removed: ${cap}`); }
      catch (e) { this.error(`removeCapability(${cap}) failed: ${e.message}`); }
    };
    const add = async (cap) => {
      if (this.hasCapability(cap)) return;
      try { await this.addCapability(cap); this.log(`capability added: ${cap}`); }
      catch (e) { this.error(`addCapability(${cap}) failed: ${e.message}`); }
    };

    for (const cap of this.getCapabilities()) {
      if (!desired.includes(cap)) await rm(cap);
    }
    const current = this.getCapabilities();
    let firstMismatch = -1;
    for (let i = 0; i < desired.length; i++) {
      if (current[i] !== desired[i]) { firstMismatch = i; break; }
    }
    if (firstMismatch !== -1) {
      for (const cap of current.slice(firstMismatch)) await rm(cap);
      for (const cap of desired.slice(firstMismatch)) await add(cap);
    }
    // safety net: whatever is still missing gets added (order may be imperfect, but never empty)
    for (const cap of desired) await add(cap);
  }

  /** Maintenance action: force a full rebuild of the capability layout + resync values. */
  async rebuild() {
    this.log('Manual rebuild requested');
    this._listeners = new Set();
    await this.sync();
    return true;
  }

  /** Called on init, on every DB refresh and on reconnect. Override + call super. */
  async sync() {
    const acc = this.acc();
    if (!acc || !this.hap.isConnected(this.serial)) {
      await this.setUnavailable(acc ? 'Connection to the HomeKit device lost' : 'Device not found').catch(() => {});
      return null;
    }
    await this.setAvailable().catch(() => {});
    await this.setSettings({
      serial: acc.serial,
      model: acc.model || '',
      firmware: acc.firmware || '',
    }).catch(() => {});
    return acc;
  }

  /** Characteristic event from the gateway. Override. */
  async onChar() {}

}

module.exports = HapDevice;
