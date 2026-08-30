# Agent Foundation Composition Contract

This piece is mandatory and is the sole assembler for shared targets. It does
not create frontend, backend, desktop, or mobile scope trees. Selected
structure pieces provide those paths through their own exact ownership and
keyed contributions.

## Resolution order

Complete the following immutable planning stages before any target write:

1. Discover every piece manifest and piece-owned profile descriptor
   recursively, then load the four foundation-owned built-in profiles.
2. Expand profile inheritance, add every mandatory piece, and resolve selected
   piece-order selectors.
3. Close capability dependencies, reject missing or ambiguous providers,
   detect cycles, and reject selected pieces sharing a conflict group.
4. Resolve shared parameter declarations and values. Identical declarations
   may be shared; incompatible declarations fail.
5. Expand every exact owned path and assembly registration, including
   deterministic fan-out over safe unique single-directory string lists, and
   reject duplicate, case-folded, ancestor, non-directory-ancestor, absolute,
   escaping, Windows-invalid, and symlink collisions.
6. Resolve and validate contributions and formal-skill emissions.
7. Render every target, digest every referenced input, and serialize the final
   provenance lock in memory.

Only a completely successful preflight may enter the commit phase. Every
preflight failure leaves the target unchanged. Individual file replacement is
atomic; an unexpected operating-system or process failure during a multi-file
commit is not represented as a transactional rollback guarantee.

## Contributions

A contribution has the identity fields `{target, slot, key, fragment}` and
may add one `when: {parameter, equals}` selector.

- Resolve all parameters first, then discard inactive contributions before
  target/key expansion, duplicate detection, fragment reading, sorting,
  assembly, or provenance.
- Expand `target` and `key` from resolved parameters before validation.
- A key is globally unique and matches
  `<piece-id>:<purpose>[:<resolved-identity>]`.
- Reject duplicate keys even when their target or content differs.
- Also reject duplicate `(target, slot, key)` identities, unresolved targets,
  unknown slots, and fragment types incompatible with the registered slot.
- Sort accepted contributions by target, slot, piece `order`, then key.
- Pieces register shared targets through `assemblies`; the foundation owns and
  writes every registered target. Registrants and contributors never write the
  shared target directly. Legacy `owns[].assembly` is read only as a
  compatibility shim.

Markdown, TypeScript, TOML, and YAML assembly templates contain one marker per
declared slot: `{{contributions:<slot>}}`. Missing, repeated, or undeclared
markers fail. A JSON assembly template is a JSON object seed. Each JSON slot
declares `placement: root` to merge disjoint seed fields or
`placement: property` to write beneath an exact property that defaults to the
slot name. Placement fields are forbidden on non-JSON slots. Seed, root-field,
property, and contribution-key collisions fail.

## Typed slot semantics

- **Markdown:** normalize to LF, trim trailing whitespace at the fragment
  boundary, and join ordered fragments with one blank line.
- **JSON:** each fragment source is a JSON object. Merge only disjoint object
  keys within its slot, reject scalar/array roots and duplicate keys, apply
  the declared root/property placement rule above, recursively sort keys, and
  serialize with two spaces plus one trailing newline.
- **TypeScript:** normalize to LF and join ordered regions with one newline.
  The slot name defines its semantic region (for example imports,
  declarations, or statements); a non-TypeScript fragment is incompatible.
- **TOML:** normalize to LF and join complete table or assignment regions with
  one blank line. Contributors must not repeat a table or key owned by another
  fragment.
- **YAML:** normalize to LF and join mapping or sequence regions with one
  blank line. Contributors must use a consistent mapping or sequence
  shape; duplicate mapping keys are incompatible.

The runtime validates the declared fragment type and deterministic assembly
shape. It never guesses a conversion between formats.

Owned `forEach` expansion preserves the resolved parameter order and exposes
one local item variable to the path and template. Non-nested `#each` blocks
provide the same ordered string-list rendering in templates and fragments.
Their optional `separator="..."` literal is inserted only between items.
Unsafe or duplicate directory items, variable collisions, non-string lists,
and malformed blocks fail during preflight.

