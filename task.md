# diskwise improvement tasks

This backlog captures the project review performed on 2026-09-20. Tasks are ordered by release risk and impact.

## P0 — Block destructive release

### [x] Secure saved cleanup plans

**Problem:** `diskwise clean --plan <file>` accepts plan-controlled `action`, `tier`, `roots`, `preflight`, `permanentOnly`, and `needsConfirmation` values. Execution validates a target against roots supplied by that same plan instead of reloading the authoritative rule. A modified plan can therefore weaken the safety model.

Relevant code:

- `packages/cli/src/program.ts`
- `packages/core/src/plan/schema.ts`
- `packages/core/src/execute/execute.ts`
- `packages/core/src/safety/paths.ts`

Work:

- Treat saved plans as observations and selections, not execution authority.
- Resolve every `ruleId` against the current rule catalog during execution.
- Derive action, tier, roots, preflight, permanence, and confirmation requirements from the catalog.
- Reject unknown rules and any plan metadata that conflicts with the catalog.
- Revalidate or rescan each target before applying the plan.
- Preserve and verify the recorded `(dev, ino, kind)` identity.
- Ensure confirmation requirements cannot be disabled in plan JSON.
- Apply equivalent validation to path actions, vendor actions, virtual matches, app plans, and Trash operations.
- Consider a narrower serialized plan format containing only plan metadata, selections, target identity, and server-generated identifiers.

Acceptance criteria:

- A crafted plan cannot expand roots, change actions or tiers, remove confirmation, or invoke an unrelated vendor action.
- A crafted plan cannot delete an arbitrary path or empty Trash without the catalog-defined confirmation.
- Stale, unknown, and catalog-mismatched plans are rejected with a clear error.
- Valid plans produced by `diskwise plan` continue to support dry runs and execution.
- Adversarial plan tests cover arbitrary roots, action substitution, tier substitution, disabled confirmation, virtual actions, duplicate IDs, and stale identities.

## P1 — Correctness and safety

### [x] Fail simulator actions when `simctl` fails

**Problem:** simulator actions call the probe runner without checking its exit code. The executor can then report the action as complete and assume zero bytes remain.

Relevant code:

- `packages/core/src/execute/actions.ts`
- `packages/core/src/execute/execute.ts`

Work:

- Route simulator commands through the checked command execution path.
- Validate non-zero exit codes, timeouts, and stderr.
- Do not assume all virtual bytes were freed unless the action succeeded.
- Re-probe simulator state after deletion when practical and report the measured result.

Acceptance criteria:

- Failed and timed-out `simctl` commands produce `failed`, not `done`.
- Failed commands report zero freed bytes.
- Tests cover runtime deletion and unavailable-device deletion failures.

### [x] Separate orphaned app data from ordinary cleanable caches

**Problem:** orphaned `Application Support` and `Containers` locations are Tier 2 data but are marked actionable and included in cleanable totals. The UI can present them as an ordinary cache cleanup even though the backend excludes them without explicit opt-in.

Relevant code:

- `packages/core/src/apps/orphans.ts`
- `packages/core/src/apps/plan.ts`
- `packages/ui/src/lib/derive.ts`
- `packages/ui/src/screens/Apps.tsx`
- `packages/cli/src/commands/apps.ts`

Work:

- Model these states separately: `cleanable`, `deletableWithConfirmation`, and `reportOnly`.
- Count only Tier 0/1 cache, log, and saved-state locations as cleanable.
- Count orphaned Tier 2 locations as app data until the user explicitly selects them.
- Give orphaned data a distinct “Move app data to Trash” flow.
- Require typed confirmation and preserve undo for that flow.
- Ensure UI totals, CLI totals, review plans, and execution plans agree.

Acceptance criteria:

- Tier 2 orphaned data never appears as normal cache bytes.
- The review sheet shows exactly the paths and bytes the backend will act on.
- Cleaning caches does not select orphaned user data.
- Moving orphaned data to Trash requires explicit opt-in and typed confirmation.
- Unit and browser tests cover mixed cache/data orphan reports.

### [x] Make the no-outbound-network guarantee testable and accurate

**Problem:** documentation claims the CLI and UI are tested with outbound connections blocked, but the named test does not exist. Binary resolution also starts a login shell, contradicting the “no shell is spawned” rule and allowing shell startup files to have side effects.

Relevant code and docs:

- `packages/core/src/probes/bin-resolver.ts`
- `packages/core/src/probes/run.ts`
- `eslint.config.js`
- `README.md`
- `docs/safety-model.md`
- `CONTRIBUTING.md`

Work:

- Remove the login-shell fallback from binary resolution, or explicitly narrow the product guarantee.
- Resolve supported tools through deterministic known paths and inherited `PATH` without evaluating shell startup files.
- Add a macOS integration test that blocks outbound traffic while running CLI and UI flows.
- Scan packaged UI assets for external scripts, styles, fonts, images, and API URLs.
- Test hardened subprocess environments and updater/analytics suppression.
- Update documentation so every stated enforcement mechanism and test points to a real file.

