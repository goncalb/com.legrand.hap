'use strict';
const HapDriver = require('../../lib/HapDriver');

class ShutterDriver extends HapDriver {
  get klass() { return 'shutter'; }

  isAwning(acc) { return /awning|pergola/i.test(String(acc.model || '')); }
  isCurtain(acc) { return /curtain|glydea|rideau/i.test(String(acc.model || '')); }
  isShade(acc) { return /\bscreen\b|rollershade/i.test(String(acc.model || '')); }

  iconFor(acc) {
    if (this.isAwning(acc)) return '/icons/awning.svg';
    if (this.isCurtain(acc)) return '/icons/curtain.svg';
    if (this.isShade(acc)) return '/icons/shade.svg';
    return acc.chars.TargetHorizontalTiltAngle ? '/icons/orientable.svg' : '/icons/roller.svg';
  }

  /** Models that announce what they are pair fully dressed: matching class, icon, and look. */
  decorate(dev, acc) {
    if (this.isAwning(acc)) { dev.class = 'sunshade'; dev.settings.look = 'awning'; }
    else if (this.isCurtain(acc)) { dev.class = 'curtain'; dev.settings.look = 'curtain_split'; }
    else if (this.isShade(acc)) { dev.settings.look = 'shade'; }
    return dev;
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
