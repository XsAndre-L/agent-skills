# Authoring Scaffold Pieces

Create a piece anywhere below `assets/pieces/` with a `piece.json`
descriptor. Discovery is recursive and sorted by manifest-relative path.
Pieces are internal modules; do not add a live piece-level `SKILL.md`.
Formal-skill sources may contain `SKILL.md.tmpl`, which is emitted only
after identity and collision preflight.

Read the mandatory
[foundation contract](../assets/pieces/core.agents/instructions/foundation.md)
before authoring ownership, contributions, parameters, or formal-skill
emissions.

When modifying an existing piece, also read that piece's `instructions/*.md`
files when present. Keep those files limited to piece-specific structure and
composition decisions rather than repeating general coding guidance.

## Descriptor contract

Validate every descriptor against `composition.schema.json`. Declare:

- stable dotted or hyphenated `id`, semantic `version`, open-ended `kind`,
  mandatory status, and stable numeric `order`;
- capabilities in `provides` and capability dependencies in `requires`;
- non-binding `suggests` and shared conflict-group IDs in `conflicts`;
- every exact path in `owns`;
- foundation-owned shared targets in `assemblies`;
- keyed `contributes`, shared `parameters`, and formal-skill `emits`.

When a later contract names a piece ID directly in `requires`, publish that
same ID as an exact capability alias in `provides`. Semantic capability names
remain available for interchangeable providers.

`order` is a deterministic tie-breaker and foundation profile selector; it
does not replace dependency edges. Orders reserved by a foundation profile
must resolve to exactly one discovered piece when that profile is selected.

## Ownership and assembly

An ordinary owned path has a target-relative `path` and piece-relative
`template`. A generated lock uses `generated: "scaffold-lock"`.

Register a shared target under top-level `assemblies` with exact `target`,
piece-relative `template`, `format`, and named typed `slots`. Registration
delegates final ownership and writing to `core.agents`; the
registering piece and contributors do not write the target directly. A target
cannot appear in both `owns` and `assemblies`, and duplicate or ancestor
registrations fail after parameter expansion. Legacy `owns[].assembly` entries
are normalized only as a compatibility shim; do not author new ones.

For Markdown, TypeScript, TOML, and YAML, put
exactly one `{{contributions:<slot>}}` marker in the template for each
declared slot. These textual slots cannot declare JSON placement fields. A
JSON template is an object seed and every JSON slot declares one placement:

- `placement: "root"` merges disjoint fields into the seed;
- `placement: "property"` writes the merged object under `property`, which
  defaults to the slot name.

Root, property, seed, and contribution-key collisions fail. Legacy JSON slots
infer root placement only for `root-object`; other legacy slots infer property
placement.

An owned template may fan out over an ordered string-array parameter:

```json
{
  "path": "{docs.root}/{docs.category}/README.md",
  "template": "templates/category-README.md.tmpl",
  "forEach": {
    "parameter": "docs.categories",
    "as": "docs.category"
  }
}
```

Each item must be a unique, lowercase, hyphen-safe single-directory name.
Expansion preserves parameter order, exposes the `as` value to the owned path
and template, and completes before ownership collision checks. Generated lock
paths cannot fan out.

Markdown templates and fragments may render an ordered string array with one
non-nested block:

```markdown
{{#each docs.categories as docs.category}}- [{{docs.category}}](/{{docs.root}}/{{docs.category}}/README.md)
{{/each}}
```

The block preserves array order. Unknown, non-string, colliding, nested, or
unclosed expansions fail preflight.

When JSON needs commas between repeated entries, use the only supported
separator form:

```text
{{#each angular.applicationNames as angular.applicationName separator=","}}
...
{{/each}}
```

The separator appears only between items. It never changes the exact
`{target, slot, key, fragment}` contribution identity.

Content templates and fragments may compute configuration-relative paths with:

```text
{{relativePath frontend.root frontend.appsRoot/this/src/main.ts}}
{{relativePath frontend.appsRoot/this frontend.root/tsconfig.json}}
```

Each operand begins with a resolved path parameter or, inside `#each`, the
local `this` item, followed by optional literal path segments. Operands must
normalize as safe target-relative paths. The helper emits POSIX configuration
text and may return `..` or `.`; it never defines a write destination.
Missing parameters, `this` outside `#each`, absolute operands, and traversal
inside either operand fail preflight.

A contribution is exactly:

```json
{
  "target": ".agents/AGENTS.md",
  "slot": "routing.scopes",
  "key": "structure.frontend:route:frontend",
  "fragment": {
    "type": "markdown",
    "source": "fragments/frontend-route.md"
  }
}
```

It may additionally declare one exact-value selector:

```json
"when": {"parameter": "angular.ssr", "equals": true}
```

