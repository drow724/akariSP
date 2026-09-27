# Contract: release procedure and registry check

The only interface this feature adds is a maintainer procedure and one command. There is no
runtime or public API change.

## Command

```bash
RELEASE=<version> npm run test:registry
```

- `RELEASE` defaults to the `version` in the repository `package.json`.
- It reads `releases/<RELEASE>.json` (the intent). It fails if the file is missing, or if
  the version inside the file does not match its file name.
- It writes `releases/<RELEASE>.verified.json` (the result) and exits non-zero on any mismatch or
  failed check.
- It needs the public npm registry. It installs anonymously and never publishes or changes tags.
- It is not part of `npm test`.

## Checks, in order

1. **Metadata vs intent, retried up to 10 minutes.** The fields compared are name, version, the
   dist-tags listed in the intent, runtime dependencies, and entry points. Reads repeat every
   20 s until they match or the window expires.
2. **Installs.** A clean consumer installs `akarisp`, and another installs `akarisp@alpha`. Each
   resolved version must equal the intent's target for `latest` and `alpha`. `node_modules`
   must contain only `akarisp`.
3. **Imports in each consumer.**
   - `akarisp` must export `TaskError` and `createRuntime`.
   - `akarisp/webllm` must export `createWebLLMRuntime`.
   - The internal paths must fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`: `akarisp/core`,
     `akarisp/browser`, `akarisp/internal`, `akarisp/dist/…`, `akarisp/src/index.ts`,
     `akarisp/package.json`.
4. **Types.** The shared fixtures `root.ts`, `webllm.ts`, and `internal.ts` type-check under
   `bundler`, `node16`, and `nodenext`. This concerns AkariSP's declarations only.

## Maintainer procedure (README "Release")

1. Bump `version`. Write and commit `releases/<version>.json`, naming every intended dist-tag
   target.
2. Publish, naming the tag:

   ```bash
   npm publish --tag <tag>
   ```

3. For each additional tag the intent names, move it explicitly:

   ```bash
   npm dist-tag add akarisp@<version> <tag>
   ```

4. Verify and commit the result:

   ```bash
   RELEASE=<version> npm run test:registry
   ```

5. If a mismatch is found, fix forward:
   - Tag mismatch: move the tag with `npm dist-tag add`, then re-run the check.
   - Content defect: publish the next version. Never unpublish.

   Record both the mismatch and the fix in the discrepancy record.
