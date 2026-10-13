declare const __FALLBACK_VERSION__: string;

// Injected at build time (tsup and vitest `define`) so the version does not
// depend on locating package.json at runtime under whatever name it installs.
export const FALLBACK_VERSION: string = __FALLBACK_VERSION__;
