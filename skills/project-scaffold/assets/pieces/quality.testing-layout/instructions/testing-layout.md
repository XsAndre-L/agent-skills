# Cross-stack testing layout

This structure piece defines test placement and naming without selecting a
framework, runner, assertion library, or application structure.

## Composition

- It owns no files and emits no formal skills.
- Its three Markdown fragments are assembled only by the foundation.
- Frontend and backend roots are independent. Apply a stack-specific rule only
  when that stack exists in the selected composition.
- Framework pieces retain ownership of their test configuration files.

Every parameter whose name ends in Root must resolve to a normalized,
target-relative path. Reject absolute paths, traversal, unresolved
placeholders, empty paths, and incompatible duplicate or ancestor-overlapping
roots before writing.

## Placement contract

- Unit specs use the configured unit root and unit suffix. When tests are
  colocated, a feature may use an adjacent spec or a nested tests directory.
- Centralized migration specs use the configured migration root. When a
  backend application owns its migration boundary, colocated specs may remain
  beneath that application's `src/db/tests/migrations` path. Repository
  evidence supports that application-local convention and the `.spec.ts`
  suffix.
- Integration and end-to-end specs use their dedicated roots and suffixes.
- Fixtures and generated test assets use separate roots. Generated assets are
  reproducible outputs; fixtures are maintained inputs.

Configured centralized roots must be disjoint. Application-local migration
specs are governed by the colocated convention rather than by overlapping two
configured roots. A non-colocated composition must supply dedicated unit
roots.

## Static validation scenarios

Preflight is expected to reject absolute or traversing paths, unresolved
placeholders, incompatible colliding roots, duplicate suffixes, fixture or
generated roots inside application source, and ownership collisions. It also
checks that selected stack categories map to coherent roots.

Frontend-only and backend-only selections are valid. Missing optional
structure providers do not fail selection; rules for the absent stack are
inactive. These expectations are documentation only and add no validator or
test implementation.

## Expected output

The assembled agent documents identify where each test asset belongs, when to
load the testing layout, and which structural checks apply. This piece does not
create source trees, test directories, README files, or test configuration.
