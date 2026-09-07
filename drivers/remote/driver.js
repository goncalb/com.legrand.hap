'use strict';
const HapDriver = require('../../lib/HapDriver');

class RemoteDriver extends HapDriver {
  get klass() { return 'remote'; }

  async onInit() {
    this.buttonTrigger = this.homey.flow.getDeviceTriggerCard('remote_button_pressed');
    this.buttonTrigger.registerRunListener(async (args, state) => String(args.button) === String(state.button) && (args.press === 'any' || args.press === state.press));
  }
}

module.exports = RemoteDriver;
