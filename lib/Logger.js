'use strict';

/** Simple ring-buffer log, filterable per device serial. */
class Logger {
  constructor(size = 500) {
    this.size = size;
    this.entries = [];
    this.onChange = null;   // optional persistence hook, debounced by the app
  }

  add(level, serial, msg) {
    this.entries.push({ ts: new Date().toISOString(), level, serial: serial || null, msg });
    if (this.entries.length > this.size) this.entries.splice(0, this.entries.length - this.size);
    if (this.onChange) this.onChange();
  }

  restore(entries) {
    if (Array.isArray(entries)) this.entries = entries.slice(-this.size);
  }

  get({ serial, limit = 200 } = {}) {
    let out = this.entries;
    if (serial) out = out.filter((e) => e.serial === serial);
    return out.slice(-limit).reverse();
  }

  clear() {
    this.entries = [];
    if (this.onChange) this.onChange();
  }
}

module.exports = Logger;
