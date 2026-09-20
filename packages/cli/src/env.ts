// Set before the engine is imported so the walker's libuv thread pool is warm.
process.env.UV_THREADPOOL_SIZE ??= '16';

// Updater/analytics suppression for every subprocess the CLI spawns, including
// code paths that build their own child env instead of going through runProbe.
// Loaded after the threadpool size is set: a static import would hoist the
// whole core module graph ahead of it.
const { HARDENED_ENV } = await import('@diskwise/core');
Object.assign(process.env, HARDENED_ENV);

export {};
