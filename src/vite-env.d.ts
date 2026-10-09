/// <reference types="vite/client" />

/** The icon theme's SVG table alone (aliased in vite.config.ts). */
declare module "material-icon-svgs" {
  export const iconData: Readonly<Record<string, string>>;
}
