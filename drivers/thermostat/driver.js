'use strict';
const HapDriver = require('../../lib/HapDriver');

class ThermostatDriver extends HapDriver {
  get klass() { return 'thermostat'; }

  async onInit() {
    this.heatingTrigger = this.homey.flow.getDeviceTriggerCard('thermostat_heating_changed');
    this.heatingTrigger.registerRunListener(async (args, state) => args.state === state.state);
    this.homey.flow.getConditionCard('thermostat_is_heating').registerRunListener(async ({ device }) => device.isHeating());
  }
}

module.exports = ThermostatDriver;
