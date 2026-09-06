'use strict';
const HapDriver = require('../../lib/HapDriver');

class ShutterDriver extends HapDriver {
  get klass() { return 'shutter'; }

  iconFor(acc) {
    return acc.chars.TargetHorizontalTiltAngle ? '/icons/orientable.svg' : '/icons/roller.svg';
  }

  async onInit() {
    this.homey.flow.getConditionCard('shutter_is_moving')
      .registerRunListener(async ({ device }) => device.isMoving());
    this.homey.flow.getActionCard('shutter_set_tilt')
      .registerRunListener(async ({ device, angle }) => device.setTilt(angle));
    this.homey.flow.getActionCard('shutter_set_tilt_and_position')
      .registerRunListener(async ({ device, position, angle }) => device.setPositionAndTilt(position, angle));
  }
}

module.exports = ShutterDriver;
