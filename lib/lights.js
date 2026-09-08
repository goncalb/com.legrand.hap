'use strict';

const H = require('./homeyApi');

const TYPES = ['ceiling', 'floor', 'table', 'bulb', 'strip', 'spot', 'switch', 'wall', 'outdoor'];

/** Guess a lamp type from its name; the user can override in App settings → Lights. */
function guessType(name, d) {
  const n = String(name).toLowerCase();
  if (/terrace|terrasse|balcon|balcony|garden|jardin|outdoor|exterior|ext[ée]rieur|porch|driveway/.test(n)) return 'outdoor';
  if (/wall light|wall lamp|sconce|applique|mirror/.test(n)) return 'wall';
  if (/strip|lightstrip|led strip|gradient/.test(n)) return 'strip';
  if (/spot|perifo|track|downlight/.test(n)) return 'spot';
  if (/ceiling|pendant|plafond|chandelier|main light/.test(n)) return 'ceiling';
  if (/floor|corner|standing|arc/.test(n)) return 'floor';
  if (/table|bedside|desk|reading|small lamp|iris|bloom|go\b/.test(n)) return 'table';
  if (/bulb|filament/.test(n)) return 'bulb';
  // one of our own Legrand on/off switches (no dim, no colour): draw the wall switch itself
  if (d && /com\.legrand\.hap/.test(String(d.driverId || '')) && !H.cap(d, 'dim') && !H.cap(d, 'light_hue')) return 'switch';
  return 'ceiling';
}

const typeOf = (homey, d) => (homey.settings.get('lightTypes') || {})[d.id] || guessType(d.name, d);

function hsvToHex(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return '#' + [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
function mixHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/** The colour a lamp currently emits (for the drawing): colour bulbs by hue/sat, whites by temperature, plain by warm default. */
function colourOf(d) {
  const mode = H.capValue(d, 'light_mode');
  const hue = H.capValue(d, 'light_hue'), sat = H.capValue(d, 'light_saturation'), temp = H.capValue(d, 'light_temperature');
  if (mode === 'color' && hue != null && sat != null) return hsvToHex(hue, Math.max(0.15, sat), 1);
  if (temp != null) return mixHex('#dff4ff', '#ffc966', Math.max(0, Math.min(1, temp)));   // cool → warm white
  if (hue != null && sat != null && sat > 0.1) return hsvToHex(hue, sat, 1);
  return '#ffd166';
}

/** Colour from explicit values (used for moods, which store capability values rather than a device). */
function colourFrom({ hue, sat, temp }) {
  if (hue != null && sat != null) return hsvToHex(hue, Math.max(0.15, sat), 1);
  if (temp != null) return mixHex('#dff4ff', '#ffc966', Math.max(0, Math.min(1, temp)));
  return '#ffd166';
}

function describe(homey, d) {
  const dim = H.capValue(d, 'dim');
  return {
    id: d.id, name: d.name, zone: d.zone, type: typeOf(homey, d),
    on: H.isOn(d), available: d.available !== false, dim: dim == null ? null : Math.round(dim * 100),
    colour: colourOf(d), hasDim: !!H.cap(d, 'dim'), hasColour: !!H.cap(d, 'light_hue'), hasTemp: !!H.cap(d, 'light_temperature'),
    hue: H.capValue(d, 'light_hue'), temp: H.capValue(d, 'light_temperature'), mode: H.capValue(d, 'light_mode'),
  };
}

module.exports = { TYPES, describe, colourFrom };
