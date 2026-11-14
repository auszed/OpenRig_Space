import type { OfficeTheme } from '@backoffice/core';
import { nightTheme } from '@backoffice/theme-night';
import { studioTheme } from '@backoffice/theme-studio';
import type { FurnitureBuilder } from './scene/build/kit.ts';

/** To add a look: write a theme package, import it, add it to this list. */
export const themes = [studioTheme, nightTheme] as OfficeTheme<FurnitureBuilder>[];

export const themeById = (id: string | null) => themes.find((t) => t.id === id) ?? themes[0]!;
