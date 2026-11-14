import type { OfficeTheme } from '@backoffice/core';

const m = (color: string, roughness = 0.8, metalness = 0) => ({ color, roughness, metalness });
const glow = (color: string, intensity: number) =>
  ({ color: '#0b0d12', roughness: 0.4, metalness: 0, emissive: color, emissiveIntensity: intensity });

/** After hours: dusky surfaces lit by cool moonlight, with cyan screens. Readable first, moody second. */
export const nightTheme: OfficeTheme = {
  id: 'night',
  name: 'Night shift',
  ui: {
    'panel': 'rgba(18, 21, 30, 0.9)',
    'panel-solid': '#12151e',
    'text': '#e6e9f2',
    'muted': '#8b93a7',
    'border': 'rgba(230, 233, 242, 0.14)',
    'accent': '#22d3ee',
    'accent-text': '#06121a',
    'screen-bg': '#07090d',
    'screen-text': '#b9f3ff',
    'shadow': '0 8px 30px rgba(0, 0, 0, 0.5)',
  },
  background: '#0d111b',
  materials: {
    floor: m('#2c3242', 0.4, 0.15),
    carpet: m('#232838', 0.95),
    woodFloor: m('#3a3442', 0.5),
    rubber: m('#1d212c', 0.9),
    wall: m('#3a4154', 0.85),
    glass: { color: '#7dd3e0', roughness: 0.05, metalness: 0, opacity: 0.1 },
    frame: m('#566079', 0.4, 0.5),
    wood: m('#4d5469', 0.5, 0.1),
    fabric: m('#5a5578', 0.9),
    accent: glow('#22d3ee', 1.1),
    metal: m('#7a849c', 0.35, 0.8),
    dark: m('#1b1f2a', 0.6),
    white: m('#c3cad8', 0.5),
    screenOff: m('#05060a', 0.25, 0.2),
    screenOn: glow('#22d3ee', 1.7),
    plant: m('#2f8a68', 0.8),
    pot: m('#434b60', 0.5),
    grass: m('#16291f', 1),
    path: m('#2c3240', 0.9),
    plinth: m('#252a37', 0.85),
    trunk: m('#2a2230', 0.9),
    foliage: m('#1f5146', 0.9),
    building: m('#222838', 0.7),
    skin: m('#d9b08c', 0.7),
    hair: m('#15121a', 0.8),
  },
  podColors: ['#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#fbbf24', '#60a5fa', '#fb7185', '#94a3b8'],
  status: { working: '#34d399', idle: '#64748b', 'needs-input': '#fbbf24', unknown: '#3b4257' },
  lighting: {
    sun: { color: '#b4c2ff', intensity: 1.6, position: [18, 30, 22] },
    sky: { color: '#8a97e6', ground: '#1a1e2b', intensity: 1.0 },
    environment: 0.45,
  },
  postFx: {
    bloom: { intensity: 0.8, threshold: 0.55 },
    ambientOcclusion: { enabled: true, intensity: 2, radius: 1.4 },
    vignette: 0.3,
  },
};
