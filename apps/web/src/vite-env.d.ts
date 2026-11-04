/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the FiberGIS API server. Empty means same origin (the Vite dev proxy). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