Parameters resolve first. Inactive contributions are then excluded before
target and key expansion, duplicate detection, fragment reading, sorting,
assembly, and provenance. Manifest discovery still verifies that every
declared fragment source exists.

After parameter expansion, `key` must match
`<piece-id>:<purpose>[:<resolved-identity>]` and be globally unique. The
assembler also rejects duplicate `(target, slot, key)` tuples, missing target
owners, unknown slots, and fragment types that do not equal the slot type.
Ordering is target, slot, selected piece `order`, then expanded key.

Markdown, JSON, TypeScript, TOML, and YAML fragments use the deterministic
semantics defined by the foundation contract. A fragment source is relative to
its piece and cannot escape it.

## Parameters

Parameter IDs are dotted. Multiple selected pieces may declare the same
parameter only when the declarations are structurally identical. Resolution
precedence is:

1. declared default;
2. expanded profile value;
3. explicit generic `--param`;
4. dedicated caller flags such as `--project-name`, `--scope`, and
   `--collision-policy`;
5. engine-owned `composition.profile`.

String defaults may reference another selected parameter, for example
`{frontend.root}/apps`. Caller and profile values are overlaid before defaults
resolve, reference cycles fail, and explicit values win.

Use only the declarative constraints needed by the contract: `pattern`,
`items.pattern`, `minItems`, `uniqueItems`, `memberOf`, `nestedUnder`,
`equalTo`, `distinctFrom`, and `pathDisjointFrom`. A relation absent from the
discovered catalog is a typo; a relation supplied only by an unselected piece
is skipped. Every selected declaration is type-checked after resolution.
Unknown parameters, conflicting declarations, missing required values,
unresolved tokens, invalid patterns, and relationship violations fail
preflight.

An ordinary exact owned output or contribution may declare
`when: {"parameter":"<id>","equals":<value>}`. Conditions use exact JSON
value comparison. Owned-output conditions resolve before ownership expansion;
contribution conditions resolve before contribution validation and assembly.
Assembly registrations remain unconditional.

## Dependencies, conflicts, and profiles

`requires` names capabilities, not piece IDs. A required capability must have
exactly one selected or uniquely discoverable provider. Dependency closure is
acyclic. Selected pieces sharing a conflict-group ID fail.

The foundation owns the four built-in profiles in `references/profiles.json`.
Additional profiles are discovered recursively as `profile.json` descriptors
inside their owning piece. A descriptor uses the schema's
`profileDescriptor` definition, declares `ownedBy`, and must remain beneath
that piece's directory; duplicate IDs fail. This lets later pieces add profiles
without editing a registry.

Profiles may extend other profiles and select stable piece IDs or reserved
piece orders. Inheritance is expanded recursively, profile cycles fail, and
the final set is normalized by capability dependency order, then piece order
and ID. Do not add release or delivery pieces to the four foundation profiles.

## Formal-skill emissions

An emission declares `name`, a piece-relative source folder, and the exact
destination `.agents/skills/<name>`. The source must contain `SKILL.md`
with matching `name` and a `description`. Source folder name, emission
name, destination basename, and frontmatter name must match.
Skill package layout and frontmatter follow the official Codex skill authority:
<https://developers.openai.com/codex/skills>.

- Set `adopt: true` only when exact-content adoption is supported.
- Declare each migration as a stable `{name, from}` pair.
- Set `from` to one exact `.agents/skills/<legacy-name>` folder.
- Never encode an implicit rename, merge, or wildcard destination.

The caller's collision policy remains `fail` unless explicitly changed.
`replace` applies only to the exact preflighted destination. `migrate`
requires an explicit declared migration name.

Installed target-skill inventory stops at immediate destinations of the form
`.agents/skills/<skill-name>/SKILL.md`. Nested `SKILL.md` files inside an
installed skill—including emission sources inside an explicitly installed
master scaffold skill—are internal package content and do not declare sibling
target skills. This target boundary does not change recursive discovery of
piece manifests, profiles, templates, fragments, instructions, or emission
sources inside the master skill. The generator never emits the master skill;
repository-local installation is an explicit user action.

## Provenance and v0.1 compatibility

Piece digests include the manifest and every referenced template, fragment,
instruction, and emitted file. Lock schema v2 records the complete resolved
composition. `files[].contributors` is a compact contributing-piece summary;
`assemblies[].contributions` is the authoritative ordered contribution
provenance. A v1 lock may be read to prove whether existing generated files
are unchanged, but the retired v0.1 `agents` descriptor is not present and
cannot be discovered or selected. Obsolete v0.1 scope files are recorded, not
deleted.

## Recorded validation scenarios

The foundation contract records the required future behavioral scenarios.
This architectural piece does not add test files or run validators. Static
authoring review must confirm descriptor/schema/runtime field agreement,
resolvable relative paths, unique declared slots, and no live legacy
`agents/piece.json`.
