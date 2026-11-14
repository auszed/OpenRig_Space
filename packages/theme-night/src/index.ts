import type { OfficeTheme } from '@backoffice/core';

const m = (color: string, roughness = 0.8, metalness = 0) => ({ color, roughness, metalness });
const glow = (color: string, intensity: number) =>
  ({ color: '#0b0d12', roughness: 0.4, metalness: 0, emissive: color, emissiveIntensity: intensity });

/** After hours: dark surfaces, cyan and violet light. Exists to prove a theme changes everything. */
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
  background: '#070910',
  materials: {
    floor: m('#1c202b', 0.35, 0.2),
    carpet: m('#11141c', 0.95),
    woodFloor: m('#2a2430', 0.5),
    rubber: m('#0e1016', 0.9),
    wall: m('#262b3a', 0.85),
    glass: { color: '#5eead4', roughness: 0.05, metalness: 0, opacity: 0.14 },
    frame: m('#3b4257', 0.4, 0.6),
    wood: m('#3a3f52', 0.5, 0.1),
    fabric: m('#7c3aed', 0.85),
    accent: glow('#22d3ee', 1.6),
    metal: m('#59627a', 0.3, 0.9),
    dark: m('#0c0e13', 0.6),
    white: m('#aab2c5', 0.5),
    screenOff: m('#05060a', 0.25, 0.2),
    screenOn: glow('#22d3ee', 2.2),
    plant: m('#1f6f54', 0.8),
    pot: m('#2f3547', 0.5),
    grass: m('#0e1c18', 1),
    path: m('#1f2430', 0.9),
    plinth: m('#161a24', 0.85),
    trunk: m('#2a2230', 0.9),
    foliage: m('#143a33', 0.9),
    building: m('#151925', 0.7),
    skin: m('#d9b08c', 0.7),
    hair: m('#15121a', 0.8),
  },
  podColors: ['#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#fbbf24', '#60a5fa', '#fb7185', '#94a3b8'],
  status: { working: '#34d399', idle: '#64748b', 'needs-input': '#fbbf24', unknown: '#3b4257' },
  lighting: {
    sun: { color: '#8ea2ff', intensity: 0.7, position: [18, 30, 22] },
    sky: { color: '#5b6cff', ground: '#0a0c14', intensity: 0.35 },
    environment: 0.2,
  },
  postFx: {
    bloom: { intensity: 1.1, threshold: 0.45 },
    ambientOcclusion: { enabled: true, intensity: 3, radius: 1.6 },
    vignette: 0.55,
  },
};
