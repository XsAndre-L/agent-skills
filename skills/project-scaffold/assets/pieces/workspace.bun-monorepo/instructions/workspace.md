# Bun Monorepo Workspace Contract

This structure piece registers a Bun-native root workspace without selecting
frontend, backend, desktop, mobile, release, or delivery behavior.

## Ownership

The piece directly owns only `bunfig.toml`. Its `package.json` assembly
registration delegates final ownership and writing to
`core.agents`; contributors never write that target. It does not
own application roots, shared package directories, `.agents` outputs,
lockfiles, or broad directory/glob paths.

## Parameters and ordering

Resolve `workspace.identity`, `workspace.rootPackageName`,
the shared `frontend.root` and `backend.root` parameters,
`workspace.sharedPackageRoots`, `workspace.bunVersionPolicy`, and
`workspace.rootPrivate` before contribution validation. Structure pieces reuse
the same root parameter declarations rather than introducing aliases.

The generated workspace list is always ordered as frontend root, backend root,
then shared package glob. The shared-root parameter is one Bun glob expression
and may match multiple library packages. Package-local manifests remain the
authority for package names, dependencies, and framework scripts.

## Preflight

Before any target write:

1. validate the root package name and exact Bun version declaration;
2. normalize the exact frontend/backend roots, require them to be disjoint,
   and reject an absolute, traversing, or malformed shared-package glob;
3. reject unresolved placeholders and ownership collisions;
4. validate the root-object and scripts fragments as disjoint JSON slot
   objects;
5. allow absent frontend or backend providers—the workspace paths do not
   imply that this piece creates those packages.

## Expected output

Selection contributes root `name`, `private`, `packageManager`,
`workspaces`, and generic delegated scripts to the foundation-assembled
`package.json`. It creates `bunfig.toml` with exact dependency saving, text
lockfile output, and local workspace linking. Shared agent documents receive
package-boundary, command, and validation guidance.

Preflight fails for invalid package names or Bun versions, duplicate exact
workspace roots, unsafe paths, malformed globs, unresolved parameters,
duplicate JSON keys, unknown slots, incompatible fragment types, or existing
unmanaged owned files. Potential overlap created by glob matching remains a
recorded validation scenario rather than a separate glob engine.
