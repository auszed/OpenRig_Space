import type { AgentStatus } from './model.ts';
import type { FurnitureKind } from './layout.ts';

/** A physically based material, described as data so a theme needs no 3D library. */
export interface PbrMaterial {
  color: string;
  roughness: number;
  metalness: number;
  /** 0-1. Below 1 the surface is see-through (glass). */
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
}

/** Every surface in the office is painted with one of these slots. */
export type MaterialSlot =
  | 'floor' | 'carpet' | 'woodFloor' | 'rubber'
  | 'wall' | 'glass' | 'frame'
  | 'wood' | 'fabric' | 'accent' | 'metal' | 'dark' | 'white'
  | 'screenOff' | 'screenOn'
  | 'plant' | 'pot'
  | 'grass' | 'path' | 'plinth' | 'trunk' | 'foliage' | 'building'
  | 'skin' | 'hair';

export interface OfficeTheme<FurnitureBuilder = unknown> {
  id: string;
  name: string;
  /** CSS custom properties for the panels around the 3D view (without the leading "--"). */
  ui: Record<string, string>;
  background: string;
  materials: Record<MaterialSlot, PbrMaterial>;
  /** Shirt colours, handed out to pods in order. */
  podColors: string[];
  status: Record<AgentStatus, string>;
  lighting: {
    sun: { color: string; intensity: number; position: [number, number, number] };
    sky: { color: string; ground: string; intensity: number };
    /** Strength of the reflected room light on PBR surfaces. */
    environment: number;
    /**
     * Lit screens cast their own coloured light onto desk, chair and floor. Desk screens take the
     * colours in turn; wall screens take the first. Leave out for screens that only glow.
     */
    screenGlow?: { colors: string[]; intensity: number; distance: number };
  };
  postFx: {
    bloom: { intensity: number; threshold: number };
    ambientOcclusion: { enabled: boolean; intensity: number; radius: number };
    vignette: number;
  };
  /** Draws the walkways as glowing lines on the floor. Leave out to keep them invisible. */
  walkways?: { color: string; intensity: number };
  /**
   * Optional replacements for individual pieces of furniture. The office app
   * ships a builder for every kind; a theme only lists the ones it redraws.
   */
  furniture?: Partial<Record<FurnitureKind, FurnitureBuilder>>;
}
