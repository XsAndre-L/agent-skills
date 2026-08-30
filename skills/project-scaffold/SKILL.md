---
name: project-scaffold
description: Create, validate, or safely upgrade a project scaffold from versioned modular pieces. Use when starting a repository, standardizing its agent-governance layout, applying a named scaffold profile, or checking generated scaffold drift. Do not use for ordinary feature work inside an already configured project.
---

# Project Scaffold

Build one coherent project structure from deterministic internal pieces. Pieces
are modules owned by this skill, not independently discovered Codex skills.

## Workflow

1. Inspect the target repository before selecting a profile. Preserve existing
   files and unrelated worktree changes.
2. Identify the project name and only the ownership scopes supplied by selected
   structure pieces. The mandatory foundation does not create frontend,
   backend, desktop, or mobile scopes.
3. Use the narrowest profile that satisfies the request. The default
   `agents-minimal` profile selects only `core.agents`.
4. Require Bun 1.3 or newer, resolve this skill's absolute directory, and run a
   complete preflight plan before applying changes:

   ```bash
   bun "<skill-root>/scripts/scaffold.ts" plan --root <project-root> --profile agents-minimal
   ```

5. Review the canonical piece order, resolved parameters, creates, updates,
   formal-skill actions, and conflicts. Stop on every conflict.
6. Apply only when the user's request authorizes creating or updating the
   scaffold:

   ```bash
   bun "<skill-root>/scripts/scaffold.ts" apply --root <project-root> --profile agents-minimal
   ```

7. Validate the installed scaffold and its recorded hashes:

   ```bash
   bun "<skill-root>/scripts/validate.ts" --root <project-root>
   ```

Use repeatable `--scope <name>` arguments only when selected structure pieces
consume `project.scopes`. Use `--param <name>=<json>` for shared parameters.
Formal-skill collisions default to `--collision-policy fail`; `adopt`,
`replace`, and `migrate --migration <declared-name>` are explicit choices
with the strict policies in the foundation contract.

## Operating modes

- **Plan:** Recursively discover pieces, expand the selected profile, close
  dependencies, resolve parameters, preflight ownership/contributions/skills,
  render every output, and build lock bytes without writing the target.
- **Apply:** Commit only an already complete in-memory plan. Every preflight
  failure leaves the target unchanged. Exact-file writes are atomic.
- **Validate:** Check the lock, expected paths, emissions, and rendered hashes
  without modifying the target.
- **Upgrade:** Plan against the newer skill, review conflicts, then apply. A
  v1 lock is accepted only as read-only migration evidence; it never activates
  the retired `agents` descriptor or grants overwrite permission.
- **Extend:** Read [authoring pieces](references/authoring-pieces.md), the
  [composition schema](references/composition.schema.json), and the mandatory
  [foundation contract](assets/pieces/core.agents/instructions/foundation.md).

## Foundation profiles

The foundation owns the central profile metadata in
`references/profiles.json`:

- `agents-minimal`: available now; piece 01, `core.agents`.
- `angular-nest-graphql-postgres`: reserved contract for pieces 01-08 and
  13-17; unavailable until every selected order exists.
- `tauri-desktop-fullstack`: reserved contract extending the preceding profile
  with 09, 11, and 12.
- `tauri-mobile-fullstack`: reserved contract extending the desktop profile
  with 10.

Profile inheritance expands recursively and normalizes to canonical dependency
order. Release and delivery kinds are explicitly excluded; a future profile
must select those pieces intentionally.

## Implemented capability pieces

- `stack.angular` (order 07) renders an Angular 22 standalone, strict,
  zoneless monorepo workspace beneath the roots published by
  `structure.frontend`. It creates applications only beneath
  `frontend.appsRoot`, libraries only beneath `frontend.libsRoot`, and
  emits the official `angular-developer` and `angular-new-app` skills.

## Invariants

- `core.agents` is mandatory and the sole writer of every target
  registered through a selected piece's `assemblies` list. Registrants and
  contributors never own that final file.
- The foundation provides an always-read plain-language naming baseline for
  code, paths, commands, configuration, APIs, persisted concepts, UI labels,
  and documentation. Breaking public-name changes are flagged with a migration
  or compatibility plan before they are applied.
- Discover `piece.json` manifests and piece-owned `profile.json`
  descriptors recursively. Dotted internal IDs are valid; duplicate IDs and
  ambiguous profile order selectors fail.
- Expand exact paths and parameters before collision checking.
- Resolve caller/profile values before parameterized defaults, reject default
  cycles, and enforce only relations whose providers are selected.
- Expand owned string lists in their declared order, accepting only unique
  safe single-directory items before collision checking.
- Reject missing or ambiguous capability providers, dependency/profile cycles,
  conflict groups, duplicate ownership, ancestor collisions, duplicate
  contribution keys, incompatible slots, duplicate skill identities, and
  invalid formal-skill destinations.
- Contributions use `{target, slot, key, fragment}` with an optional exact
  `when: {parameter, equals}` selector, and sort by target, slot, piece
  order, then key after inactive entries are removed.
- Do not copy this master skill into a generated repository's
  `.agents/skills`. Emissions are separate, declared formal skills whose
  folder, destination, and frontmatter identities must match exactly.
- Treat `.project-scaffold.lock.json` as deterministic provenance. Never use
  it as permission to overwrite a target whose current hash differs from its
  recorded hash.
- Do not install the skill, change a marketplace, commit, or publish unless
  the user explicitly requests that separate action.

## Handoff

Report the selected profile and expanded pieces, target root, resolved
parameters, created and unchanged files, formal-skill actions, conflicts,
validation result, and any commit-time atomicity or compatibility limits.
