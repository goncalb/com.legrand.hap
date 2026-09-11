'use strict';
const net = require('net');

const EventEmitter = require('events');
const { IPDiscovery, HttpClient } = require('hap-controller');
const { PairMethods } = require('hap-controller/lib/protocol/pairing-protocol');

/** A usable unicast address: link-local (169.254/16, fe80::) and null addresses are gateway boot noise. */
function usableAddress(a) {
  const x = String(a || '');
  return x !== '' && x !== '0.0.0.0' && !x.startsWith('169.254.') && !/^fe80:/i.test(x);
}

/** Normalise a HAP UUID (full or short) to its short hex form, e.g. "00000025-..." -> "25" */
function shortType(uuid) {
  if (uuid === undefined || uuid === null) return '';
  const head = String(uuid).split('-')[0].replace(/^0+/, '').toUpperCase();
  return head === '' ? '0' : head;
}

const CHAR = {
  Identify: '14', Manufacturer: '20', Model: '21', Name: '23', SerialNumber: '30', FirmwareRevision: '52',
  On: '25', Brightness: '8',
  CurrentPosition: '6D', TargetPosition: '7C', PositionState: '72',
  CurrentHorizontalTiltAngle: '6C', TargetHorizontalTiltAngle: '7B',
  ProgrammableSwitchEvent: '73', StatusLowBattery: '79', ServiceLabelIndex: 'CB',
  // HeaterCooler (Smarther) + humidity
  Active: 'B0', CurrentTemperature: '11', CurrentHeaterCoolerState: 'B1', TargetHeaterCoolerState: 'B2',
  CoolingThresholdTemperature: 'D', HeatingThresholdTemperature: '12', TemperatureDisplayUnits: '36',
  CurrentRelativeHumidity: '10',
  // Lightbulb colour
  Hue: '13', Saturation: '2F', ColorTemperature: 'CE',
  // Outlet / Switch
  OutletInUse: '26',
  // Thermostat service (older firmware / other vendors)
  CurrentHeatingCoolingState: 'F', TargetHeatingCoolingState: '33', TargetTemperature: '35',
  // Sensors
  ContactSensorState: '6A', MotionDetected: '22', SmokeDetected: '92', CarbonMonoxideDetected: '69',
  StatusActive: '75', StatusFault: '77', StatusTampered: '7A',
};

const SERVICE = {
  AccessoryInformation: '3E', Lightbulb: '43', WindowCovering: '8C',
  StatelessProgrammableSwitch: '89', Battery: '96',
  HeaterCooler: 'BC', Thermostat: '4A', HumiditySensor: '82',
  Outlet: '47', Switch: '49',
  ContactSensor: '80', MotionSensor: '85', SmokeSensor: '87', CarbonMonoxideSensor: '7F',
};

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const RECONNECT_BASE_MS = 5 * 1000;
const RECONNECT_MAX_MS = 5 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* One paired HAP device (bridge or standalone accessory)               */
/* ------------------------------------------------------------------ */
class HapEndpoint extends EventEmitter {
  constructor(session, id, cfg) {
    super();
    this.session = session;
    this.id = id;
    this.cfg = cfg;                 // { pairing, address:{address,port}, name }
    this.client = null;
    this.connected = false;
    this._lastCN = null;
    this._reconnectDelay = RECONNECT_BASE_MS;
    this._stopped = false;
    this.accessories = new Map();   // serial -> acc
    this._aidToSerial = new Map();
    this.log = (level, serial, msg) => session.log(level, serial, `[${cfg.name || id}] ${msg}`);
  }

  get addr() { return this.cfg.address; }

