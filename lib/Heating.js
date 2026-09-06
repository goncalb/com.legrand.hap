'use strict';

const EventEmitter = require('events');

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const HOUSE_PROFILES = ['away', 'frost'];          // single temperature for all rooms
const ROOM_PROFILES = ['comfort', 'eco', 'night']; // temperature per room
const TICK_MS = 60 * 1000;
const REAPPLY_MS = 30 * 60 * 1000;

const DEFAULT = () => ({
  enabled: false,
  activePlan: 'winter',
  plans: [{ id: 'winter', name: 'Winter', days: Object.fromEntries(DAYS.map((d) => [d, [
    { time: '00:00', profile: 'comfort' }, { time: '06:45', profile: 'eco' }, { time: '18:30', profile: 'comfort' }]])) }],
  rooms: {},            // serial -> { follow: true, temps: { comfort: 20, eco: 18.5, night: 17 } }
  house: { away: 16, frost: 7 },
  override: null,       // { profile, until: ISO|null }
});

/**
 * House-wide heating plan for the Smarther thermostats.
 * Profiles: comfort/eco (per room) + away/frost (house-wide) as overrides.
 * Rooms can opt out (follow=false). A manual setpoint change on a room holds until the next switch point.
 */
class Heating extends EventEmitter {
  constructor(homey, log) {
    super();
    this.homey = homey;
    this.log = log;
    this._manual = new Map();       // serial -> { until: Date }
    this._expected = new Map();     // serial -> last value the engine wrote
    this._lastProfile = null;
    this._lastApply = 0;
  }

  /* ---------- config ---------- */
  get() {
    const cfg = this.homey.settings.get('heating');
    return cfg ? { ...DEFAULT(), ...cfg, house: { ...DEFAULT().house, ...(cfg.house || {}) } } : DEFAULT();
  }
  save(cfg) {
    if (!cfg || !Array.isArray(cfg.plans) || !cfg.plans.length) throw new Error('At least one plan is required');
    for (const p of cfg.plans) for (const d of DAYS) {
      p.days[d] = (p.days[d] || []).filter((x) => /^\d{2}:\d{2}$/.test(x.time) && [...ROOM_PROFILES, ...HOUSE_PROFILES].includes(x.profile))
        .sort((a, b) => a.time.localeCompare(b.time));
    }
    if (!cfg.plans.find((p) => p.id === cfg.activePlan)) cfg.activePlan = cfg.plans[0].id;
    this.homey.settings.set('heating', cfg);
    this._lastProfile = null;   // force re-apply on next tick
    this.tick().catch(this.error);
    return cfg;
  }

  /* ---------- lifecycle ---------- */
  start() {
    this._timer = setInterval(() => this.tick().catch((e) => this.log('warn', null, `heating tick: ${e.message}`)), TICK_MS);
    setTimeout(() => this.tick().catch(() => {}), 10000);
  }
  stop() { clearInterval(this._timer); }

  /* ---------- time helpers ---------- */
  _now() {
    const tz = this.homey.clock.getTimezone();
    const d = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
    const get = (t) => (parts.find((p) => p.type === t) || {}).value;
    const dayIdx = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'));
    return { day: DAYS[dayIdx], time: `${get('hour')}:${get('minute')}`, dayIdx };
  }

  /** Current scheduled profile and the next switch point. */
  scheduled(cfg = this.get()) {
    const plan = cfg.plans.find((p) => p.id === cfg.activePlan) || cfg.plans[0];
    const { day, time, dayIdx } = this._now();
    const today = plan.days[day] || [];
    let current = null, since = null;
    for (const pt of today) if (pt.time <= time) { current = pt.profile; since = pt.time; }
    if (!current) {  // wrap to the last point of a previous day
      for (let i = 1; i <= 7 && !current; i++) {
        const prev = plan.days[DAYS[(dayIdx - i + 7) % 7]] || [];
        if (prev.length) { current = prev[prev.length - 1].profile; since = prev[prev.length - 1].time; }
      }
    }
    let next = today.find((pt) => pt.time > time) || null;
    let nextDay = day;
    for (let i = 1; i <= 7 && !next; i++) {
      const nd = DAYS[(dayIdx + i) % 7];
      const pts = plan.days[nd] || [];
      if (pts.length) { next = pts[0]; nextDay = nd; }
    }
    return { profile: current || 'eco', since, next: next ? { ...next, day: nextDay } : null, plan: plan.name };
  }

  status() {
    const cfg = this.get();
    const sch = this.scheduled(cfg);
    const ov = this._activeOverride(cfg);
    return {
      enabled: cfg.enabled, plan: sch.plan, scheduled: sch.profile, since: sch.since, next: sch.next,
      override: ov, effective: ov ? ov.profile : (cfg.enabled ? sch.profile : null),
      manualRooms: [...this._manual.entries()].map(([serial, m]) => ({ serial, until: m.until })),
    };
  }

  _activeOverride(cfg) {
    const ov = cfg.override;
    if (!ov) return null;
    if (ov.until && new Date(ov.until) < new Date()) { this._clearOverride(cfg); return null; }
    return ov;
  }
  _clearOverride(cfg) { cfg.override = null; this.homey.settings.set('heating', cfg); }

