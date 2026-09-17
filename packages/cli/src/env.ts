// Set before the engine is imported so the walker's libuv thread pool is warm.
process.env.UV_THREADPOOL_SIZE ??= '16';

export {};
