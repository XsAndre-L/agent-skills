# Repository Formatting Piece

This capability establishes one repository-wide formatting contract. It keeps
formatting mechanical so agents and reviewers do not spend time debating
whitespace or punctuation.

## Fixed standard

- Use UTF-8, LF line endings, final newlines, spaces, and two-space indentation.
- Use semicolons, single quotes, trailing commas, 100-column wrapping, and
  parentheses around arrow-function parameters.
- Format supported source and documentation with Prettier from the repository
  root.
- Exclude dependencies, build outputs, coverage, generated source, scaffold
  provenance, and vendored formal skills.

## Boundaries

The piece owns only `.editorconfig`, `.prettierrc`, and
`.prettierignore`. It contributes the root Prettier dependency and
`format`/`format:check` scripts through the Bun workspace package assembly.

Angular, NestJS, and other stack providers remain responsible for their own
lint and type-check configuration. This piece does not add ESLint, tests,
editor-specific settings, hooks, staged-file tooling, or application rules.

## Static failure scenarios

Preflight rejects existing conflicting owned files, an invalid Prettier
version policy, missing package assembly slots, duplicate package fields,
unknown guidance slots, and unresolved fragment sources. Generated or vendored
paths must remain excluded rather than reformatted.
