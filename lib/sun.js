'use strict';

/** NOAA sunrise/sunset (good to ~1 min) for a date at lat/lon. Returns { sunrise, sunset } as Date, or null in polar cases. */
function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180;
  // Julian day *number* of the date (noon-based integer), then days since J2000
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const jdn = Math.floor(dayStart / 86400000 + 2440587.5 + 0.5);
  const n = jdn - 2451545.0 + 0.0008;
  const Jstar = n - lon / 360;          // lon: east positive (the formula uses longitude west, hence the minus)
  const M = (357.5291 + 0.98560028 * Jstar) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const Jtransit = 2451545.0 + Jstar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const delta = Math.asin(Math.sin(lambda * rad) * Math.sin(23.44 * rad));
  const cosW = (Math.sin(-0.83 * rad) - Math.sin(lat * rad) * Math.sin(delta)) / (Math.cos(lat * rad) * Math.cos(delta));
  if (cosW < -1 || cosW > 1) return null;
  const w = Math.acos(cosW) / rad;
  const toDate = (j) => new Date((j - 2440587.5) * 86400000);
  return { sunrise: toDate(Jtransit - w / 360), sunset: toDate(Jtransit + w / 360) };
}

const lerp = (a, b, t) => a + (b - a) * t;
const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t));

// sky keyframes: [top, bottom]
const NIGHT = [[21, 28, 51], [42, 53, 86]];
const DAWN = [[159, 183, 232], [255, 215, 168]];
const DAY = [[143, 195, 255], [223, 240, 255]];
const GOLDEN = [[111, 127, 184], [246, 163, 92]];

/**
 * Sky palette for a moment: continuous blend night → dawn → day → golden → night around the day's sun times.
 * Returns { top, bottom, phase: 'night'|'dawn'|'day'|'dusk', sun: bool, moon: bool }.
 */
function skyPalette(now, lat, lon) {
  const st = (lat != null && lon != null) ? sunTimes(now, lat, lon) : null;
  const t = now.getTime();
  const sunrise = st ? st.sunrise.getTime() : new Date(now).setHours(7, 0, 0, 0);
  const sunset = st ? st.sunset.getTime() : new Date(now).setHours(19, 30, 0, 0);
  const H = 3600000;
  let top, bottom, phase;
  const blend = (a, b, f) => [mix(a[0], b[0], f), mix(a[1], b[1], f)];
  if (t < sunrise - H) { [top, bottom] = NIGHT; phase = 'night'; }
  else if (t < sunrise) { [top, bottom] = blend(NIGHT, DAWN, (t - (sunrise - H)) / H); phase = 'dawn'; }
  else if (t < sunrise + 1.5 * H) { [top, bottom] = blend(DAWN, DAY, (t - sunrise) / (1.5 * H)); phase = 'dawn'; }
  else if (t < sunset - 1.5 * H) { [top, bottom] = DAY; phase = 'day'; }
  else if (t < sunset) { [top, bottom] = blend(DAY, GOLDEN, (t - (sunset - 1.5 * H)) / (1.5 * H)); phase = 'dusk'; }
  else if (t < sunset + H) { [top, bottom] = blend(GOLDEN, NIGHT, (t - sunset) / H); phase = 'dusk'; }
  else { [top, bottom] = NIGHT; phase = 'night'; }
  return { top: hex(top), bottom: hex(bottom), phase, sun: t > sunrise + 0.5 * H && t < sunset - 0.5 * H, moon: t < sunrise - 0.5 * H || t > sunset + 0.5 * H };
}

module.exports = { sunTimes, skyPalette };
