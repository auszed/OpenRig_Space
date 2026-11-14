import type { OfficeTheme } from '@backoffice/core';

const m = (color: string, roughness = 0.8, metalness = 0) => ({ color, roughness, metalness });
const glow = (color: string, intensity: number) =>
  ({ color: '#0b0d12', roughness: 0.4, metalness: 0, emissive: color, emissiveIntensity: intensity });

/** After hours: a dark floor lit mostly by its own screens, in red and blue, under faint moonlight. */
export const nightTheme: OfficeTheme = {
  id: 'night',
  name: 'Night shift',
  ui: {
    'panel': 'rgba(18, 21, 30, 0.9)',
    'panel-solid': '#12151e',
    'text': '#e6e9f2',
    'muted': '#8b93a7',
    'border': 'rgba(230, 233, 242, 0.14)',
    'accent': '#3b82f6',
    'accent-text': '#ffffff',
    'screen-bg': '#07090d',
    'screen-text': '#c7dbff',
    'shadow': '0 8px 30px rgba(0, 0, 0, 0.5)',
  },
  background: '#090b12',
  materials: {
    floor: m('#232836', 0.3, 0.25),
    carpet: m('#1a1e2a', 0.95),
    woodFloor: m('#2e2a36', 0.5),
    rubber: m('#161920', 0.9),
    wall: m('#2e3444', 0.85),
    glass: { color: '#7dd3e0', roughness: 0.05, metalness: 0, opacity: 0.1 },
    frame: m('#566079', 0.4, 0.5),
    wood: m('#3f4558', 0.45, 0.15),
    fabric: m('#4a4662', 0.9),
    accent: glow('#3b82f6', 1.4),
    metal: m('#7a849c', 0.35, 0.8),
    dark: m('#141720', 0.6),
    white: m('#a9b1c2', 0.5),
    screenOff: m('#05060a', 0.25, 0.2),
    screenOn: glow('#ff2d55', 1.8),
    plant: m('#2f8a68', 0.8),
    pot: m('#434b60', 0.5),
    grass: m('#16291f', 1),
    path: m('#2c3240', 0.9),
    plinth: m('#1c202b', 0.85),
    trunk: m('#2a2230', 0.9),
    foliage: m('#1f5146', 0.9),
    building: m('#1a1f2c', 0.7),
    skin: m('#d9b08c', 0.7),
    hair: m('#15121a', 0.8),
  },
  podColors: ['#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#fbbf24', '#60a5fa', '#fb7185', '#94a3b8'],
  status: { working: '#34d399', idle: '#64748b', 'needs-input': '#fbbf24', unknown: '#3b4257' },
  lighting: {
    sun: { color: '#9aa8ff', intensity: 0.75, position: [18, 30, 22] },
    sky: { color: '#6f7ccc', ground: '#10131c', intensity: 0.5 },
    environment: 0.25,
    screenGlow: { colors: ['#ff2d55', '#3b82f6'], intensity: 3, distance: 4.5 },
  },
  walkways: { color: '#ff2d55', intensity: 2.4 },
  postFx: {
    bloom: { intensity: 1.1, threshold: 0.5 },
    ambientOcclusion: { enabled: true, intensity: 2, radius: 1.4 },
    vignette: 0.45,
  },
};
