'use strict';
const HapDriver = require('../../lib/HapDriver');

class SensorDriver extends HapDriver {
  get klass() { return 'sensor'; }
}

module.exports = SensorDriver;
