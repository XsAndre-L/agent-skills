# Angular Stack Piece

This capability renders a project-neutral Angular 22 monorepo shell. It
requires the frontend structure and Bun workspace pieces so applications and
libraries always resolve beneath stable published roots.

It also requires the WebQuark UI-foundation capability. The dependency creates
an inactive shared seam by default; explicit active integration selects exact
WebQuark dependencies and conditional Angular shell variants.

## Fixed generation policy

- Standalone APIs, strict TypeScript/templates, zoneless change detection, and
  Angular's 2025 filename style are fixed for generated shells.
- The workspace is empty at its root: applications live under
  `frontend.appsRoot`, libraries under `frontend.libsRoot`, and
  `frontend.root/src` is never emitted.
- Each generated application starts with only its bootstrap, application
  configuration, root route table when routing is enabled, and root component.
  Do not pre-create empty feature, layout, startup, configuration, shared, or
  test folders.
- Extend applications by user-facing capability beneath
  `src/app/features/<capability>/`. Add plain-purpose `layout/`, `startup/`, or
  `config/` boundaries only when the application needs them. Do not require
  vague `core/` or `domains/` folders, and do not organize the application
  around global `components/`, `services/`, or `types/` buckets.
- Keep `main.ts` focused on selected integration setup and Angular bootstrap.
  The root application component and configuration may coordinate
  application-wide startup, layout, and routing, but ordinary feature behavior
  stays with its owning capability.
- Prefer lazy loading for non-initial capabilities. Keep the root route table
  as the application entry map; move a large capability's child routes into
  `features/<capability>/<capability>.routes.ts` instead of letting the root
  table become a feature implementation file.
- Application-local reuse may live under `src/app/shared/` when it is genuinely
  needed by multiple capabilities in that application. Cross-application reuse
  belongs under `frontend.libsRoot`; one application never imports another
  application's source.
- Angular framework, CLI, build, compiler-cli, and ng-packagr use
  `angular.versionPolicy`. Angular 22 uses TypeScript 6.0.x; RxJS and tslib
  use the pinned compatible ranges in the manifest fragments.
- `ng-packagr` stays present because this selected piece supports adding
  Angular libraries even when the initial library list is empty.
- Routing, SSR, style mode, applications, and libraries are explicit resolved
  parameters. Apollo, Tauri, adapters, release, delivery, and test-runner
  behavior are outside this piece.
- This piece emits no test tree or spec TypeScript configuration. A selected
  testing-layout or runner piece owns those choices; production application
  TypeScript excludes specs and dedicated `tests/` trees.
- WebQuark application wiring and shared-foundation style imports appear only
  when `webquark.integrationEnabled` resolves to `true`. The inactive seam does
  not add WebQuark imports to an application.

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
TypeScript paths, production exclusion of test sources, absence of optional
empty folders, package dependency branches, conditional WebQuark wiring, and
exact skill inventories.
Failures include unsafe names, duplicate names, absolute or traversing roots,
root ownership collisions, unresolved template values, incompatible styles,
and formal-skill identity or destination conflicts.
