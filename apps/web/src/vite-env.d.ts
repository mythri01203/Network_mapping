/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the FiberGIS API server. Empty means same origin (the Vite dev proxy). */
  readonly VITE_API_URL?: string;
  /** Google Maps JavaScript API key for the street photo in the 3D view. Set in .env.local, never in git. */
  readonly VITE_GOOGLE_MAPS_KEY?: string;
}

declare module 'virtual:fibergis-twin' {
  /** What the running twin lets the app do. */
  export interface TwinHandle {
    /** Goes to a customer, box or the OLT by record id. False when it is not drawn. */
    goId: (id: string) => boolean;
    setPon: (index: number) => void;
    dispose: () => void;
  }
  export const twinMarkup: string;
  export const twinCss: string;
  export function startTwin(three: object, data: object): TwinHandle;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