  onService(svc) {
    if (!usableAddress(svc.address)) {
      this.log('warn', null, `ignoring link-local/unusable advertised address ${svc.address} (gateway likely mid-boot)`);
      return;
    }
    const isV6 = String(svc.address).includes(':');
    const haveV4 = this.cfg.address && !String(this.cfg.address.address).includes(':');
    // never replace a known IPv4 with an IPv6 announcement
    const changed = !isV6 || !haveV4
      ? (!this.cfg.address || this.cfg.address.address !== svc.address || this.cfg.address.port !== svc.port)
      : false;
    if (changed && !(isV6 && haveV4)) { this.cfg.address = { address: svc.address, port: svc.port }; this.session._persist(); }
    if (svc.name && !this.cfg.name) { this.cfg.name = svc.name; this.session._persist(); }
    const cn = svc['c#'];
    if (this._lastCN !== null && cn !== undefined && cn !== this._lastCN && this.connected) {
      this.log('info', null, `config number changed (${this._lastCN} -> ${cn}) — refreshing accessory DB`);
      this.refresh('c# changed').catch(() => {});
    }
    if (cn !== undefined) this._lastCN = cn;
    if (!this.connected) this.connect().catch(() => {});
  }

  async connect() {
    if (this.connected || this._connecting || this._stopped || !this.cfg.pairing || !this.addr) return;
    this._connecting = true;
    try {
      this.client = new HttpClient(this.id, this.addr.address, this.addr.port, this.cfg.pairing);
      this.client.on('event', (ev) => this._onEvent(ev));
      this.client.on('event-disconnect', () => this._onDisconnect('event connection dropped'));
      await this.refresh('connect');
      await this._subscribeAll();
      this.connected = true;
      this._reconnectDelay = RECONNECT_BASE_MS;
      this._failCount = 0;
      this.log('info', null, 'session established');
      this.session.emit('connected', this.id);
    } catch (err) {
      this._onDisconnect(`connect failed: ${err.message}`);
    } finally {
      this._connecting = false;
    }
  }

