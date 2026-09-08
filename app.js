'use strict';

const Homey = require('homey');
const HapSession = require('./lib/HapSession');
const Logger = require('./lib/Logger');
const Scenes = require('./lib/Scenes');
const Heating = require('./lib/Heating');

class LegrandHapApp extends Homey.App {

  async onInit() {
    this.logger = new Logger(500);
    const hlog = (level, serial, msg) => { this.logger.add(level, serial, msg); this.log(`[${serial || 'app'}] ${msg}`); };
    this.hlog = hlog;
    // Runtime and SDK messages (deprecations, unhandled errors) otherwise only reach stdout — mirror them into the Log tab.
    const origWarn = console.warn.bind(console), origError = console.error.bind(console);
    console.warn = (...a) => { this.logger.add('warn', null, `runtime: ${a.map(String).join(' ')}`); origWarn(...a); };
    console.error = (...a) => { this.logger.add('error', null, `runtime: ${a.map(String).join(' ')}`); origError(...a); };
    process.on('warning', (w) => this.logger.add('warn', null, `runtime: ${w.name}: ${w.message}`));
    process.on('unhandledRejection', (r) => this.logger.add('error', null, `unhandled: ${r && r.stack ? r.stack.split('\n')[0] : r}`));

    this._migrateSettings();

    this.session = new HapSession({
      log: hlog,
      loadEndpoints: () => this.homey.settings.get('endpoints') || {},
      saveEndpoints: (eps) => this.homey.settings.set('endpoints', eps),
    });

    this.session.on('accessory-added', (acc) => {
      hlog('info', acc.serial, `New accessory: "${acc.name}" (${acc.model})`);
      this.homey.notifications.createNotification({
        excerpt: `Legrand: new device **${acc.name}** (${acc.model}) detected. Add it via the app's pairing wizard.` }).catch(() => {});
    });
    this.session.on('accessory-removed', (acc) => hlog('warn', acc.serial, `Accessory removed: "${acc.name}"`));

    this.homey.settings.on('set', (key) => {
      if (key === 'exposeStandardTilt') {
        hlog('info', null, `Standard tilt capability ${this.homey.settings.get(key) ? 'enabled' : 'disabled'} — resyncing shutters`);
        this.session.emit('db');
      }
    });

    this.scenes = new Scenes(this.homey, hlog);
    const sceneCard = this.homey.flow.getActionCard('scene_activate');
    sceneCard.registerArgumentAutocompleteListener('scene', async (query) =>
      this.scenes.list().filter((sc) => sc.name.toLowerCase().includes((query || '').toLowerCase())).map((sc) => ({ id: sc.id, name: sc.name })));
    sceneCard.registerRunListener(async ({ scene }) => this.scenes.run(scene.id));

    this.heating = new Heating(this.homey, hlog);
    this.heating.error = (e) => hlog('warn', null, `heating: ${e.message}`);
    this.homey.flow.getActionCard('heating_set_profile').registerRunListener(async ({ profile, duration }) => this.heating.setOverride(profile, duration));
    this.homey.flow.getActionCard('heating_resume').registerRunListener(async () => this.heating.resume());
    this.homey.flow.getConditionCard('heating_profile_is').registerRunListener(async ({ profile }) => this.heating.status().effective === profile);
    const profileTrigger = this.homey.flow.getTriggerCard('heating_profile_changed');
    this.heating.on('profile-changed', ({ profile, previous }) => profileTrigger.trigger({ profile, previous: previous || '' }).catch(() => {}));
    const PROF = { comfort: 'Comfort', eco: 'Eco', night: 'Night', away: 'Away', frost: 'Frost guard' };
    this.heating.on('profile-changed', ({ profile }) => {
      if (!this.homey.settings.get('heatingNotify')) return;
      const st = this.heating.status();
      const detail = st.override
        ? (st.override.until ? `override until ${new Date(st.override.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'override until cancelled')
        : (st.next ? `plan "${st.plan}" · next ${PROF[st.next.profile]} at ${st.next.time}` : `plan "${st.plan}"`);
      this.homey.notifications.createNotification({ excerpt: `🌡️ Heating: **${PROF[profile] || profile}** — ${detail}` }).catch(() => {});
    });
    const refreshModes = () => { try { for (const d of this.homey.drivers.getDriver('thermostat').getDevices()) d._setMode().catch(() => {}); } catch { /* ignore */ } };
    this.heating.on('profile-changed', () => setTimeout(refreshModes, 1500));
    this.heating.on('manual', () => setTimeout(refreshModes, 500));
    this.heating.on('manual', (serial, { value, until }) => {
      if (!this.homey.settings.get('heatingNotifyRooms')) return;
      let name = serial;
      try { const d = this.homey.drivers.getDriver('thermostat').getDevices().find((x) => x.getData().serial === serial); if (d) name = d.getName(); } catch { /* ignore */ }
      const when = until ? `until ${new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'until cancelled';
      this.homey.notifications.createNotification({ excerpt: `🌡️ ${name}: manual **${value} °C** ${when}` }).catch(() => {});
    });
    this.homey.settings.on('set', (key) => { if (key === 'heating') setTimeout(refreshModes, 1500); });
    this.heating.start();

    // Widget: scene pickers
    try {
      const w = this.homey.dashboards.getWidget('scenes');
      for (let i = 1; i <= 6; i++) {
        w.registerSettingAutocompleteListener(`scene${i}`, async (query) =>
          this.scenes.list().filter((sc) => sc.name.toLowerCase().includes((query || '').toLowerCase()))
            .map((sc) => ({ name: (sc.icon ? sc.icon + ' ' : '') + sc.name, id: sc.id })));
      }
    } catch (e) { hlog('warn', null, `widget setup: ${e.message}`); }

    this.session.start();

    // Homey core mDNS discovery (works across the app container's network restrictions)
    try {
      const strategy = this.homey.discovery.getStrategy('hap');
      for (const r of Object.values(strategy.getDiscoveryResults())) this.session.onHomeyDiscovery(r);
      strategy.on('result', (r) => this.session.onHomeyDiscovery(r));
    } catch (e) {
      hlog('warn', null, `Homey discovery unavailable: ${e.message}`);
    }

    this.log('Legrand HAP app initialised');
  }

  /** v0.1 stored a single gateway (hapPairing/gatewayId/gatewayAddress); fold it into `endpoints`. */
  _migrateSettings() {
    const s = this.homey.settings;
    const id = s.get('gatewayId'), pairing = s.get('hapPairing');
    if (!id || !pairing) return;
    const endpoints = s.get('endpoints') || {};
    if (!endpoints[id]) {
      endpoints[id] = { pairing, address: s.get('gatewayAddress') || null, name: 'Legrand Gateway' };
      s.set('endpoints', endpoints);
      this.log(`Migrated gateway ${id} into endpoints`);
    }
    s.unset('gatewayId'); s.unset('hapPairing'); s.unset('gatewayAddress');
  }

  async onUninit() { this.heating.stop(); await this.session.stop(); }
}

module.exports = LegrandHapApp;
