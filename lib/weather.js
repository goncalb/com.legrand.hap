'use strict';

const https = require('https');

let cache = { t: 0, kind: 'clear' };

/** WMO weather code → what the widget sky should show. */
function kindFromCode(code) {
  if (code == null) return 'clear';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  if (code === 3 || code === 45 || code === 48) return 'cloud';
  return 'clear';
}

/**
 * Current weather kind at Homey's location: 'rain' | 'snow' | 'cloud' | 'clear'.
 * Open-Meteo (no API key), cached 15 minutes; on failure keeps the last kind and retries after 3 minutes.
 */
async function current(homey) {
  if (Date.now() - cache.t < 15 * 60 * 1000) return cache.kind;
  try {
    const lat = homey.geolocation.getLatitude(), lon = homey.geolocation.getLongitude();
    if (lat == null || lon == null) throw new Error('no location');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code`;
    const body = await new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 5000 }, (res) => {
        let out = '';
        res.on('data', (c) => { out += c; });
        res.on('end', () => resolve(out));
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
    });
    cache = { t: Date.now(), kind: kindFromCode(JSON.parse(body).current.weather_code) };
  } catch {
    cache = { t: Date.now() - 12 * 60 * 1000, kind: cache.kind };
  }
  return cache.kind;
}

module.exports = { current, kindFromCode };