Acceptance criteria:

- Audits and UI scans pass with outbound networking blocked.
- No project code starts a login or interactive shell.
- Packaged UI assets contain no external runtime resources.
- Privacy claims in README and safety documentation match tested behavior.

### [x] Harden release architecture and package validation

**Problem:** the helper build silently falls back to the host architecture even though releases promise Apple Silicon and Intel support. Release automation verifies signing but not architectures or the installed npm artifact.

Relevant code:

- `packages/native-helper/build.sh`
- `packages/cli/scripts/copy-assets.mjs`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `package.json`
- `packages/cli/package.json`

Work:

- Add a strict release mode in which universal helper compilation is mandatory.
- Assert that `lipo -archs` contains both `arm64` and `x86_64` before publishing.
- Keep host-only fallback only for explicitly requested local development builds.
- Make missing UI or native-helper assets fatal for package/release builds.
- Test both the minimum supported Node version (22) and the current Node version.
- Verify that the release tag equals the CLI package version.
- Run `npm pack`, install the tarball into a clean temporary directory, and smoke-test `audit`, `doctor`, and `ui`.
- Verify the packaged helper signature and checksum after packing, not only before packing.
- Add clear timeouts and diagnostics for stalled Swift/Xcode builds.

Acceptance criteria:

- CI cannot publish a single-architecture helper.
- CI cannot publish a CLI missing its UI or helper.
- The packed tarball works when installed outside the monorepo.
- Node 22 and Node 24 compatibility are tested.
- Tag/package version mismatches stop the release.

### [x] Strengthen filesystem race protection

**Problem:** identity is checked before filesystem actions, but a target directory can theoretically be replaced between the check and recursive deletion. `remove-dir-contents` is especially sensitive because listing through a replaced directory or symlink can affect a different tree.

Relevant code:

- `packages/core/src/safety/identity.ts`
- `packages/core/src/execute/execute.ts`
- `packages/core/src/execute/actions.ts`

Work:

- Evaluate descriptor-relative or native-helper deletion that keeps an opened directory identity stable.
- At minimum, repeat identity and symlink checks immediately before each destructive filesystem operation.
- Ensure child deletion never traverses a replaced parent symlink.
- Add adversarial race/swap tests around `remove-path` and `remove-dir-contents`.

Acceptance criteria:

- Replacing a target after planning or immediately before execution is refused.
- Replacing a cache directory with a symlink cannot delete the symlink target’s contents.

### [x] Improve cancellation and subprocess handling

**Problem:** scans observe abort signals between filesystem operations, but running probes and vendor commands are not consistently terminated when a job is cancelled.

Relevant code:

- `packages/core/src/probes/run.ts`
- `packages/core/src/fs/walker.ts`
- `packages/core/src/scan/scan.ts`
- `packages/server/src/jobs.ts`

Work:

- Pass `AbortSignal` to subprocess execution and terminate cancelled subprocesses safely.
- Distinguish cancellation from timeout and command failure.
- Ensure native clone-size walks and app scans stop promptly.
- Define and test a cancellation latency target.

Acceptance criteria:

- Cancelling a scan or execution stops active subprocesses.
- Jobs reach `cancelled`, not a generic failed state.
- Cancellation completes within the documented latency budget.

## P2 — Product completeness and trust

### [x] Bring README and product status in sync with the implementation

**Problem:** the README says Node 20+, describes v0.1 as audit-only, says no execution path exists, and contains a placeholder Homebrew command. The package requires Node 22 and already includes execution, journaling, undo, and a web UI.

Work:

- Change the requirement everywhere to Node 22+.
- Describe the actual implemented feature set and remaining experimental areas.
- Remove or replace the placeholder Homebrew command until a real tap exists.
- Clarify which Tier 2 and permanent operations are supported in CLI versus UI.
- Ensure root README and published CLI README do not drift.

Acceptance criteria:

- Installation, requirements, status, and safety behavior match the released package.
- Every documented command is implemented and tested.

### [x] Finish or remove placeholder UI controls

**Problem:** Settings shows “DiskWise v1.0” while the package is v0.1.0, the `node_modules` threshold is not connected to scanning, live uptime is blank, and Export JSON has no action.

Relevant code:

- `packages/ui/src/screens/Settings.tsx`
- `packages/ui/src/lib/settings.ts`

Work:

- Obtain the displayed version from the server/package version.
- Wire scan settings into backend scan configuration, or remove them until supported.
- Implement Export JSON with the same redaction policy as Markdown.
- Implement live server uptime or remove it.
- Disable unfinished controls with an explicit explanation if they must remain visible.

Acceptance criteria:

- Every enabled control performs its advertised action.
- Displayed version matches `diskwise --version`.
- Exported JSON and Markdown honor redaction settings consistently.

### [x] Enforce workspace package boundaries