Content templates and fragments support exactly one path-computation helper:
`{{relativePath <from-expression> <to-expression>}}`. Each expression starts
with a resolved path parameter or `this`, followed by optional literal path
segments. `this` is valid only inside `#each` and expands before helper
evaluation. Both operands must normalize as safe target-relative paths. Output
uses POSIX separators and may contain `..` or `.` because it is embedded
configuration text, never a filesystem destination. Missing parameters,
unresolved `this`, absolute paths, or traversal within an operand fail
preflight.

## Parameters and exact-output conditions

Overlay profile and caller values before resolving parameterized string
defaults such as `{frontend.root}/apps`. Reject default-reference cycles,
unknown references, type or pattern failures, non-unique or undersized lists,
and selected `memberOf`, `nestedUnder`, `equalTo`, `distinctFrom`, or
`pathDisjointFrom` violations. Relations supplied only by unselected pieces
remain inactive so standalone structure selections stay valid.

An ordinary exact owned output or contribution may use one
`when: {parameter, equals}` condition with exact JSON-value comparison.
Evaluate owned-output conditions before ownership expansion and contribution
conditions before any contribution validation or fragment read. Assembly
registrations remain unconditional so shared ownership cannot disappear
implicitly.

## Plain-language naming baseline

The mandatory foundation provides `plain-language-naming`, owns
`.agents/shared/naming.md`, and makes that guide part of every generated
project's always-read agent baseline. Apply it before creating or renaming code,
paths, commands, configuration, APIs, persisted concepts, UI labels, or
documentation terminology. Framework guidance may add syntax-specific rules,
but it must not replace clear project vocabulary or introduce a competing term
for the same concept.

Breaking public, persisted, or externally consumed name changes must be
identified and reported before they are applied, together with the required
migration or compatibility plan. The naming baseline is foundation behavior,
not an optional piece or conditionally triggered formal skill.

## Formal repository skills

Formal skills emit only to `.agents/skills/<name>`. The emitted folder name,
emission `name`, source folder name, destination basename, and the
`SKILL.md` frontmatter `name` must match exactly. `SKILL.md` must also
declare a description. Preflight inventories all repository skill folders and
rejects duplicate emitted names, duplicate destinations, same-name existing
skills, output collisions, and identity mismatches before writes.

Collision policies are exact:

- `fail` is the default and rejects an existing untracked destination or
  same-name skill.
- `adopt` is allowed only when the emitting piece sets `adopt: true`, the
  existing folder and frontmatter identities match exactly, and its complete
  inventory equals the planned emission. Adoption writes no skill files.
- `replace` is allowed only by explicit caller choice and applies only to the
  exact destination inventoried during preflight. The existing destination
  must declare the same identity. No other same-name folder may exist.
- `migrate` requires an explicit caller-selected migration name declared in
  the emitting piece. Its exact source and destination must be preflighted,
  the source must exist, and the destination must be absent. The named
  migration is the only authority to retire that one exact
  `.agents/skills/<legacy-name>` source after emission.

No policy silently merges, renames, combines, overwrites, or deletes a
same-name skill. Codex itself does not merge duplicate skill names; see the
[official Codex skill authority](https://developers.openai.com/codex/skills).

## Provenance

The deterministic lock records the expanded profile chain, canonical piece
order, capability providers, parameter values and sources, piece and profile
digests, assembled target owner and ordered contribution keys, emission
identity/destination/policy/action/migration, rendered hashes, and obsolete
v0.1 generated paths. The lock is provenance, never overwrite permission.
`files[].contributors` is the compact contributing-piece summary;
`assemblies[].contributions` is the detailed authoritative record.

## Static validation scenarios

Record these scenarios for later behavioral validation without implementing
tests in this piece:

1. Recursive piece and profile discovery accepts dotted IDs and rejects
   duplicate IDs or descriptors outside their owning piece.
2. Profile inheritance, mandatory selection, missing orders, capability
   closure, cycles, and conflict groups fail deterministically.
3. Parameter declaration conflicts, invalid ordered-list expansion, and
   unresolved path/key parameters fail before a target write.
4. Duplicate owned paths, ancestor collisions, contribution keys, tuple
   identities, slots, fragment types, skill names, and destinations fail.
5. `fail`, `adopt`, `replace`, and named `migrate` accept only their
   documented exact identities and inventories.
6. A fully successful plan produces stable ordering, hashes, and lock bytes.
7. A preflight error leaves an existing target byte-for-byte unchanged.
