// Records real probe output from *this* Mac into fixtures/probes/ so unit tests
// can replay it. Run from anywhere:
//   node --experimental-strip-types packages/core/scripts/record-probes.ts
// (imports carry explicit .ts extensions because Node's type stripping, unlike
// the app build, does not resolve extensionless specifiers)
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordProbe } from '../src/probes/replay.ts';
import { runProbe } from '../src/probes/run.ts';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = resolve(scriptDir, '../../../fixtures/probes');

const probes: { bin: string; args: string[] }[] = [
  { bin: 'diskutil', args: ['info', '-plist', '/'] },
  { bin: 'tmutil', args: ['listlocalsnapshots', '/'] },
];

for (const probe of probes) {
  const result = await runProbe(probe.bin, probe.args);
  await recordProbe(outDir, probe.bin, probe.args, result);
  console.log(`${probe.bin} ${probe.args.join(' ')} → exit ${result.exitCode}`);
}

console.log(`Recorded ${probes.length} probes into ${outDir}`);
