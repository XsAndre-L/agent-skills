# WebQuark UI-foundation piece

This capability standardizes one shared WebQuark boundary for Angular
monorepos. Its inactive default creates a stable styling seam without adding a
dependency. Active integration adds only exact `@webquark/core`, a browser-safe
loader, direct custom-element support, and a deterministic application style
connection.

## Ownership

Own only the exact paths in `piece.json`. Do not own the frontend library tree,
Angular applications, `package.json`, `angular.json`, or a wildcard path. The
Angular piece owns conditional application shell variants; foundation assembly
is the sole writer of shared package and agent documents.

## Layering

`foundation.css` has exactly two imports: WebQuark base CSS, then the
application token layer. Application layout styles load after the foundation.
Global token changes belong in `webquark-theme.css`; isolated exceptions use
documented Shadow Parts and stay reusable under the shared UI foundation.

## Preflight and regression scenarios

- The fixed foundation root must resolve beneath `frontend.libsRoot` without traversal or collision.
- Disabled integration has no package dependency, loader, or Angular connection.
- Enabled integration pins an exact version, initializes before bootstrap, and imports the foundation before application styles.
- Conflicts fail before writes; lock ownership, hashes, and contribution provenance remain deterministic.
- Repeated apply is byte-identical and no backend or unrelated stack output is created.
