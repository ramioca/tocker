/**
 * Vitest stand-in for the `server-only` marker module.
 *
 * `import "server-only"` is resolved by Next's bundler, not by node — the package
 * is not installed — so a test that imports a server query would fail on the
 * import alone. The marker has no runtime behaviour, so an empty module is an
 * exact substitute under vitest. See `vitest.config.mts`.
 */
export {};
