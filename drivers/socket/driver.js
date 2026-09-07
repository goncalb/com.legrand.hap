'use strict';
const HapDriver = require('../../lib/HapDriver');

class SocketDriver extends HapDriver {
  get klass() { return 'socket'; }
}

module.exports = SocketDriver;
