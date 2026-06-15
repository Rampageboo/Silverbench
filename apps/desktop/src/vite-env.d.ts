/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_YWB_BACKEND_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __YWB_BACKEND_HOST__: string | undefined;
declare const __YWB_BACKEND_PORT__: string | undefined;
