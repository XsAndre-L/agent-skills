# Documentation structure

This piece creates a configurable documentation map without prescribing
project-specific decisions or duplicating durable documentation in agent
guidance.

## Ownership

- The root index uses the approved assembly-registration form. Its final owner
  and only writer is core.agents; structure.docs contributes the
  base slot and a later release piece may contribute the release slot.
- Each configured category expands to one exact category README owned by this
  piece.
- The decision-record and general-document templates are exact parameterized
  paths.
- No wildcard, documentation source tree, or hardcoded docs/README.md is
  claimed.

The ordered docs.categories list accepts only unique lowercase, hyphen-safe
single-directory names. docs.root and every configured subpath must normalize
inside the target.

## Content boundaries

Durable architecture documentation, development guidance, operational
runbooks, release material, and archived content remain distinct whenever
their categories are configured. Agent guidance links to durable documents
and keeps only routing or task-selection rules under .agents.

Category indexes state their purpose, accepted content, maintenance ownership,
source-link convention, archive policy, and navigation back to the assembled
root index. Release documentation is not selected by default and remains
extensible through the root release slot.

## Recorded validation cases

Preflight is expected to reject duplicate category names, unsafe names,
traversal, absolute paths, unresolved values, a category equal to the final
docs.root directory name, duplicate or ancestor ownership, and ambiguous
links. Decision and template paths must not collide with category indexes.

A non-default acceptance case uses docs.root=handbook and categories
architecture, operations. It resolves handbook/README.md,
handbook/architecture/README.md, handbook/operations/README.md, and links
under /handbook/. These are recorded expectations only; this piece adds no
validator or test implementation.
