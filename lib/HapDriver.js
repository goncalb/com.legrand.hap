'use strict';

const Homey = require('homey');

/** Shared pair flow: (optionally) pair a HAP device, then list this driver's accessories. */
class HapDriver extends Homey.Driver {

  get klass() { throw new Error('override'); }

  /** Per-device icon (path relative to the driver assets folder). Override. */
  iconFor(acc) { return null; }

  async onPair(session) {
    const hap = this.homey.app.session;

    session.setHandler('showView', async (viewId) => {
      if (viewId !== 'setup') return;
      // Skip the setup view when something is paired and nothing new is waiting to be paired.
      const candidates = hap.listDiscovered().filter((d) => !d.pairedHere && !d.pairedElsewhere);
      if (hap.isPaired() && candidates.length === 0) await session.nextView();
    });

    session.setHandler('list_gateways', async ({ all } = {}) => hap.listDiscovered({ all }));
    session.setHandler('is_paired', async () => hap.isPaired());
    session.setHandler('pair_gateway', async ({ id, pin, address }) => {
      let addr = null;
      if (address) {
        const m = String(address).trim().match(/^([0-9.]+|[a-zA-Z0-9.-]+?)(?::(\d+))?$/);
        if (!m) throw new Error('Enter an IP, e.g. 192.168.1.80');
        addr = { address: m[1], port: m[2] ? Number(m[2]) : 5001 };
      }
      await hap.pair(id, pin, addr);
      return true;
    });

    session.setHandler('list_devices_selection', async (devices) => { session._selected = devices; });
    session.setHandler('get_selected_devices', async () => session._selected || []);

    session.setHandler('list_devices', async () => {
      try { await hap.refreshAll('pairing'); } catch { /* ignore */ }
      const names = this.homey.settings.get('names') || {};
      return hap.listByClass(this.klass).map((a) => {
        const dev = {
          name: names[a.serial] || a.name,
          data: { serial: a.serial },
          settings: { serial: a.serial, model: a.model || '', firmware: a.firmware || '' },
        };
        const icon = this.iconFor(a);
        if (icon) dev.icon = icon;
        return dev;
      });
    });
  }
}

module.exports = HapDriver;
