'use strict';
const HapDriver = require('../../lib/HapDriver');

class LightDriver extends HapDriver {
  get klass() { return 'light'; }

  iconFor(acc) {
    return acc.chars.Brightness ? '/icons/dimmer.svg' : '/icons/single.svg';
  }
}

module.exports = LightDriver;
