# Graphify

**No GitHub-integration product named "graphify" exists, so this repository uses a
documented equivalent: a dependency-graph workflow that generates a Mermaid graph of the
monorepo and keeps it committed under `docs/`.** The research that established this:

- The npm package [`graphify`](https://www.npmjs.com/package/graphify) is an unrelated
  jQuery "random graph generator" library published in 2015.
- [Graphify](https://github.com/Graphify-Labs/graphify) (documentation:
  [docs.graphify.com](https://docs.graphify.com)) is an open-source knowledge-graph
  engine for AI coding assistants — a Python CLI published on PyPI as `graphifyy` (the
  npm registry has no official package) — plus a hosted service at
  [app.graphify.com](https://app.graphify.com). It maps a codebase into a graph that an
  assistant queries during a session; it has no GitHub App, no Marketplace listing, and
  no "add to a repository" integration.
- No other project under the name does what a repository integration would do (no
  repository/dependency graph added to a GitHub repo by installing anything).

Since none of these matches "add graphify so the repository looks professional", the
closest genuinely useful equivalent is implemented below. It follows the project
constraints: the workflow runs only on pushes to `main` and on pull requests touching
`packages/**`, and no dependencies were added — the generator uses only the Node
standard library, so there is no runtime or dev dependency to justify.

## What was added

| Path | Purpose |
| --- | --- |
| `.github/workflows/graphify.yml` | Regenerates the graph on pushes to `main` and on pull requests touching `packages/**`, uploads it as the `package-graph` build artifact, and fails a pull request whose committed `docs/package-graph.md` is stale. It never pushes — `main` is branch-protected. |
| `.github/scripts/generate-package-graph.mjs` | Zero-dependency Node script. Reads `pnpm-workspace.yaml`, every package manifest, and the static imports under `packages/*/src`, then writes the Mermaid graph plus a summary table. Runnable locally: `node .github/scripts/generate-package-graph.mjs`. |
| `docs/package-graph.md` | The committed, generated artifact — GitHub renders the Mermaid block as a diagram. Generated, never edited by hand. |

Solid arrows in the graph are declared workspace dependencies; dotted arrows would be
imports found in source without a matching manifest entry (currently none — the source
imports agree with the manifests).

## What the maintainer has to do by hand

Nothing. The workflow authenticates with the automatic `GITHUB_TOKEN` and runs with
`contents: read` only — it never pushes to `main`, which is branch-protected, so a
workflow push would be rejected anyway. The graph is committed by whoever changes the
imports: run `node .github/scripts/generate-package-graph.mjs` and include the result in
the pull request. A pull request whose committed `docs/package-graph.md` does not match
a fresh run fails the Graphify check with that command in the error message.

## Limitations

- Import detection is a static scan of `import`/`from`/`import()`/`require()` specifiers,
  not a full AST: computed or dynamically built specifiers are not resolved. Manifest
  `workspace:*` dependencies are treated as the authoritative edges.
- `@diskwise/native-helper` appears as an isolated node: it is a shell-based helper with
  no manifest dependencies and no TypeScript imports — the code invokes it at runtime
  through `child_process`, which a static import scan cannot see.
- The workflow never pushes: the committed graph is refreshed by whoever changes the
  imports, and the staleness check runs only on pull requests. The artifact is uploaded
  on every run for review either way.