**Problem:** CLI files import `packages/core/src` through relative paths, bypassing `@diskwise/core` exports and weakening package isolation.

Relevant code:

- `packages/cli/src/commands/apps.ts`
- `packages/cli/src/commands/doctor.ts`
- `packages/core/src/index.ts`
- `packages/core/package.json`

Work:

- Export the required app-orphan and tool-detection APIs from `@diskwise/core`.
- Replace cross-package relative imports with package imports.
- Add an ESLint restriction preventing imports into another package’s `src` directory.

Acceptance criteria:

- No package imports another workspace package through a relative source path.
- CLI builds against public core exports only.

### [x] Add coverage thresholds and close test gaps

**Current baseline:** 395 active tests pass; 2 benchmark tests are skipped. There are no enforced coverage thresholds, and UI source is excluded from Vitest.

Relevant code:

- `vitest.config.ts`
- `playwright.config.ts`
- `e2e/ui.spec.ts`

Work:

- Add coverage reporting and meaningful thresholds for safety, execution, plans, rules, journal, server security, and redaction.
- Add UI unit tests for derivation logic, confirmation states, job failures, cancellation, and inaccessible paths.
- Add a fixture-based E2E flow that scans a temporary home, applies a safe cleanup, checks the journal, and performs undo.
- Add E2E coverage for failed execution, cancelled execution, stale plans, and typed confirmation.
- Add accessibility checks for keyboard navigation, focus management, labels, contrast, and reduced motion.
- Keep one real-Mac scan smoke test, but move most browser tests to deterministic fixture mode.
- Avoid rewriting tracked reference screenshots during ordinary E2E runs; use snapshot assertions or CI artifacts.

Acceptance criteria:

- Critical safety modules have high branch coverage.
- At least one E2E test proves apply plus undo against an isolated temporary home.
- UI regressions run quickly and deterministically in fixture mode.
- A smaller real macOS smoke suite still validates platform integration.

### [x] Improve error reporting and recovery in the UI

**Problem:** several UI API failures are swallowed with empty `.catch()` handlers, leaving users without an explanation when plan creation, app quitting, history refresh, or undo fails.

Relevant code:

- `packages/ui/src/App.tsx`
- `packages/ui/src/api/hooks.ts`
- `packages/ui/src/screens/History.tsx`
- `packages/ui/src/screens/Apps.tsx`

Work:

- Surface actionable error messages for scan, planning, execution, app quit, undo, export, and server disconnect failures.
- Provide retry actions where safe.
- Preserve prior successful state while clearly marking it stale.
- Log no sensitive paths unless the user explicitly opens details.

Acceptance criteria:

- User-visible operations never fail silently.
- Errors distinguish permission, stale state, command failure, cancellation, and lost-server conditions.

### [x] Make journal recovery more resilient

**Problem:** if a Trash action succeeds but writing its result record fails, the journal can retain an intent without the returned Trash path, limiting automatic recovery.

Relevant code:

- `packages/core/src/journal/journal.ts`
- `packages/core/src/journal/undo.ts`
- `packages/core/src/execute/execute.ts`

Work:

- Define recovery behavior for an intent without a result.
- Consider recording enough destination information atomically through the native helper or a recovery record.
- Detect incomplete runs prominently in CLI and UI history.
- Document which incomplete operations can and cannot be recovered.

Acceptance criteria:

- Crash and journal-write-failure tests explain the final filesystem state.
- Recoverable Trash moves retain enough information for undo whenever possible.

## Existing strengths to preserve

- Safety-first product positioning and explicit restore costs.
- Declarative rule catalog with runtime schema validation and safety linting.
- Strict TypeScript configuration.
- Path traversal, symlink, denylist, and identity defenses.
- Write-ahead journal, locking, history, and undo support.
- Loopback-only server with token, Host, Origin, CSP, and content-type checks.
- Clone-aware native measurement and universal helper support.
- Strong current unit and integration test suite.

## Review validation baseline

- [x] ESLint passed.
- [x] TypeScript type-checking passed across the workspace.
- [x] 454 tests passed; 2 benchmark tests were skipped.
- [x] 11 Playwright tests passed, including an apply-plus-undo flow against an isolated temporary home.
- [x] Existing packaged native helper contains both `arm64` and `x86_64` architectures.
- [ ] A clean full build was not confirmed during the review because the local Swift toolchain stalled during SDK/clang discovery and was interrupted.
- [x] Review left the Git worktree clean.

## Recommended execution order

1. Secure saved-plan execution.
2. Correct simulator command result handling.
3. Correct orphaned-data classification and UI behavior.
4. Implement and enforce no-network tests or narrow the guarantee.
5. Harden universal release and packed-artifact validation.
6. Strengthen filesystem race protection and cancellation.
7. Update documentation and finish placeholder UI controls.
8. Enforce package boundaries and expand coverage/E2E testing.
9. Improve UI error recovery and incomplete-journal handling.