  /* ---------- overrides & manual ---------- */
  /** duration: 'next' (until next switch point) | number of hours | 'forever' */
  async setOverride(profile, duration = 'next') {
    const cfg = this.get();
    let until = null;
    if (duration === 'next') until = this._nextSwitchDate(cfg);
    else if (Number(duration) > 0) until = new Date(Date.now() + Number(duration) * 3600 * 1000).toISOString();
    cfg.override = { profile, until };
    this.homey.settings.set('heating', cfg);
    this._manual.clear();                       // an explicit house override wins over room manuals
    this.log('info', null, `Heating override: ${profile} ${until ? 'until ' + until : 'until cancelled'}`);
    this._lastProfile = null;
    await this.tick();
  }
  async resume() {
    const cfg = this.get();
    cfg.override = null; this.homey.settings.set('heating', cfg);
    this._manual.clear();
    this.log('info', null, 'Heating: plan resumed');
    this._lastProfile = null;
    await this.tick();
  }

  _nextSwitchDate(cfg) {
    const sch = this.scheduled(cfg);
    if (!sch.next) return null;
    // approximate: minutes until next point, computed in local wall-clock terms
    const { time, dayIdx } = this._now();
    const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    let delta = toMin(sch.next.time) - toMin(time);
    const dayDelta = (DAYS.indexOf(sch.next.day) - dayIdx + 7) % 7;
    delta += dayDelta * 24 * 60;
    if (delta <= 0) delta += 7 * 24 * 60;
    return new Date(Date.now() + delta * 60 * 1000).toISOString();
  }

  /** Called by the thermostat device when its setpoint changed (from Homey UI, wall dial, Home + Control). */
  noteSetpointChange(serial, value) {
    const cfg = this.get();
    if (!cfg.enabled && !this._activeOverride(cfg)) return;
    const room = cfg.rooms[serial];
    if (!room || room.follow === false) return;
    const expected = this._expected.get(serial);
    if (expected != null && Math.abs(expected - value) < 0.01) return;   // our own write echoed back
    const until = this._nextSwitchDate(cfg);
    this._manual.set(serial, { until: until ? new Date(until) : null });
    this.log('info', serial, `Manual setpoint ${value} °C — holding until ${until ? 'next switch point' : 'cancelled'}`);
    this.emit('manual', serial, { value, until });
  }
  /** What the plan thinks about a room: follows?, manual hold?, current effective profile + target. */
  roomState(serial) {
    const cfg = this.get();
    const room = cfg.rooms[serial];
    const follows = !!(room && room.follow !== false);
    const ov = this._activeOverride(cfg);
    const active = cfg.enabled || !!ov;
    const profile = ov ? ov.profile : (cfg.enabled ? this.scheduled(cfg).profile : null);
    const m = this._manual.get(serial);
    return {
      active, follows, profile, override: !!ov,
      manualUntil: this.isManual(serial) ? (m.until ? m.until.toISOString() : null) : undefined,
      manual: this.isManual(serial),
      target: profile ? this.targetFor(cfg, profile, serial) : null,
    };
  }

  /** Put a room back on the plan right away (clears its manual hold and applies the current profile). */
  async rejoin(serial) {
    this._manual.delete(serial);
    const st = this.roomState(serial);
    if (!st.active || !st.follows || st.target == null) return false;
    const dev = this._thermostats().find((d) => d.getData().serial === serial);
    if (!dev) return false;
    this._expected.set(serial, st.target);
    await dev.applyScheduleTarget(st.target);
    return true;
  }

  isManual(serial) {
    const m = this._manual.get(serial);
    if (!m) return false;
    if (m.until && m.until < new Date()) { this._manual.delete(serial); return false; }
    return true;
  }
  clearManual(serial) { this._manual.delete(serial); }

  /* ---------- engine ---------- */
  _thermostats() {
    try { return this.homey.drivers.getDriver('thermostat').getDevices(); } catch (e) { return []; }
  }

  targetFor(cfg, profile, serial) {
    if (HOUSE_PROFILES.includes(profile)) return Number(cfg.house[profile]);
    const room = cfg.rooms[serial];
    const t = room && room.temps && room.temps[profile];
    return t != null ? Number(t) : null;
  }

  async tick() {
    const cfg = this.get();
    const ov = this._activeOverride(cfg);
    // Overrides (Away, Frost guard, ...) work even with the weekly plan switched off.
    if (!cfg.enabled && !ov) { this._lastProfile = null; return; }
    const profile = ov ? ov.profile : this.scheduled(cfg).profile;
    const changed = profile !== this._lastProfile;
    const due = Date.now() - this._lastApply > REAPPLY_MS;
    if (!changed && !due) return;

    if (changed) {
      // a new switch point releases room manual holds that were "until next switch"
      for (const [serial, m] of this._manual) if (m.until) this._manual.delete(serial);
      this.log('info', null, `Heating profile: ${profile}${ov ? ' (override)' : ''}`);
      this.emit('profile-changed', { profile, previous: this._lastProfile });
      this._lastProfile = profile;
    }
    this._lastApply = Date.now();

    for (const dev of this._thermostats()) {
      const serial = dev.getData().serial;
      const room = cfg.rooms[serial];
      if (!room || room.follow === false) continue;
      if (this.isManual(serial)) continue;
      const target = this.targetFor(cfg, profile, serial);
      if (target == null) continue;
      try {
        this._expected.set(serial, target);
        await dev.applyScheduleTarget(target);
      } catch (e) {
        this.log('warn', serial, `schedule apply failed: ${e.message}`);
      }
    }
  }
}

Heating.DAYS = DAYS;
Heating.PROFILES = [...ROOM_PROFILES, ...HOUSE_PROFILES];
module.exports = Heating;
