import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Consumer-side checks shared by the packed-tarball test (008) and the registry test (009).
// Everything runs inside a consumer directory, so 'akarisp' resolves to what that consumer
// installed, never to this repository.

const repo = new URL('..', import.meta.url).pathname;

export const internal = ['akarisp/core', 'akarisp/browser', 'akarisp/internal', 'akarisp/dist/index.js',
  'akarisp/dist/core/runtime.js', 'akarisp/src/index.ts', 'akarisp/package.json'];

export const RESOLUTIONS = [['bundler', 'esnext'], ['node16', 'node16'], ['nodenext', 'nodenext']];

/** Run code in a child process inside the consumer. */
export function run(consumer: string, code: string, commonjs = false) {
  const args = commonjs ? ['-e', code] : ['--input-type=module', '-e', code];
  const r = spawnSync(process.execPath, args, { cwd: consumer, encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr };
}

export const keys = (consumer: string, spec: string) =>
  run(consumer, `const m = await import('${spec}'); console.log(Object.keys(m).sort().join())`);

/** Type-check consumer files with the repository's TypeScript. */
export function tsc(consumer: string, resolution: string, module: string, files: string[]) {
  return spawnSync(join(repo, 'node_modules/.bin/tsc'), ['--noEmit', '--strict', '--target', 'es2022', '--lib', 'es2022,dom',
    '--skipLibCheck', 'false', '--moduleResolution', resolution, '--module', module, ...files], { cwd: consumer, encoding: 'utf8' });
}
