#!/usr/bin/env node
import './env';
import { createCoreEngine, setEngine } from './engine';
import { buildProgram } from './program';

setEngine(createCoreEngine());

buildProgram({
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  isTTY: Boolean(process.stdout.isTTY),
})
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
