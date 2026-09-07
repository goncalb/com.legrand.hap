'use strict';
module.exports = {
  async getScenes({ homey }) { return homey.app.scenes.list().map((s) => ({ id: s.id, name: s.name, icon: s.icon || '' })); },
  async run({ homey, body }) { await homey.app.scenes.run(body.id); return true; },
};