  _onDisconnect(why) {
    if (this._stopped) return;
    const was = this.connected;
    this.connected = false;
    if (this.client) try { this.client.close(); } catch { /* ignore */ }
    this.client = null;
    if (was) { this.log('warn', null, `session lost: ${why} — reconnecting`); this.session.emit('disconnected', this.id); }
    else this.log('warn', null, why);
    clearTimeout(this._reconnectTimer);
    this._failCount = (this._failCount || 0) + 1;
    // every few failures: restart the mDNS browser (interface flaps silently kill multicast sockets)
    // and follow the gateway to its current address if it moved (DHCP renew, router reboot)
    if (this._failCount % 4 === 0) {
      this.session.refreshAdvertisement(this.id, 3500).then((cur) => {
        if (cur && usableAddress(cur.address) && this.cfg.address
            && (cur.address !== this.cfg.address.address || cur.port !== this.cfg.address.port)) {
          this.log('warn', null, `gateway moved to ${cur.address}:${cur.port} — following`);
          this.cfg.address = { address: cur.address, port: cur.port };
          this.session._persist();
        }
      }).catch(() => {});
    }
    this._reconnectTimer = setTimeout(() => this.connect().catch(() => {}), this._reconnectDelay);
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  stop() {
    this._stopped = true;
    clearTimeout(this._reconnectTimer);
    if (this.client) try { this.client.close(); } catch { /* ignore */ }
    this.client = null; this.connected = false;
  }

  async _subscribeAll() {
    const list = [];
    for (const acc of this.accessories.values()) {
      for (const ch of Object.values(acc.chars)) if (ch.ev) list.push(`${acc.aid}.${ch.iid}`);
      for (const btn of acc.buttons) list.push(`${acc.aid}.${btn.iid}`);
    }
    if (list.length) await this.client.subscribeCharacteristics(list);
    this.log('info', null, `subscribed to ${list.length} characteristics`);
  }

  async refresh(reason) {
    const client = this.client || new HttpClient(this.id, this.addr.address, this.addr.port, this.cfg.pairing);
    const db = await client.getAccessories();
    const fresh = new Map();
    for (const raw of db.accessories) { const [serial, acc] = this._parseAccessory(raw); fresh.set(serial, acc); }

    for (const [serial, acc] of fresh) {
      const prev = this.accessories.get(serial);
      if (!prev) { if (this.accessories.size) this.session.emit('accessory-added', acc); }
      else if (JSON.stringify(prev.shape) !== JSON.stringify(acc.shape)) {
        this.session.emit('accessory-changed', acc);
        this.log('info', serial, `accessory "${acc.name}" structure changed`);
      }
    }
    for (const [serial, acc] of this.accessories) if (!fresh.has(serial)) this.session.emit('accessory-removed', acc);

    this.accessories = fresh;
    this._aidToSerial = new Map([...fresh.values()].map((a) => [a.aid, a.serial]));
    this.log('info', null, `accessory DB refreshed (${reason}): ${fresh.size} accessories`);
    for (const a of fresh.values()) {
      this.log('debug', a.serial, `${a.klass}${a.sensorType ? '/' + a.sensorType : ''} · ${[a.manufacturer, a.model].filter(Boolean).join(' ') || '?'} · chars: ${Object.keys(a.chars).join(', ') || 'none'}${a.buttons.length ? ' · buttons: ' + a.buttons.length : ''}`);
    }
    this.session._rebuildIndex();
    this.session.emit('db');
    if (this.client && this.connected) await this._subscribeAll().catch(() => {});
  }

  _parseAccessory(raw) {
    const acc = {
      endpoint: this.id, aid: raw.aid,
      serial: null, name: null, model: null, manufacturer: null, firmware: null,
      klass: 'unknown', chars: {}, buttons: [], identifyIid: null, lastSeen: new Date().toISOString(),
    };
    for (const svc of raw.services) {
      const st = shortType(svc.type);
      const byType = {};
      for (const ch of svc.characteristics) byType[shortType(ch.type)] = ch;
      if (st === SERVICE.AccessoryInformation) {
        acc.name = byType[CHAR.Name] ? byType[CHAR.Name].value : `aid ${raw.aid}`;
        acc.model = byType[CHAR.Model] && byType[CHAR.Model].value;
        acc.manufacturer = byType[CHAR.Manufacturer] && byType[CHAR.Manufacturer].value;
        acc.serial = byType[CHAR.SerialNumber] && byType[CHAR.SerialNumber].value;
        acc.firmware = byType[CHAR.FirmwareRevision] && byType[CHAR.FirmwareRevision].value;
        if (byType[CHAR.Identify]) acc.identifyIid = byType[CHAR.Identify].iid;
        continue;
      }
      const keep = (name) => {
        const ch = byType[CHAR[name]];
        if (!ch) return;
        acc.chars[name] = { iid: ch.iid, value: ch.value, ev: Array.isArray(ch.perms) && ch.perms.includes('ev'),
                            pw: Array.isArray(ch.perms) && ch.perms.includes('pw'), min: ch.minValue, max: ch.maxValue, step: ch.minStep };
      };
      if (st === SERVICE.Lightbulb) { acc.klass = 'light'; keep('On'); keep('Brightness'); keep('Hue'); keep('Saturation'); keep('ColorTemperature'); }
      else if (st === SERVICE.Outlet || st === SERVICE.Switch) { acc.klass = 'socket'; keep('On'); keep('OutletInUse'); }
      else if (st === SERVICE.WindowCovering) {
        acc.klass = 'shutter';
        keep('CurrentPosition'); keep('TargetPosition'); keep('PositionState');
        keep('CurrentHorizontalTiltAngle'); keep('TargetHorizontalTiltAngle');
      } else if (st === SERVICE.StatelessProgrammableSwitch) {
        acc.klass = 'remote';
        const ev = byType[CHAR.ProgrammableSwitchEvent], idx = byType[CHAR.ServiceLabelIndex], nm = byType[CHAR.Name];
        if (ev) acc.buttons.push({ index: idx ? idx.value : acc.buttons.length + 1, name: nm ? nm.value : `Button ${acc.buttons.length + 1}`, iid: ev.iid });
      } else if (st === SERVICE.Battery) { keep('StatusLowBattery'); }
      else if (st === SERVICE.HeaterCooler) {
        acc.klass = 'thermostat';
        keep('Active'); keep('CurrentTemperature'); keep('CurrentHeaterCoolerState'); keep('TargetHeaterCoolerState');
        keep('CoolingThresholdTemperature'); keep('HeatingThresholdTemperature'); keep('TemperatureDisplayUnits');
      } else if (st === SERVICE.Thermostat) {
        acc.klass = 'thermostat';
        keep('CurrentHeatingCoolingState'); keep('TargetHeatingCoolingState'); keep('CurrentTemperature'); keep('TargetTemperature'); keep('TemperatureDisplayUnits');
      } else if (st === SERVICE.HumiditySensor) { keep('CurrentRelativeHumidity'); }
      else if (st === SERVICE.ContactSensor) { acc.klass = 'sensor'; acc.sensorType = 'contact'; keep('ContactSensorState'); keep('StatusTampered'); }
      else if (st === SERVICE.MotionSensor) { acc.klass = 'sensor'; acc.sensorType = 'motion'; keep('MotionDetected'); keep('StatusTampered'); }
      else if (st === SERVICE.SmokeSensor) { acc.klass = 'sensor'; acc.sensorType = 'smoke'; keep('SmokeDetected'); keep('StatusFault'); }
      else if (st === SERVICE.CarbonMonoxideSensor) { acc.klass = 'sensor'; acc.sensorType = 'co'; keep('CarbonMonoxideDetected'); keep('StatusFault'); }
    }
    acc.buttons.sort((a, b) => a.index - b.index);
    acc.shape = { name: acc.name, model: acc.model, klass: acc.klass, sensorType: acc.sensorType,
      chars: Object.fromEntries(Object.entries(acc.chars).map(([k, v]) => [k, { iid: v.iid, min: v.min, max: v.max, step: v.step }])),
      buttons: acc.buttons };
    if (!acc.serial) acc.serial = `${this.id}-aid-${raw.aid}`;
    // every HAP bridge exposes itself as accessory 1 with only the information service — that's the gateway, not an unsupported device
    if (acc.klass === 'unknown' && raw.aid === 1) acc.klass = 'bridge';
    if (acc.klass === 'unknown' && raw.aid !== 1) {
      const types = raw.services.map((sv) => shortType(sv.type)).filter((t) => t !== SERVICE.AccessoryInformation && t !== SERVICE.ProtocolInformation).join(', ');
      this.log('info', null, `unsupported accessory "${acc.name}" (${acc.manufacturer || '?'} ${acc.model || '?'}) — services: ${types || 'none'}; a Log excerpt helps the developer add support`);
    }
    return [acc.serial, acc];
  }

  _onEvent(ev) {
    if (!ev || !Array.isArray(ev.characteristics)) return;
    for (const item of ev.characteristics) {
      const serial = this._aidToSerial.get(item.aid);
      if (!serial) continue;
      const acc = this.accessories.get(serial);
      const btn = acc.buttons.find((b) => b.iid === item.iid);
      if (btn) {
        // ProgrammableSwitchEvent: 0 = single, 1 = double, 2 = long press (Legrand remotes report single only)
        const press = ['single', 'double', 'long'][Number(item.value)] || 'single';
        this.session.log('info', serial, `Button ${btn.index} ${press} press`);
        this.session.emit('char', { serial, type: 'ButtonEvent', value: btn.index, press });
        continue;
      }
      for (const [name, ch] of Object.entries(acc.chars)) {
        if (ch.iid === item.iid) {
          ch.value = item.value;
          this.session.log('debug', serial, `${name} -> ${JSON.stringify(item.value)}`);
          this.session.emit('char', { serial, type: name, value: item.value });
          break;
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* The pool of endpoints + merged accessory index                       */
/* ------------------------------------------------------------------ */
class HapSession extends EventEmitter {
  constructor({ log, loadEndpoints, saveEndpoints }) {
    super();
    this.setMaxListeners(300);
    this.log = log;
    this._load = loadEndpoints;
    this._save = saveEndpoints;
    this.endpoints = new Map();     // id -> HapEndpoint
    this.discovered = new Map();    // id -> mdns service (everything HAP seen on the LAN)
    this.accessories = new Map();   // serial -> acc (merged)
    this._stopped = false;
  }

  /* ----- lifecycle ----- */
  start() {
    this._stopped = false;
    const cfg = this._load() || {};
    for (const [id, c] of Object.entries(cfg)) this.endpoints.set(id, new HapEndpoint(this, id, c));
    this._discovery = new IPDiscovery();
    this._discovery.on('serviceUp', (svc) => this._onService(svc));
    this._discovery.start();
    setTimeout(() => { for (const ep of this.endpoints.values()) if (!ep.connected && ep.addr) ep.connect().catch(() => {}); }, 2000);
    this._refreshTimer = setInterval(() => {
      for (const ep of this.endpoints.values()) if (ep.connected) ep.refresh('periodic').catch(() => {});
    }, REFRESH_INTERVAL_MS);
  }

  async stop() {
    this._stopped = true;
    clearInterval(this._refreshTimer);
    if (this._discovery) try { this._discovery.stop(); } catch { /* ignore */ }
    for (const ep of this.endpoints.values()) ep.stop();
  }

  _persist() {
    const out = {};
    for (const [id, ep] of this.endpoints) out[id] = ep.cfg;
    this._save(out);
  }

  /** Feed a Homey discovery result (ManagerDiscovery mdns-sd) into the same pipeline. */
  onHomeyDiscovery(result) {
    const txt = result.txt || {};
    if (!txt.id || !result.address) return;
    // Prefer IPv4: link-local IPv6 (fe80::) is not routable for our client. Pick an IPv4 from `addresses` if offered.
    let address = result.address;
    if (String(address).includes(':')) {
      const v4 = (result.addresses || []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
      if (!v4) return;
      address = v4;
    }
    result = { ...result, address };
    this._onService({
      id: String(txt.id).toUpperCase(),
      name: (result.name || '').replace(/\._hap\._tcp.*$/, ''),
      address: result.address,
      port: result.port || 5001,
      md: txt.md, ci: txt.ci != null ? Number(txt.ci) : undefined,
      'c#': txt['c#'] != null ? Number(txt['c#']) : undefined,
      sf: txt.sf != null ? Number(txt.sf) : 0,
      source: 'homey',
    });
  }

  _onService(svc) {
    if (svc.id) svc.id = String(svc.id).toUpperCase();
    if (!this.discovered.has(svc.id)) this.log('debug', null, `mDNS (${svc.source || 'app'}): found HAP device "${svc.name}" (${svc.id}) at ${svc.address}:${svc.port}`);
    this.discovered.set(svc.id, { ...svc, seenAt: Date.now() });
    const ep = this.endpoints.get(svc.id);
    if (ep) ep.onService(svc);
  }

  _rebuildIndex() {
    const merged = new Map();
    for (const ep of this.endpoints.values()) for (const [serial, acc] of ep.accessories) merged.set(serial, acc);
    this.accessories = merged;
  }

  /* ----- discovery / pairing ----- */
  listDiscovered({ all = false } = {}) {
    const list = [...this.discovered.values()].map((s) => ({
      id: s.id, name: s.name, address: s.address, port: s.port, model: s.md, cn: s['c#'], category: s.ci,
      pairedElsewhere: (s.sf & 1) === 0 && !this.endpoints.has(s.id),
      pairedHere: this.endpoints.has(s.id),
      legrand: /legrand|netatmo|bticino|smarther/i.test(`${s.name} ${s.md || ''}`),
    }));
    return all ? list : list.filter((g) => g.legrand);
  }

  listEndpoints() {
    return [...this.endpoints.values()].map((ep) => ({
      id: ep.id, name: ep.cfg.name || ep.id, address: ep.addr || null, connected: ep.connected,
      accessories: ep.accessories.size,
    }));
  }

  isPaired() { return this.endpoints.size > 0; }

  /** Pair with a device. `address` ({address, port}) is optional: used when mDNS can't see the device. */
  /** Restart the mDNS browser and wait briefly for a fresh advertisement of one device. */
  async refreshAdvertisement(id, waitMs = 3500) {
    const before = this.discovered.get(id);
    const beforeSeen = before ? before.seenAt : 0;
    try { this._discovery.stop(); } catch { /* ignore */ }
    this._discovery = new IPDiscovery();
    this._discovery.on('serviceUp', (svc) => this._onService(svc));
    this._discovery.start();
    const t0 = Date.now();
    while (Date.now() - t0 < waitMs) {
      const cur = this.discovered.get(id);
      if (cur && cur.seenAt > beforeSeen) return cur;
      await new Promise((r) => setTimeout(r, 250));
    }
    return this.discovered.get(id) || null;
  }

  async pair(id, pin, address) {
    id = String(id).toUpperCase();
    // gateways that restart their HAP server between attempts move ports — never trust a cached record
    let fresh = await this.refreshAdvertisement(id);
    if (fresh && !usableAddress(fresh.address)) { this.log('warn', null, `advertised ${fresh.address} is link-local — ignoring`); fresh = null; }
    if (fresh) this.log('info', null, `advertisement refreshed: ${fresh.address}:${fresh.port}`);
    const svc = fresh || this.discovered.get(id);
    // a manually entered address always wins (dual-interface gateways advertise the wrong one);
    // a missing port falls back to the advertised one, not a guess
    const target = address && address.address
      ? { address: address.address, port: address.port || (svc && svc.port) || 5001 }
      : (svc ? { address: svc.address, port: svc.port } : null);
    if (!target || !target.address) throw new Error('Device not found on the network — enter its IP address');
    const digits = String(pin).replace(/\D/g, '');
    const formatted = digits.length === 8 ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : pin;
    this.lastPair = { id, t: Date.now(), state: 'running', error: null };
    const port = target.port || 5001;
    this.log('info', null, `pairing ${id} at ${target.address}:${port} (${svc ? 'discovered' : 'manual'})...`);
    // pre-flight: fail fast and clearly instead of hanging on a stale port or a firewall drop
    const probe = (host, prt) => new Promise((resolve, reject) => {
      const sock = net.connect({ host, port: prt });
      const to = setTimeout(() => { sock.destroy(); reject(new Error(`no TCP connection to ${host}:${prt} within 5 s — stale advertised port or firewall; check the live port (hap-probe discover) and pair manually with IP:port`)); }, 5000);
      sock.once('connect', () => { clearTimeout(to); sock.destroy(); resolve(); });
      sock.once('error', (e) => { clearTimeout(to); reject(new Error(`cannot connect to ${host}:${prt}: ${(e && e.code) || e.message}`)); });
    });
    try {
      await probe(target.address, port);
    } catch (e) {
      // maybe the port moved while we were typing: one automatic retry on the freshest advertisement
      const cur = await this.refreshAdvertisement(id, 4000);
      if (cur && (cur.port !== port || cur.address !== target.address)) {
        this.log('warn', null, `${target.address}:${port} unreachable — the gateway moved to ${cur.address}:${cur.port}, retrying there`);
        target.address = cur.address; target.port = cur.port;
        await probe(cur.address, cur.port);
      } else throw e;
    }
    const port2 = target.port || port;
    // plain PairSetup first (the method every stack with proven multi-vendor pairings uses;
    // some gateways ignore with-auth entirely, and a dangling with-auth attempt jams the next one)
    const attempt = async (method, label, ms) => {
      this.log('info', null, `pair-setup (${label}) at ${target.address}:${port2}...`);
      const c = new HttpClient(id, target.address, port2);
      try {
        await Promise.race([
          c.pairSetup(formatted, method),
          new Promise((resolve, reject) => setTimeout(() => reject(new Error(`no SRP response to ${label} within ${ms / 1000} s`)), ms)),
        ]);
        return c;
      } catch (e) {
        try { c.close(); } catch { /* ignore */ }
        throw e;
      }
    };
    let client;
    try {
      client = await attempt(PairMethods.PairSetup, 'plain', 75000);
    } catch (e1) {
      this.log('warn', null, `${e1.message} — retrying with the with-auth PairSetup method`);
      try {
        client = await attempt(PairMethods.PairSetupWithAuth, 'with-auth', 40000);
      } catch (e2) {
        throw new Error(`${e2.message} (plain: ${e1.message}) — power-cycle the gateway and retry promptly`);
      }
    }
    const pairing = client.getLongTermData();
    try { client.close(); } catch { /* ignore */ }
    const ep = await this.addEndpoint(id, { pairing, address: { address: target.address, port: port2 }, name: svc ? svc.name : null });
    this.lastPair = { id, t: Date.now(), state: 'ok', error: null };
    return ep;
  }

  async addEndpoint(id, cfg) {
    const existing = this.endpoints.get(id);
    if (existing) { existing.stop(); }
    const ep = new HapEndpoint(this, id, { ...(existing ? existing.cfg : {}), ...cfg });
    this.endpoints.set(id, ep);
    this._persist();
    this.log('info', null, `Endpoint ${cfg.name || id} added`);
    const svc = this.discovered.get(id);
    if (svc) ep.onService(svc); else if (ep.addr) ep.connect().catch(() => {});
    return ep;
  }

  removeEndpoint(id) {
    const ep = this.endpoints.get(id);
    if (!ep) return false;
    ep.stop();
    this.endpoints.delete(id);
    this._rebuildIndex();
    this._persist();
    this.emit('db');
    this.log('warn', null, `Endpoint ${ep.cfg.name || id} removed`);
    return true;
  }

  setAddress(id, address) {
    const ep = this.endpoints.get(id);
    if (!ep) throw new Error('Unknown endpoint');
    ep.cfg.address = address;
    this._persist();
    if (!ep.connected) ep.connect().catch(() => {});
  }

  async refreshAll(reason) {
    for (const ep of this.endpoints.values()) if (ep.connected || ep.addr) await ep.refresh(reason).catch((e) => ep.log('warn', null, `refresh failed: ${e.message}`));
  }

  /* ----- runtime API for devices ----- */
  get(serial) { return this.accessories.get(serial) || null; }
  listAccessories() { return [...this.accessories.values()]; }
  listByClass(klass) { return this.listAccessories().filter((a) => a.klass === klass); }
  isConnected(serial) { const acc = this.get(serial); const ep = acc && this.endpoints.get(acc.endpoint); return !!(ep && ep.connected); }
  get connected() { return [...this.endpoints.values()].some((ep) => ep.connected); }

  _epFor(serial) {
    const acc = this.accessories.get(serial);
    const ep = acc && this.endpoints.get(acc.endpoint);
    if (!acc || !ep || !ep.client || !ep.connected) throw new Error('Not connected');
    return { acc, ep };
  }

  async setChar(serial, charName, value) {
    const { acc, ep } = this._epFor(serial);
    const ch = acc.chars[charName];
    if (!ch) throw new Error(`${charName} not supported by ${acc.name}`);
    this.log('info', serial, `Write ${charName} = ${value}`);
    await ep.client.setCharacteristics({ [`${acc.aid}.${ch.iid}`]: value });
    ch.value = value;
  }

  async identify(serial) {
    const { acc, ep } = this._epFor(serial);
    if (acc.identifyIid == null) throw new Error('Identify not available');
    this.log('info', serial, 'Identify (blink)');
    await ep.client.setCharacteristics({ [`${acc.aid}.${acc.identifyIid}`]: true });
  }
}

HapSession.CHAR = CHAR;
module.exports = HapSession;
