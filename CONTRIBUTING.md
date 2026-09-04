# Contributing to DIG Browser

DIG Browser is a Windows fork of [ungoogled-chromium](https://github.com/Eloston/ungoogled-chromium)
that adds native `chia://` protocol support — resolving DIG Network content from an external dig-node,
then verifying and decrypting it client-side. **This repo does not follow the rest of the DIG ecosystem's
standard flow**: it tracks `master` (not `main`), keeps its own pre-existing ungoogled-chromium-style
release process, and is explicitly exempt from the ecosystem's protected-branch rule, tag-on-merge
workflow, and commitlint/version-gate requirement. Read this whole document before opening a PR —
assuming the usual squash-merge/protected-`main` flow here will lead you astray.

## Reporting an issue

File it at [github.com/DIG-Network/DIG_Browser/issues](https://github.com/DIG-Network/DIG_Browser/issues).
Include:

- What you observed vs. what you expected.
- Your **Chromium version** (`dig://about`) and **platform** (Windows x64 / x86 / ARM64) — the three
  architectures are built and patched separately, so a bug can be arch-specific.
- Steps to reproduce, and whether it reproduces in upstream ungoogled-chromium (helps tell a DIG-specific
  regression from an inherited one).
- For a `chia://` resolution bug: which dig-node source served it (a custom endpoint, `dig.local`,
  `localhost:8080`, or the `rpc.dig.net` fallback — see `chrome://settings/dig`).

## Prerequisites

This repo does **not** vendor the Chromium source tree — it holds the DIG-specific layer only:

- `patches/` — unified diffs applied over upstream Chromium/ungoogled-chromium during the build
  (`patches/series` lists them in apply order; the `windows-dig-*.patch` files are DIG's own).
- `dig/` — the DIG-specific browser surfaces (control pane, shields, new-tab, node status, wallet
  provider, settings) as standalone ES modules, each paired with a `node:test` file.
- `build.py` / `package.py`, `downloads.ini`, `domain_substitution.list`, `pruning.list` — the
  ungoogled-chromium build orchestration this fork inherits and configures.

Building a real binary requires **Windows 10 x64 or newer** and, per the README's "Building" section:

- **7-Zip**
- **Python 3.11+** with the Windows `MAX_PATH` (260-char) restriction lifted, and the `httplib2==0.22.0`
  module (`pip install httplib2==0.22.0`)
- **Git**, with "Git from the command line and also from 3rd-party software" enabled during setup
- **Visual Studio**, set up per the
  [official Windows Chromium build instructions](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/windows_build_instructions.md#visual-studio)

**Do not** install `depot_tools` or other standard Chromium tooling — this fork's build process
deliberately avoids Google's pre-built binaries, and `build.py` fetches and patches everything itself.

If you're only changing a `dig/*.mjs` module and its test, you need nothing beyond a recent Node.js —
you do not need the full Chromium build environment for that work.

## Build & test

**Full browser build** (run from `Developer Command Prompt for VS`, as administrator):

```cmd
python3 build.py
python3 package.py
```

This downloads/patches the pinned Chromium source, builds it, and produces a zip + installer under
`build`. It is a multi-hour build — CI splits it into chained stages (see "The gate" below) rather than
running it in one job. If a build fails, see the README's "Building" section for the exact
`build\download_cache` vs. full-`build`-directory cleanup steps before retrying.

**DIG-specific ES module tests** (fast, no Chromium build needed):

```sh
node --test dig/
```

Each `dig/**/*.mjs` policy module (branding, source resolution, control-pane state, shields ledger, …)
has a colocated `*.test.mjs` using Node's built-in `node:test` runner. These are **not currently wired
into CI** — run them yourself before opening a PR that touches `dig/`. Per `SPEC.md`, every native C++
mirror of this policy (under `patches/ungoogled-chromium/**`) must point back to the `dig/` module that
is its single source of truth, so keep the module and its patch in sync by hand.

## The gate

Only one workflow runs automatically on every PR to `master`: **`ensure-version-increment.yml`**. It
checks `package.json`/`Cargo.toml` version bumps — but this repo has **neither file at its root**, so
the check currently passes vacuously with "no version gate to enforce." There is no other required
status check on a PR.

The three build workflows — **`build-x64.yml`**, **`build-x86.yml`**, **`build-arm.yml`** — do **not**
run on PRs. Each triggers only on `workflow_dispatch` or a pushed tag, and each runs
`reusable-build.yml`: a chain of 24 sequential `windows-2022` jobs, where every stage resumes the
previous stage's build from an uploaded artifact (a single GitHub Actions job can't hold a full
multi-hour Chromium compile). So a PR's actual buildability is **not** verified by CI before merge —
if you're changing anything that affects the build (a patch, `build.py`, `downloads.ini`, …), building
locally first is the only way to know it still compiles.

## PR conventions — read this, it differs from the rest of the ecosystem

- **`master` has no branch protection.** There is no required-PR rule, no required status checks, no
  linear-history/squash-only requirement, and no unresolved-conversation gate enforced by GitHub. Recent
  history is a mix of merge commits (`Merge pull request #N from …`) and direct commits to `master` —
  both are possible here.
- **No squash-merge-only policy.** Use a regular PR merge or a direct push to `master`; there is no
  mechanical enforcement either way. A focused PR with a clear description is still the norm — this
  repo's leniency is not an invitation to skip review.
- **No commitlint / Conventional-Commits enforcement.** Commit messages in this repo's history are
  mostly `type(scope): summary`-shaped by convention (matching the rest of the ecosystem), but nothing
  in CI checks it.
- **No general version-bump requirement.** `ensure-version-increment.yml` exists and would enforce a
  bump if this repo ever gained a root `package.json` or `Cargo.toml`, but today it has neither, so no
  PR needs a version bump to merge.
- **Releases are tag-driven, not merge-driven.** Pushing a tag (or manually dispatching `build-x64` /
  `build-x86` / `build-arm` against a tag ref) kicks off the per-architecture build chain;
  `publish-release.yml` then watches those workflows, matches a completed run's commit back to the tag
  that triggered it, and publishes a GitHub release with whichever architectures succeeded (x64 is
  required; x86 and ARM64 are optional and simply omitted if their build didn't complete). Merging a PR
  to `master` does **not**, by itself, cut or publish a release.

If your change touches a `.dig`/store-format-adjacent contract, a byte-identical cross-repo contract, or
anything `SYSTEM.md`/`SPEC.md` describe, the ecosystem's usual cross-repo-contract obligations still
apply even though this repo's own merge mechanics don't — update `SPEC.md` in the same PR.
