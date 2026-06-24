// Theming. Presets override the accent family; "brand" derives a readable
// accent family from one color. Base paper/ink stay fixed so text is always legible.

export const PRESETS = {
  pine:     { label: 'Pine',     accent: '#1C6E78' },
  slate:    { label: 'Slate',    accent: '#34568C' },
  forest:   { label: 'Forest',   accent: '#2F7A45' },
  plum:     { label: 'Plum',     accent: '#7A3F6E' },
  graphite: { label: 'Graphite', accent: '#44515F' },
};

function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function mix(hex, target, t) {
  const a = hexToRgb(hex), b = hexToRgb(target);
  if (!a || !b) return hex;
  return toHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}

// Build the four accent tokens from a single accent color.
function accentFamily(accent) {
  return {
    '--accent': accent,
    '--accent-deep': mix(accent, '#000000', 0.22),
    '--accent-soft': mix(accent, '#ffffff', 0.88),
    '--accent-border': mix(accent, '#ffffff', 0.74),
  };
}

// themeStr is the JSON stored per workspace, e.g. {"preset":"pine","accent":""}.
export function applyTheme(themeStr) {
  let preset = 'pine', accent = '';
  try {
    const t = themeStr ? JSON.parse(themeStr) : {};
    preset = t.preset || 'pine';
    accent = t.accent || '';
  } catch { /* ignore */ }

  const base = accent || (PRESETS[preset] || PRESETS.pine).accent;
  const vars = accentFamily(base);
  const root = document.documentElement;
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
}
