# Angular Stack Piece

This capability renders a project-neutral Angular 22 monorepo shell. It
requires the frontend structure and Bun workspace pieces so applications and
libraries always resolve beneath stable published roots.

## Fixed generation policy

- Standalone APIs, strict TypeScript/templates, zoneless change detection, and
  Angular's 2025 filename style are fixed for generated shells.
- The workspace is empty at its root: applications live under
  `frontend.appsRoot`, libraries under `frontend.libsRoot`, and
  `frontend.root/src` is never emitted.
- Angular framework, CLI, build, compiler-cli, and ng-packagr use
  `angular.versionPolicy`. Angular 22 uses TypeScript 6.0.x; RxJS and tslib
  use the pinned compatible ranges in the manifest fragments.
- `ng-packagr` stays present because this selected piece supports adding
  Angular libraries even when the initial library list is empty.
- Routing, SSR, style mode, applications, and libraries are explicit resolved
  parameters. Apollo, Tauri, adapters, release, delivery, and test-runner
  behavior are outside this piece.

## Ownership and assembly

The piece owns only the exact shell and TypeScript configuration files listed
in `piece.json`. Foundation assemblies are the sole writers of
`angular.json`, the frontend `package.json`, scoped framework guidance,
and shared command/validation guidance.

Application and library projects contribute separate JSON objects. A name
overlap therefore fails as a duplicate project key instead of being merged.
Browser and SSR application fragments are mutually exclusive under the same
canonical contribution key.

## Formal skills

The official `angular-developer` and `angular-new-app` packages are vendored
unchanged from `angular/skills@a8d71e4fcf4e504e428c9a0befaefd77b83a8480`.
Both emit only to their exact same-name `.agents/skills` destinations.
`fail` is the default; exact-inventory adoption is supported, replacement
requires explicit caller choice, and no migration is declared.

## Recorded static scenarios

Static review covers empty and multiple application lists, absent and
multiple libraries, default membership, application/library name overlap,
all style modes, routing enabled/disabled, SSR enabled/disabled, relative
TypeScript paths, package dependency branches, and exact skill inventories.
Failures include unsafe names, duplicate names, absolute or traversing roots,
root ownership collisions, unresolved template values, incompatible styles,
and formal-skill identity or destination conflicts.
