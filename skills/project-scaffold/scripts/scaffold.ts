#!/usr/bin/env bun

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, posix, relative, resolve } from "node:path";
import {
  atomicReplaceDirectory,
  atomicWrite,
  isRecord,
  loadJsonObject,
  mergeJsonAssemblySlots,
  normalizeRelativePath,
  resolveRootPath,
  safeChild,
  sha256Bytes,
  sha256File,
  sortedEntries,
  stringifyJson,
  validateScaffoldLockShape,
  type JsonObject,
} from "./core.ts";

const SKILL_ROOT = resolve(import.meta.dir, "..");
const SKILL_NAME = "project-scaffold";
const SKILL_VERSION = "0.12.0";
const PIECES_ROOT = resolve(SKILL_ROOT, "assets", "pieces");
const PROFILES_PATH = resolve(SKILL_ROOT, "references", "profiles.json");
const CORE_AGENTS_ID = "core.agents";
const LOCK_NAME = ".project-scaffold.lock.json";
const ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PARAM_RE = /^[a-z][a-z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/;
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const SCOPE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEMPLATE_TOKEN_RE =
  /\{\{([a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)*)\}\}/g;
const PARAM_TOKEN_RE =
  /(?<!\{)\{([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*)\}(?!\})/g;
const EACH_BLOCK_RE =
  /\{\{#each ([a-z][a-z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+) as ([a-z][a-z0-9]*(?:\.[a-z][a-zA-Z0-9])*)(?: separator="([^"\r\n]*)")?\}\}([\s\S]*?)\{\{\/each\}\}/g;
const RELATIVE_PATH_TOKEN_RE =
  /\{\{relativePath ([a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)*(?:\/[a-zA-Z0-9._-]+)*) ([a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)*(?:\/[a-zA-Z0-9._-]+)*)\}\}/g;
const SLOT_MARKER_RE =
  /\{\{contributions:([a-z0-9]+(?:[.-][a-z0-9]+)*)\}\}/g;
const FORMATS = ["markdown", "json", "typescript", "toml", "yaml"] as const;
const POLICIES = ["fail", "adopt", "replace", "migrate"] as const;
const RESERVED_SCOPES = new Set(["prompts", "shared", "skills"]);
const WINDOWS_DEVICE_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const SAFE_SEGMENT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Format = (typeof FORMATS)[number];
type ChangeStatus = "conflict" | "create" | "unchanged" | "update";
type EmissionAction =
  | "adopt"
  | "create"
  | "migrate"
  | "replace"
  | "unchanged"
  | "update";

interface SlotSpec {
  type: Format;
  placement?: "root" | "property";
  property?: string;
}
interface AssemblySpec {
  format: Format;
  slots: Record<string, SlotSpec>;
}
interface AssemblyRegistrationSpec extends AssemblySpec {
  target: string;
  template: string;
}
interface OwnedForEachSpec {
  parameter: string;
  as: string;
}
interface WhenSpec {
  parameter: string;
  equals: unknown;
}
interface OwnedSpec {
  path: string;
  template?: string;
  generated?: "scaffold-lock";
  variables?: Record<string, string>;
  assembly?: AssemblySpec;
  forEach?: OwnedForEachSpec;
  when?: WhenSpec;
}
interface ContributionSpec {
  target: string;
  slot: string;
  key: string;
  fragment: { type: Format; source: string };
  when?: WhenSpec;
}
interface ParameterSpec {
  type: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  pattern?: string;
  minItems?: number;
  uniqueItems?: boolean;
  items?: { type: string; pattern?: string };
  memberOf?: string;
  nestedUnder?: string;
  equalTo?: string;
  distinctFrom?: string[];
  pathDisjointFrom?: string[];
}
interface MigrationSpec {
  name: string;
  from: string;
}
interface EmissionSpec {
  name: string;
  source: string;
  destination: string;
  adopt: boolean;
  migrations: MigrationSpec[];
}
interface Piece {
  schemaVersion: 2;
  id: string;
  version: string;
  kind: string;
  required: boolean;
  order: number;
  provides: string[];
  requires: string[];
  suggests: string[];
  conflicts: string[];
  owns: OwnedSpec[];
  assemblies: AssemblyRegistrationSpec[];
  contributes: ContributionSpec[];
  parameters: Record<string, ParameterSpec>;
  emits: EmissionSpec[];
}
interface FoundPiece {
  directory: string;
  manifestPath: string;
  piece: Piece;
}
interface ProfileSpec {
  description: string;
  extends: string[];
  pieces: string[];
  pieceOrders: number[];
  excludeKinds: string[];
  parameters: Record<string, unknown>;
}
interface ExpandedProfile {
  chain: string[];
  pieces: Set<string>;
  pieceOrders: Set<number>;
  excludeKinds: Set<string>;
  parameters: Record<string, unknown>;
  catalogDigest: string;
}
interface Composition {
  profile: ExpandedProfile;
  pieces: FoundPiece[];
  providers: Record<string, string>;
  parameters: {
    values: Record<string, unknown>;
    sources: Record<string, string>;
  };
}
interface ExpandedOwner {
  found: FoundPiece;
  spec: OwnedSpec;
  path: string;
  localParameters: Record<string, unknown>;
}
interface ResolvedContribution {
  found: FoundPiece;
  target: string;
  slot: string;
  key: string;
  type: Format;
  content: string;
  digest: string;
}
interface RenderedFile {
  piece: string;
  content: Uint8Array;
  renderedSha256: string;
  contributors?: string[];
  emission?: string;
}
interface Inventory {
  files: Record<string, Uint8Array>;
  digest: string;
}
interface PlannedEmission {
  found: FoundPiece;
  spec: EmissionSpec;
  destination: string;
  inventory: Inventory;
  action: EmissionAction;
  policy: string;
  provenanceAction: string;
  provenancePolicy: string;
  migration?: MigrationSpec;
  migrationSource?: string;
  migrationSourceDigest?: string;
}
interface LockRecord {
  piece?: unknown;
  renderedSha256?: unknown;
  emission?: unknown;
  contributors?: unknown;
}
interface ScaffoldLock extends JsonObject {
  schemaVersion: 1 | 2;
  files: Record<string, LockRecord>;
  obsoleteFiles?: Record<string, LockRecord>;
  emissions?: Record<string, unknown>;
}
interface Args {
  command: "plan" | "apply";
  root: string;
  profile: string;
  scopes: string[];
  projectName?: string;
  parameters: Record<string, unknown>;
  collisionPolicy?: string;
  migration?: string;
  asJson: boolean;
}
interface Plan {
  root: string;
  profile: string;
  composition: Composition;
  rendered: Record<string, RenderedFile>;
  assemblies: Record<string, JsonObject>;
  emissions: PlannedEmission[];
  changes: Array<{ path: string; status: ChangeStatus }>;
  lockContent: Uint8Array;
}

export class ScaffoldError extends Error {}
const fail = (message: string): ScaffoldError => new ScaffoldError(message);
const loadJson = (path: string): JsonObject => loadJsonObject(path, fail);
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function exact(value: JsonObject, keys: string[], label: string): void {
  const extras = Object.keys(value).filter((key) => !keys.includes(key));
  if (extras.length) {
    throw fail(`${label} has unsupported fields: ${extras.sort().join(", ")}`);
  }
}
function stringValue(value: unknown, label: string, pattern?: RegExp): string {
  if (typeof value !== "string" || !value || (pattern && !pattern.test(value))) {
    throw fail(`Invalid ${label}`);
  }
  return value;
}
function stringList(value: unknown, label: string, pattern: RegExp = ID_RE): string[] {
  if (!Array.isArray(value)) throw fail(`${label} must be an array`);
  const result = value.map((item) => stringValue(item, `${label} entry`, pattern));
  if (new Set(result).size !== result.length) throw fail(`${label} contains duplicates`);
  return result;
}
function variables(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw fail(`Invalid ${label}`);
  const result: Record<string, string> = {};
  for (const [name, item] of Object.entries(value)) {
    if (typeof item !== "string") throw fail(`${label} ${name} is not a string`);
    result[name] = item;
  }
  return result;
}
function assembly(
  value: unknown,
  label: string,
  legacyJsonPlacement = false,
): AssemblySpec | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw fail(`Invalid ${label}`);
  exact(value, ["format", "slots"], label);
  const format = stringValue(value.format, `${label} format`) as Format;
  if (!FORMATS.includes(format)) throw fail(`Unsupported format: ${format}`);
  if (!isRecord(value.slots) || !Object.keys(value.slots).length) {
    throw fail(`${label} requires typed slots`);
  }
  const slots: Record<string, SlotSpec> = {};
  for (const [slot, unknownSpec] of sortedEntries(value.slots)) {
    stringValue(slot, `${label} slot`, ID_RE);
    if (!isRecord(unknownSpec)) throw fail(`Invalid slot: ${slot}`);
    exact(unknownSpec, ["type", "placement", "property"], `${label} slot ${slot}`);
    const type = stringValue(unknownSpec.type, `${slot} type`) as Format;
    if (!FORMATS.includes(type)) throw fail(`Unsupported slot type: ${type}`);
    if (type !== format) {
      throw fail(`Slot ${slot} type ${type} is incompatible with target format ${format}`);
    }
    if (type === "json") {
      const rawPlacement = unknownSpec.placement;
      const placement =
        rawPlacement === undefined && legacyJsonPlacement
          ? slot === "root-object"
            ? "root"
            : "property"
          : rawPlacement;
      if (placement !== "root" && placement !== "property") {
        throw fail(`JSON slot ${slot} requires root or property placement`);
      }
      if (placement === "root" && unknownSpec.property !== undefined) {
        throw fail(`Root JSON slot ${slot} cannot declare property`);
      }
      const property =
        unknownSpec.property === undefined
          ? undefined
          : stringValue(unknownSpec.property, `${slot} JSON property`);
      slots[slot] = {
        type,
        placement,
        ...(placement === "property" && property ? { property } : {}),
      };
      continue;
    }
    if (unknownSpec.placement !== undefined || unknownSpec.property !== undefined) {
      throw fail(`Only JSON slot ${slot} may declare placement or property`);
    }
    slots[slot] = { type };
  }
  return { format, slots };
}

function whenSpec(value: unknown, label: string): WhenSpec | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw fail(`Invalid ${label}`);
  exact(value, ["parameter", "equals"], label);
  if (!("equals" in value)) throw fail(`${label} requires equals`);
  return {
    parameter: stringValue(value.parameter, `${label} parameter`, PARAM_RE),
    equals: value.equals,
  };
}

function assemblyRegistrationSpecs(
  value: unknown,
  directory: string,
  id: string,
): AssemblyRegistrationSpec[] {
  if (!Array.isArray(value)) throw fail(`Piece ${id} assemblies must be an array`);
  return value.map((unknownItem, index) => {
    if (!isRecord(unknownItem)) throw fail(`Invalid assemblies entry in ${id}`);
    exact(
      unknownItem,
      ["target", "template", "format", "slots"],
      `Piece ${id} assemblies[${index}]`,
    );
    const target = stringValue(unknownItem.target, `piece ${id} assembly target`);
    const template = stringValue(unknownItem.template, `piece ${id} assembly template`);
    const merge = assembly(
      { format: unknownItem.format, slots: unknownItem.slots },
      `Assembly target ${target}`,
    );
    if (!merge) throw fail(`Assembly target ${target} is invalid`);
    const source = safeChild(directory, template, "assembly template", fail);
    if (!existsSync(source) || !statSync(source).isFile()) {
      throw fail(`Missing assembly template for ${id}: ${template}`);
    }
    return { target, template, ...merge };
  });
}

function ownedSpecs(value: unknown, directory: string, id: string): OwnedSpec[] {
  if (!Array.isArray(value)) throw fail(`Piece ${id} owns must be an array`);
  return value.map((unknownItem, index) => {
    if (!isRecord(unknownItem)) throw fail(`Invalid owns entry in ${id}`);
    exact(
      unknownItem,
      ["path", "template", "generated", "variables", "assembly", "forEach", "when"],
      `Piece ${id} owns[${index}]`,
    );
    const path = stringValue(unknownItem.path, `piece ${id} owned path`);
    const template = unknownItem.template === undefined ? undefined : stringValue(unknownItem.template, `piece ${id} template`);
    const generated = unknownItem.generated;
    if ((template === undefined) === (generated === undefined) || (generated !== undefined && generated !== "scaffold-lock")) {
      throw fail(`Owned path ${path} needs one template or scaffold-lock generator`);
    }
    const merge = assembly(unknownItem.assembly, `Owned path ${path} assembly`, true);
    if (generated !== undefined && merge) throw fail(`Generated path cannot declare assembly: ${path}`);
    let forEach: OwnedForEachSpec | undefined;
    if (unknownItem.forEach !== undefined) {
      if (!isRecord(unknownItem.forEach)) throw fail(`Invalid forEach for owned path ${path}`);
      exact(unknownItem.forEach, ["parameter", "as"], `Owned path ${path} forEach`);
      const parameter = stringValue(unknownItem.forEach.parameter, `Owned path ${path} forEach parameter`, PARAM_RE);
      const as = stringValue(unknownItem.forEach.as, `Owned path ${path} forEach variable`, PARAM_RE);
      if (parameter === as) throw fail(`Owned path ${path} forEach variable must differ from its parameter`);
      forEach = { parameter, as };
    }
    if (generated !== undefined && forEach) throw fail(`Generated path cannot declare forEach: ${path}`);
    const condition = whenSpec(unknownItem.when, `Owned path ${path} when`);
    if (generated !== undefined && condition) {
      throw fail(`Generated path cannot declare when: ${path}`);
    }
    if (merge && condition) {
      throw fail(`Assembly registration cannot declare when: ${path}`);
    }
    if (template) {
      const source = safeChild(directory, template, "template", fail);
      if (!existsSync(source) || !statSync(source).isFile()) throw fail(`Missing template for ${id}: ${template}`);
    }
    const vars = variables(unknownItem.variables, `owned variables for ${path}`);
    return {
      path,
      ...(template ? { template } : {}),
      ...(generated === undefined ? {} : { generated: "scaffold-lock" as const }),
      ...(vars ? { variables: vars } : {}),
      ...(merge ? { assembly: merge } : {}),
      ...(forEach ? { forEach } : {}),
      ...(condition ? { when: condition } : {}),
    };
  });
}
function contributionSpecs(value: unknown, directory: string, id: string): ContributionSpec[] {
  if (!Array.isArray(value)) throw fail(`Piece ${id} contributes must be an array`);
  return value.map((unknownItem, index) => {
    if (!isRecord(unknownItem) || !isRecord(unknownItem.fragment)) throw fail(`Invalid contribution in ${id}`);
    exact(unknownItem, ["target", "slot", "key", "fragment", "when"], `Piece ${id} contribution[${index}]`);
    exact(unknownItem.fragment, ["type", "source"], `Piece ${id} fragment`);
    const type = stringValue(unknownItem.fragment.type, "fragment type") as Format;
    if (!FORMATS.includes(type)) throw fail(`Unsupported fragment type: ${type}`);
    const source = stringValue(unknownItem.fragment.source, "fragment source");
    const sourcePath = safeChild(directory, source, "fragment", fail);
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) throw fail(`Missing fragment for ${id}: ${source}`);
    const condition = whenSpec(unknownItem.when, `Contribution ${id}[${index}] when`);
    return {
      target: stringValue(unknownItem.target, "contribution target"),
      slot: stringValue(unknownItem.slot, "contribution slot", ID_RE),
      key: stringValue(unknownItem.key, "contribution key"),
      fragment: { type, source },
      ...(condition ? { when: condition } : {}),
    };
  });
}
function regularExpression(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const pattern = stringValue(value, label);
  try {
    new RegExp(pattern);
  } catch {
    throw fail(`Invalid regular expression for ${label}`);
  }
  return pattern;
}

function optionalParameterReference(
  value: unknown,
  label: string,
): string | undefined {
  return value === undefined
    ? undefined
    : stringValue(value, label, PARAM_RE);
}

function optionalParameterReferenceList(
  value: unknown,
  label: string,
): string[] | undefined {
  return value === undefined ? undefined : stringList(value, label, PARAM_RE);
}

function parameterSpecs(value: unknown, id: string): Record<string, ParameterSpec> {
  if (!isRecord(value)) throw fail(`Piece ${id} parameters must be an object`);
  const result: Record<string, ParameterSpec> = {};
  for (const [name, unknownSpec] of sortedEntries(value)) {
    stringValue(name, "parameter ID", PARAM_RE);
    if (!isRecord(unknownSpec)) throw fail(`Invalid parameter: ${name}`);
    exact(
      unknownSpec,
      [
        "type",
        "description",
        "required",
        "default",
        "enum",
        "pattern",
        "minItems",
        "uniqueItems",
        "items",
        "memberOf",
        "nestedUnder",
        "equalTo",
        "distinctFrom",
        "pathDisjointFrom",
      ],
      `Parameter ${name}`,
    );
    const type = stringValue(unknownSpec.type, `${name} type`);
    if (!["string", "boolean", "integer", "number", "array", "object"].includes(type)) {
      throw fail(`Unsupported parameter type for ${name}: ${type}`);
    }
    if (unknownSpec.required !== undefined && typeof unknownSpec.required !== "boolean") throw fail(`Parameter ${name} required must be boolean`);
    if (unknownSpec.enum !== undefined && !Array.isArray(unknownSpec.enum)) throw fail(`Parameter ${name} enum must be an array`);
    const pattern = regularExpression(unknownSpec.pattern, `${name} pattern`);
    if (pattern && type !== "string") {
      throw fail(`Parameter ${name} pattern is valid only for strings`);
    }
    let items: { type: string; pattern?: string } | undefined;
    if (unknownSpec.items !== undefined) {
      if (!isRecord(unknownSpec.items) || typeof unknownSpec.items.type !== "string") {
        throw fail(`Parameter ${name} has invalid items`);
      }
      exact(unknownSpec.items, ["type", "pattern"], `Parameter ${name} items`);
      if (
        !["string", "boolean", "integer", "number", "object"].includes(
          unknownSpec.items.type,
        )
      ) {
        throw fail(`Parameter ${name} has unsupported item type`);
      }
      const itemPattern = regularExpression(
        unknownSpec.items.pattern,
        `${name} item pattern`,
      );
      if (itemPattern && unknownSpec.items.type !== "string") {
        throw fail(`Parameter ${name} item pattern is valid only for strings`);
      }
      items = {
        type: unknownSpec.items.type,
        ...(itemPattern ? { pattern: itemPattern } : {}),
      };
    }
    const minItems = unknownSpec.minItems;
    if (
      minItems !== undefined &&
      (!Number.isInteger(minItems) || Number(minItems) < 0)
    ) {
      throw fail(`Parameter ${name} minItems must be a non-negative integer`);
    }
    if (minItems !== undefined && type !== "array") {
      throw fail(`Parameter ${name} minItems is valid only for arrays`);
    }
    if (
      unknownSpec.uniqueItems !== undefined &&
      typeof unknownSpec.uniqueItems !== "boolean"
    ) {
      throw fail(`Parameter ${name} uniqueItems must be boolean`);
    }
    if (unknownSpec.uniqueItems !== undefined && type !== "array") {
      throw fail(`Parameter ${name} uniqueItems is valid only for arrays`);
    }
    result[name] = {
      type,
      ...(typeof unknownSpec.description === "string" ? { description: unknownSpec.description } : {}),
      ...(typeof unknownSpec.required === "boolean" ? { required: unknownSpec.required } : {}),
      ...("default" in unknownSpec ? { default: unknownSpec.default } : {}),
      ...(Array.isArray(unknownSpec.enum) ? { enum: unknownSpec.enum } : {}),
      ...(pattern ? { pattern } : {}),
      ...(minItems !== undefined ? { minItems: Number(minItems) } : {}),
      ...(typeof unknownSpec.uniqueItems === "boolean"
        ? { uniqueItems: unknownSpec.uniqueItems }
        : {}),
      ...(items ? { items } : {}),
      ...(optionalParameterReference(unknownSpec.memberOf, `${name} memberOf`)
        ? { memberOf: String(unknownSpec.memberOf) }
        : {}),
      ...(optionalParameterReference(unknownSpec.nestedUnder, `${name} nestedUnder`)
        ? { nestedUnder: String(unknownSpec.nestedUnder) }
        : {}),
      ...(optionalParameterReference(unknownSpec.equalTo, `${name} equalTo`)
        ? { equalTo: String(unknownSpec.equalTo) }
        : {}),
      ...(optionalParameterReferenceList(unknownSpec.distinctFrom, `${name} distinctFrom`)
        ? { distinctFrom: unknownSpec.distinctFrom as string[] }
        : {}),
      ...(optionalParameterReferenceList(
        unknownSpec.pathDisjointFrom,
        `${name} pathDisjointFrom`,
      )
        ? { pathDisjointFrom: unknownSpec.pathDisjointFrom as string[] }
        : {}),
    };
  }
  return result;
}
function emissionSpecs(value: unknown, directory: string, id: string): EmissionSpec[] {
  if (!Array.isArray(value)) throw fail(`Piece ${id} emits must be an array`);
  return value.map((unknownItem, index) => {
    if (!isRecord(unknownItem)) throw fail(`Invalid emission in ${id}`);
    exact(unknownItem, ["name", "source", "destination", "adopt", "migrations"], `Piece ${id} emission[${index}]`);
    const name = stringValue(unknownItem.name, "emission name", SKILL_NAME_RE);
    if (name.length > 64) throw fail(`Formal-skill name exceeds 64 characters: ${name}`);
    const source = stringValue(unknownItem.source, "emission source");
    const sourcePath = safeChild(directory, source, "emission source", fail);
    if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) throw fail(`Missing emission source for ${id}: ${source}`);
    if (basename(sourcePath) !== name) throw fail(`Emission source folder must match name: ${name}`);
    const migrations: MigrationSpec[] = [];
    if (unknownItem.migrations !== undefined) {
      if (!Array.isArray(unknownItem.migrations)) throw fail(`Emission ${name} migrations must be an array`);
      for (const unknownMigration of unknownItem.migrations) {
        if (!isRecord(unknownMigration)) throw fail(`Invalid migration for ${name}`);
        exact(unknownMigration, ["name", "from"], `Migration for ${name}`);
        migrations.push({
          name: stringValue(unknownMigration.name, "migration name", ID_RE),
          from: stringValue(unknownMigration.from, "migration source"),
        });
      }
    }
    if (new Set(migrations.map((item) => item.name)).size !== migrations.length) throw fail(`Duplicate migration name for ${name}`);
    return {
      name,
      source,
      destination: stringValue(unknownItem.destination, "emission destination"),
      adopt: unknownItem.adopt === true,
      migrations,
    };
  });
}
function readPiece(directory: string, value: JsonObject): Piece {
  exact(
    value,
    [
      "schemaVersion",
      "id",
      "version",
      "kind",
      "required",
      "order",
      "provides",
      "requires",
      "suggests",
      "conflicts",
      "owns",
      "assemblies",
      "contributes",
      "parameters",
      "emits",
    ],
    `Piece in ${directory}`,
  );
  if (value.schemaVersion !== 2) throw fail(`Unsupported piece schema: ${directory}`);
  const id = stringValue(value.id, "piece ID", ID_RE);
  if (basename(directory) !== id) throw fail(`Piece ID must match directory: ${id}`);
  if (typeof value.required !== "boolean") throw fail(`Piece ${id} required must be boolean`);
  if (!Number.isInteger(value.order) || Number(value.order) < 1) throw fail(`Piece ${id} order must be a positive integer`);
  return {
    schemaVersion: 2,
    id,
    version: stringValue(value.version, `${id} version`, VERSION_RE),
    kind: stringValue(value.kind, `${id} kind`, /^[a-z][a-z0-9-]*$/),
    required: value.required,
    order: Number(value.order),
    provides: stringList(value.provides, `${id} provides`),
    requires: stringList(value.requires, `${id} requires`),
    suggests: stringList(value.suggests, `${id} suggests`),
    conflicts: stringList(value.conflicts, `${id} conflicts`),
    owns: ownedSpecs(value.owns, directory, id),
    assemblies: assemblyRegistrationSpecs(value.assemblies ?? [], directory, id),
    contributes: contributionSpecs(value.contributes, directory, id),
    parameters: parameterSpecs(value.parameters, id),
    emits: emissionSpecs(value.emits, directory, id),
  };
}

function walkNamedFiles(root: string, fileName: string, label: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      cmp(a.name, b.name),
    );
    for (const entry of entries) {
      const entryPath = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw fail(`Symlinks are not supported in ${label}: ${entryPath}`);
      }
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && entry.name === fileName) found.push(entryPath);
    }
  };
  visit(root);
  return found.sort(cmp);
}

function discoverPieces(): FoundPiece[] {
  const manifests = walkNamedFiles(PIECES_ROOT, "piece.json", "piece discovery");
  const pieces = manifests.map((manifestPath) => {
    const directory = dirname(manifestPath);
    return { directory, manifestPath, piece: readPiece(directory, loadJson(manifestPath)) };
  });
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const found of pieces) {
    if (ids.has(found.piece.id)) throw fail(`Duplicate piece ID: ${found.piece.id}`);
    if (orders.has(found.piece.order)) {
      throw fail(`Duplicate canonical piece order: ${found.piece.order}`);
    }
    ids.add(found.piece.id);
    orders.add(found.piece.order);
  }
  const foundations = pieces.filter((found) => found.piece.kind === "foundation");
  if (
    foundations.length !== 1 ||
    foundations[0].piece.id !== CORE_AGENTS_ID ||
    !foundations[0].piece.required ||
    foundations[0].piece.order !== 1
  ) {
    throw fail(`${CORE_AGENTS_ID} must be the sole required foundation at order 1`);
  }
  return pieces.sort((a, b) => a.piece.order - b.piece.order || cmp(a.piece.id, b.piece.id));
}

function profileSpec(value: unknown, name: string): ProfileSpec {
  if (!isRecord(value)) throw fail(`Profile ${name} must be an object`);
  exact(
    value,
    ["description", "extends", "pieces", "pieceOrders", "excludeKinds", "parameters"],
    `Profile ${name}`,
  );
  const numbers = value.pieceOrders ?? [];
  if (!Array.isArray(numbers) || numbers.some((item) => !Number.isInteger(item) || Number(item) < 1)) {
    throw fail(`Profile ${name} pieceOrders must contain positive integers`);
  }
  if (new Set(numbers.map(Number)).size !== numbers.length) {
    throw fail(`Profile ${name} contains duplicate piece orders`);
  }
  if (value.parameters !== undefined && !isRecord(value.parameters)) {
    throw fail(`Profile ${name} parameters must be an object`);
  }
  return {
    description: stringValue(value.description, `Profile ${name} description`),
    extends: stringList(value.extends ?? [], `Profile ${name} extends`),
    pieces: stringList(value.pieces ?? [], `Profile ${name} pieces`),
    pieceOrders: numbers.map(Number),
    excludeKinds: stringList(value.excludeKinds ?? [], `Profile ${name} excludeKinds`),
    parameters: (value.parameters ?? {}) as Record<string, unknown>,
  };
}

function loadProfiles(discovered: FoundPiece[]): {
  profiles: Record<string, ProfileSpec>;
  digest: string;
} {
  const document = loadJson(PROFILES_PATH);
  exact(document, ["schemaVersion", "ownedBy", "profiles"], "Profile catalog");
  if (document.schemaVersion !== 2 || document.ownedBy !== CORE_AGENTS_ID) {
    throw fail(`Profile catalog must be schema 2 and owned by ${CORE_AGENTS_ID}`);
  }
  if (!isRecord(document.profiles)) throw fail("Profile catalog profiles must be an object");
  const profiles: Record<string, ProfileSpec> = {};
  const sources = [PROFILES_PATH];
  for (const [name, value] of sortedEntries(document.profiles)) {
    if (!ID_RE.test(name)) throw fail(`Invalid profile ID: ${name}`);
    profiles[name] = profileSpec(value, name);
  }
  for (const descriptorPath of walkNamedFiles(PIECES_ROOT, "profile.json", "profile discovery")) {
    sources.push(descriptorPath);
    const descriptor = loadJson(descriptorPath);
    exact(
      descriptor,
      [
        "schemaVersion",
        "id",
        "ownedBy",
        "description",
        "extends",
        "pieces",
        "pieceOrders",
        "excludeKinds",
        "parameters",
      ],
      `Profile descriptor ${descriptorPath}`,
    );
    if (descriptor.schemaVersion !== 2) throw fail(`Unsupported profile schema: ${descriptorPath}`);
    const id = stringValue(descriptor.id, "profile ID", ID_RE);
    const ownedBy = stringValue(descriptor.ownedBy, `${id} profile owner`, ID_RE);
    const containers = discovered
      .filter((found) => {
        const candidate = relative(found.directory, descriptorPath);
        return candidate !== "" && !candidate.startsWith("..");
      })
      .sort((a, b) => b.directory.length - a.directory.length || cmp(a.piece.id, b.piece.id));
    const owner = containers[0];
    if (!owner || owner.piece.id !== ownedBy) {
      throw fail(`Profile ${id} is not inside its declared owning piece ${ownedBy}`);
    }
    const descriptorRelativeToOwner = relative(owner.directory, descriptorPath);
    if (
      descriptorRelativeToOwner.startsWith("..") ||
      descriptorRelativeToOwner === ""
    ) {
      throw fail(`Profile ${id} must be located within its owning piece ${ownedBy}`);
    }
    if (profiles[id]) throw fail(`Duplicate profile ID: ${id}`);
    const { schemaVersion: _schema, id: _id, ownedBy: _owner, ...body } = descriptor;
    profiles[id] = profileSpec(body, id);
  }
  const digestInput = sources
    .sort(cmp)
    .map(
      (path) =>
        `${relative(SKILL_ROOT, path).replaceAll("\\", "/")}\0${sha256File(path)}`,
    )
    .join("\n");
  return {
    profiles,
    digest: sha256Bytes(Buffer.from(digestInput, "utf8")),
  };
}

function expandProfile(
  name: string,
  profiles: Record<string, ProfileSpec>,
  catalogDigest: string,
): ExpandedProfile {
  if (!profiles[name]) throw fail(`Unknown profile: ${name}`);
  const memo = new Map<string, ExpandedProfile>();
  const visiting: string[] = [];
  const visit = (profileName: string): ExpandedProfile => {
    const cached = memo.get(profileName);
    if (cached) return cached;
    const cycleAt = visiting.indexOf(profileName);
    if (cycleAt >= 0) {
      throw fail(`Profile inheritance cycle: ${[...visiting.slice(cycleAt), profileName].join(" -> ")}`);
    }
    const spec = profiles[profileName];
    if (!spec) throw fail(`Unknown inherited profile: ${profileName}`);
    visiting.push(profileName);
    const result: ExpandedProfile = {
      chain: [],
      pieces: new Set<string>(),
      pieceOrders: new Set<number>(),
      excludeKinds: new Set<string>(),
      parameters: {},
      catalogDigest,
    };
    for (const parentName of spec.extends) {
      const parent = visit(parentName);
      for (const item of parent.chain) if (!result.chain.includes(item)) result.chain.push(item);
      for (const item of parent.pieces) result.pieces.add(item);
      for (const item of parent.pieceOrders) result.pieceOrders.add(item);
      for (const item of parent.excludeKinds) result.excludeKinds.add(item);
      Object.assign(result.parameters, parent.parameters);
    }
    result.chain.push(profileName);
    for (const item of spec.pieces) result.pieces.add(item);
    for (const item of spec.pieceOrders) result.pieceOrders.add(item);
    for (const item of spec.excludeKinds) result.excludeKinds.add(item);
    Object.assign(result.parameters, spec.parameters);
    visiting.pop();
    memo.set(profileName, result);
    return result;
  };
  return visit(name);
}

function resolvePieces(profile: ExpandedProfile, discovered: FoundPiece[]): {
  pieces: FoundPiece[];
  providers: Record<string, string>;
} {
  const byId = new Map(discovered.map((found) => [found.piece.id, found]));
  const byOrder = new Map(discovered.map((found) => [found.piece.order, found]));
  const selected = new Set<string>();
  for (const id of profile.pieces) {
    if (!byId.has(id)) throw fail(`Profile selects missing piece: ${id}`);
    selected.add(id);
  }
  for (const order of profile.pieceOrders) {
    const found = byOrder.get(order);
    if (!found) throw fail(`Profile selects missing canonical piece order: ${order}`);
    selected.add(found.piece.id);
  }
  for (const found of discovered) if (found.piece.required) selected.add(found.piece.id);

  const providersByCapability = new Map<string, FoundPiece[]>();
  for (const found of discovered) {
    for (const capability of found.piece.provides) {
      const providers = providersByCapability.get(capability) ?? [];
      providers.push(found);
      providersByCapability.set(capability, providers);
    }
  }
  const providerResolution: Record<string, string> = {};
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...selected].sort(cmp)) {
      const found = byId.get(id)!;
      for (const capability of found.piece.requires) {
        const selectedProviders = (providersByCapability.get(capability) ?? []).filter((item) =>
          selected.has(item.piece.id),
        );
        const candidates = selectedProviders.length
          ? selectedProviders
          : providersByCapability.get(capability) ?? [];
        if (candidates.length !== 1) {
          throw fail(
            candidates.length === 0
              ? `No provider for capability ${capability} required by ${id}`
              : `Ambiguous providers for capability ${capability} required by ${id}: ${candidates
                  .map((item) => item.piece.id)
                  .sort(cmp)
                  .join(", ")}`,
          );
        }
        providerResolution[capability] = candidates[0].piece.id;
        if (!selected.has(candidates[0].piece.id)) {
          selected.add(candidates[0].piece.id);
          changed = true;
        }
      }
    }
  }

  const chosen = [...selected].map((id) => byId.get(id)!);
  for (const found of chosen) {
    if (profile.excludeKinds.has(found.piece.kind)) {
      throw fail(`Profile excludes selected piece kind ${found.piece.kind}: ${found.piece.id}`);
    }
  }
  const conflictGroups = new Map<string, string[]>();
  for (const found of chosen) {
    for (const group of found.piece.conflicts) {
      const members = conflictGroups.get(group) ?? [];
      members.push(found.piece.id);
      conflictGroups.set(group, members);
    }
  }
  for (const [group, members] of conflictGroups) {
    if (members.length > 1) {
      throw fail(`Conflict group ${group} has multiple selected pieces: ${members.sort(cmp).join(", ")}`);
    }
  }

  const outgoing = new Map<string, Set<string>>();
  const indegree = new Map(chosen.map((found) => [found.piece.id, 0]));
  for (const found of chosen) outgoing.set(found.piece.id, new Set<string>());
  for (const found of chosen) {
    for (const capability of found.piece.requires) {
      const provider = providerResolution[capability];
      if (!provider || !selected.has(provider)) throw fail(`Unresolved dependency ${capability}`);
      const edges = outgoing.get(provider)!;
      if (!edges.has(found.piece.id)) {
        edges.add(found.piece.id);
        indegree.set(found.piece.id, indegree.get(found.piece.id)! + 1);
      }
    }
  }
  const compare = (a: string, b: string): number =>
    byId.get(a)!.piece.order - byId.get(b)!.piece.order || cmp(a, b);
  const ready = [...selected].filter((id) => indegree.get(id) === 0).sort(compare);
  const ordered: FoundPiece[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    ordered.push(byId.get(id)!);
    for (const dependent of [...outgoing.get(id)!].sort(compare)) {
      indegree.set(dependent, indegree.get(dependent)! - 1);
      if (indegree.get(dependent) === 0) {
        ready.push(dependent);
        ready.sort(compare);
      }
    }
  }
  if (ordered.length !== chosen.length) {
    const cycle = chosen
      .map((item) => item.piece.id)
      .filter((id) => indegree.get(id)! > 0)
      .sort(compare);
    throw fail(`Piece dependency cycle: ${cycle.join(" -> ")}`);
  }
  return { pieces: ordered, providers: providerResolution };
}

function parameterTypeMatches(value: unknown, spec: ParameterSpec): boolean {
  if (spec.type === "array") {
    if (!Array.isArray(value)) return false;
    return (
      !spec.items ||
      value.every((item) => {
        if (spec.items!.type === "object") return isRecord(item);
        if (spec.items!.type === "integer") return Number.isInteger(item);
        if (spec.items!.type === "number") {
          return typeof item === "number" && Number.isFinite(item);
        }
        return typeof item === spec.items!.type;
      })
    );
  }
  if (spec.type === "integer") return Number.isInteger(value);
  if (spec.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (spec.type === "object") return isRecord(value);
  return typeof value === spec.type;
}

function sameValue(a: unknown, b: unknown): boolean {
  return stringifyJson(a) === stringifyJson(b);
}

function resolveParameters(
  pieces: FoundPiece[],
  catalogPieces: FoundPiece[],
  profile: ExpandedProfile,
  args: Args,
): Composition["parameters"] {
  const definitions = new Map<string, ParameterSpec>();
  for (const found of pieces) {
    for (const [name, spec] of sortedEntries(found.piece.parameters)) {
      const previous = definitions.get(name);
      if (previous && !sameValue(previous, spec)) {
        throw fail(`Incompatible shared parameter definition: ${name}`);
      }
      definitions.set(name, spec);
    }
  }
  const catalogParameterIds = new Set(
    catalogPieces.flatMap((found) => Object.keys(found.piece.parameters)),
  );
  for (const [name, spec] of definitions) {
    const references = [
      ...(spec.memberOf ? [spec.memberOf] : []),
      ...(spec.nestedUnder ? [spec.nestedUnder] : []),
      ...(spec.equalTo ? [spec.equalTo] : []),
      ...(spec.distinctFrom ?? []),
      ...(spec.pathDisjointFrom ?? []),
    ];
    for (const reference of references) {
      if (!catalogParameterIds.has(reference)) {
        throw fail(`Parameter ${name} references unknown parameter ${reference}`);
      }
    }
  }
  const supplied: Array<[string, Record<string, unknown>]> = [
    ["target-basename", { "project.name": basename(args.root) }],
    ["profile", profile.parameters],
    ["caller", args.parameters],
  ];
  if (args.projectName !== undefined) {
    supplied.push(["--project-name", { "project.name": args.projectName }]);
  }
  supplied.push(["engine", { "composition.profile": args.profile }]);
  if (args.scopes.length) supplied.push(["--scope", { "project.scopes": args.scopes }]);
  if (args.collisionPolicy !== undefined) {
    supplied.push(["--collision-policy", { "emission.collisionPolicy": args.collisionPolicy }]);
  }
  const values: Record<string, unknown> = {};
  const sources: Record<string, string> = {};
  for (const [source, sourceValues] of supplied) {
    for (const [name, value] of sortedEntries(sourceValues)) {
      if (!definitions.has(name)) throw fail(`Unknown parameter: ${name}`);
      values[name] = value;
      sources[name] = source;
    }
  }
  const resolving: string[] = [];
  const resolveDefault = (name: string): unknown => {
    if (name in values) return values[name];
    const spec = definitions.get(name);
    if (!spec || !("default" in spec)) return undefined;
    const cycleAt = resolving.indexOf(name);
    if (cycleAt >= 0) {
      throw fail(
        `Parameter default cycle: ${[...resolving.slice(cycleAt), name].join(" -> ")}`,
      );
    }
    resolving.push(name);
    let value = spec.default;
    if (typeof value === "string") {
      value = value.replace(PARAM_TOKEN_RE, (_match, reference: string) => {
        if (!definitions.has(reference)) {
          throw fail(`Parameter ${name} default references unavailable parameter ${reference}`);
        }
        const resolved = resolveDefault(reference);
        if (resolved === undefined) {
          throw fail(`Parameter ${name} default references unresolved parameter ${reference}`);
        }
        return parameterText(resolved, reference);
      });
    }
    resolving.pop();
    values[name] = value;
    sources[name] = "default";
    return value;
  };
  for (const name of [...definitions.keys()].sort(cmp)) resolveDefault(name);

  for (const [name, spec] of [...definitions.entries()].sort(([a], [b]) => cmp(a, b))) {
    if (!(name in values)) {
      if (spec.required) throw fail(`Missing required parameter: ${name}`);
      continue;
    }
    const value = values[name];
    if (!parameterTypeMatches(value, spec)) throw fail(`Parameter ${name} does not match type ${spec.type}`);
    if (spec.enum && !spec.enum.some((allowed) => sameValue(allowed, value))) {
      throw fail(`Parameter ${name} is outside its allowed values`);
    }
    if (spec.pattern && !new RegExp(spec.pattern).test(value as string)) {
      throw fail(`Parameter ${name} does not match its required pattern`);
    }
    if (Array.isArray(value)) {
      if (spec.minItems !== undefined && value.length < spec.minItems) {
        throw fail(`Parameter ${name} requires at least ${spec.minItems} items`);
      }
      if (
        spec.uniqueItems &&
        new Set(value.map((item) => stringifyJson(item))).size !== value.length
      ) {
        throw fail(`Parameter ${name} requires unique items`);
      }
      if (spec.items?.pattern) {
        const itemPattern = new RegExp(spec.items.pattern);
        if (!value.every((item) => typeof item === "string" && itemPattern.test(item))) {
          throw fail(`Parameter ${name} contains an item outside its required pattern`);
        }
      }
    }

    const selectedRelationValue = (reference: string): unknown => {
      if (!definitions.has(reference)) return undefined;
      if (!(reference in values)) {
        throw fail(`Parameter ${name} relation requires resolved parameter ${reference}`);
      }
      return values[reference];
    };
    if (spec.memberOf && definitions.has(spec.memberOf)) {
      const collection = selectedRelationValue(spec.memberOf);
      if (!Array.isArray(collection) || !collection.some((item) => sameValue(item, value))) {
        throw fail(`Parameter ${name} must be a member of ${spec.memberOf}`);
      }
    }
    if (spec.equalTo && definitions.has(spec.equalTo)) {
      if (!sameValue(value, selectedRelationValue(spec.equalTo))) {
        throw fail(`Parameter ${name} must equal ${spec.equalTo}`);
      }
    }
    if (spec.nestedUnder && definitions.has(spec.nestedUnder)) {
      if (typeof value !== "string") {
        throw fail(`Parameter ${name} nestedUnder requires a string path`);
      }
      const parentValue = selectedRelationValue(spec.nestedUnder);
      if (typeof parentValue !== "string") {
        throw fail(`Parameter ${spec.nestedUnder} must be a string path`);
      }
      const child = normalizeRelativePath(value, `${name} parameter`, fail).toLowerCase();
      const parent = normalizeRelativePath(
        parentValue,
        `${spec.nestedUnder} parameter`,
        fail,
      ).toLowerCase();
      if (!child.startsWith(`${parent}/`)) {
        throw fail(`Parameter ${name} must be nested under ${spec.nestedUnder}`);
      }
    }
    for (const reference of spec.distinctFrom ?? []) {
      if (
        definitions.has(reference) &&
        sameValue(value, selectedRelationValue(reference))
      ) {
        throw fail(`Parameter ${name} must differ from ${reference}`);
      }
    }
    if (spec.pathDisjointFrom?.length) {
      if (typeof value !== "string") {
        throw fail(`Parameter ${name} pathDisjointFrom requires a string path`);
      }
      const path = normalizeRelativePath(value, `${name} parameter`, fail).toLowerCase();
      for (const reference of spec.pathDisjointFrom) {
        if (!definitions.has(reference)) continue;
        const otherValue = selectedRelationValue(reference);
        if (typeof otherValue !== "string") {
          throw fail(`Parameter ${reference} must be a string path`);
        }
        const other = normalizeRelativePath(
          otherValue,
          `${reference} parameter`,
          fail,
        ).toLowerCase();
        if (
          path === other ||
          path.startsWith(`${other}/`) ||
          other.startsWith(`${path}/`)
        ) {
          throw fail(`Parameter paths ${name} and ${reference} must be disjoint`);
        }
      }
    }
  }
  const scopes = values["project.scopes"];
  if (
    typeof values["project.name"] !== "string" ||
    !String(values["project.name"]).trim()
  ) {
    throw fail("project.name must be a non-empty string");
  }
  if (scopes !== undefined) {
    if (!Array.isArray(scopes)) throw fail("project.scopes must be an array");
    const seen = new Set<string>();
    for (const scope of scopes) {
      if (typeof scope !== "string" || !SCOPE_RE.test(scope)) throw fail(`Invalid scope: ${String(scope)}`);
      if (RESERVED_SCOPES.has(scope) || WINDOWS_DEVICE_RE.test(scope)) throw fail(`Reserved scope: ${scope}`);
      if (seen.has(scope)) throw fail(`Duplicate scope: ${scope}`);
      seen.add(scope);
    }
  }
  return { values, sources };
}

function parameterText(value: unknown, name: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value.join(", ");
  throw fail(`Parameter ${name} cannot be expanded as text`);
}

function expandParameters(input: string, values: Record<string, unknown>, label: string): string {
  return input.replace(PARAM_TOKEN_RE, (_match, name: string) => {
    if (!(name in values)) throw fail(`Unresolved parameter ${name} in ${label}`);
    return parameterText(values[name], name);
  });
}

function resolveRelativePathExpression(
  expression: string,
  values: Record<string, unknown>,
  label: string,
): string {
  const [head, ...segments] = expression.split("/");
  if (!(head in values)) {
    throw fail(`Unresolved relativePath value ${head} in ${label}`);
  }
  const value = values[head];
  if (typeof value !== "string") {
    throw fail(`relativePath value ${head} must be a path string in ${label}`);
  }
  const resolvedSegments = segments.map((segment) => {
    if (segment !== "this") return segment;
    if (!("this" in values) || typeof values.this !== "string") {
      throw fail(`Unresolved relativePath value this in ${label}`);
    }
    return values.this;
  });
  const operand = [value, ...resolvedSegments].join("/");
  return normalizeRelativePath(operand, `relativePath operand ${expression} in ${label}`, fail);
}

function renderRelativePathTokens(
  input: string,
  values: Record<string, unknown>,
  label: string,
): string {
  const rendered = input.replace(
    RELATIVE_PATH_TOKEN_RE,
    (_match, fromExpression: string, toExpression: string) => {
      const from = resolveRelativePathExpression(fromExpression, values, label);
      const to = resolveRelativePathExpression(toExpression, values, label);
      return posix.relative(from, to) || ".";
    },
  );
  RELATIVE_PATH_TOKEN_RE.lastIndex = 0;
  if (/\{\{relativePath\b/.test(rendered)) {
    throw fail(`Invalid or unresolved relativePath helper in ${label}`);
  }
  return rendered;
}

function renderTemplate(
  input: string,
  variables: Record<string, string>,
  label: string,
  keepSlots = false,
): string {
  const rendered = input.replace(TEMPLATE_TOKEN_RE, (match, name: string) => {
    if (keepSlots && name.startsWith("contributions:")) return match;
    if (!(name in variables)) throw fail(`Unresolved template token ${name} in ${label}`);
    return variables[name];
  });
  const unresolved = [...rendered.matchAll(TEMPLATE_TOKEN_RE)].map((item) => item[1]);
  const unexpected = unresolved.filter((name) => !(keepSlots && name.startsWith("contributions:")));
  if (unexpected.length) throw fail(`Unresolved template tokens in ${label}: ${unexpected.join(", ")}`);
  return rendered;
}

function renderEachBlocks(
  input: string,
  parameters: Record<string, unknown>,
  variables: Record<string, string>,
  label: string,
): string {
  const rendered = input.replace(
    EACH_BLOCK_RE,
    (
      _match,
      parameter: string,
      as: string,
      separator: string | undefined,
      body: string,
    ) => {
    if (as in parameters || as in variables) {
      throw fail(`Each variable ${as} collides with an existing value in ${label}`);
    }
    const values = parameters[parameter];
    if (!Array.isArray(values) || !values.every((item) => typeof item === "string")) {
      throw fail(`Each parameter ${parameter} must be an array of strings in ${label}`);
    }
    const items = values
      .map((item, index) => {
        const itemParameters = { ...parameters, [as]: item };
        const itemVariables = { ...variables, [as]: item };
        const expanded = expandParameters(body, itemParameters, `${label} each ${parameter}[${index}]`);
        const templated = renderTemplate(
          expanded,
          itemVariables,
          `${label} each ${parameter}[${index}]`,
        );
        return renderRelativePathTokens(
          templated,
          itemParameters,
          `${label} each ${parameter}[${index}]`,
        );
      });
    return items.join(separator ?? "");
    },
  );
  EACH_BLOCK_RE.lastIndex = 0;
  if (/\{\{#each\b|\{\{\/each\}\}/.test(rendered)) {
    throw fail(`Invalid or nested each block in ${label}`);
  }
  return rendered;
}

function templateVariables(composition: Composition): Record<string, string> {
  const variables: Record<string, string> = {
    profile: composition.parameters.values["composition.profile"] as string,
    projectName:
      (composition.parameters.values["project.name"] as string | undefined) ?? "the project",
    scopes: parameterText(composition.parameters.values["project.scopes"] ?? [], "project.scopes"),
  };
  for (const [name, value] of sortedEntries(composition.parameters.values)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      (Array.isArray(value) && value.every((item) => typeof item === "string"))
    ) {
      variables[name] = parameterText(value, name);
    }
  }
  return variables;
}

function expandedOwnedPath(
  found: FoundPiece,
  spec: OwnedSpec,
  parameters: Record<string, unknown>,
  localParameters: Record<string, unknown>,
): string {
  const expanded = expandParameters(
    spec.path,
    { ...parameters, ...localParameters },
    `${found.piece.id} owned path`,
  );
  if (/[{}]/.test(expanded)) throw fail(`Unresolved owned path for ${found.piece.id}: ${expanded}`);
  return normalizeRelativePath(expanded, `${found.piece.id} owned path`, fail);
}

function ownedLocalParameters(
  found: FoundPiece,
  spec: OwnedSpec,
  parameters: Record<string, unknown>,
): Array<Record<string, unknown>> {
  if (!spec.forEach) return [{}];
  if (spec.forEach.as in parameters) {
    throw fail(`Owned forEach variable collides with parameter ${spec.forEach.as} in ${found.piece.id}`);
  }
  const values = parameters[spec.forEach.parameter];
  if (!Array.isArray(values)) {
    throw fail(`Owned forEach parameter ${spec.forEach.parameter} must be an array in ${found.piece.id}`);
  }
  const seen = new Set<string>();
  return values.map((value) => {
    if (
      typeof value !== "string" ||
      !SAFE_SEGMENT_RE.test(value) ||
      WINDOWS_DEVICE_RE.test(value)
    ) {
      throw fail(
        `Owned forEach parameter ${spec.forEach.parameter} contains an unsafe directory name: ${String(value)}`,
      );
    }
    const comparison = value.toLowerCase();
    if (seen.has(comparison)) {
      throw fail(`Owned forEach parameter ${spec.forEach.parameter} contains duplicate directory: ${value}`);
    }
    seen.add(comparison);
    return { [spec.forEach!.as]: value };
  });
}

function outputSpecs(found: FoundPiece): OwnedSpec[] {
  const registrations = found.piece.assemblies.map((spec) => ({
    path: spec.target,
    template: spec.template,
    assembly: {
      format: spec.format,
      slots: spec.slots,
    },
  }));
  return [...found.piece.owns, ...registrations];
}

function outputConditionMatches(
  found: FoundPiece,
  spec: OwnedSpec,
  parameters: Record<string, unknown>,
): boolean {
  if (!spec.when) return true;
  if (!(spec.when.parameter in parameters)) {
    throw fail(
      `Owned path condition in ${found.piece.id} references unresolved parameter ${spec.when.parameter}`,
    );
  }
  return sameValue(parameters[spec.when.parameter], spec.when.equals);
}

function resolveOwners(composition: Composition): {
  owners: Map<string, ExpandedOwner>;
  byComparison: Map<string, ExpandedOwner>;
} {
  const owners = new Map<string, ExpandedOwner>();
  const byComparison = new Map<string, ExpandedOwner>();
  const paths: ExpandedOwner[] = [];
  for (const found of composition.pieces) {
    for (const spec of outputSpecs(found)) {
      if (!outputConditionMatches(found, spec, composition.parameters.values)) continue;
      for (const localParameters of ownedLocalParameters(found, spec, composition.parameters.values)) {
        const path = expandedOwnedPath(found, spec, composition.parameters.values, localParameters);
        const owner = { found, spec, path, localParameters };
        const comparison = path.toLowerCase();
        const duplicate = byComparison.get(comparison);
        if (duplicate) {
          throw fail(
            `Output path collision: ${duplicate.found.piece.id} and ${found.piece.id} both register ${path}`,
          );
        }
        owners.set(path, owner);
        byComparison.set(comparison, owner);
        paths.push(owner);
      }
    }
  }
  const sorted = paths.sort((a, b) => cmp(a.path.toLowerCase(), b.path.toLowerCase()));
  for (let index = 0; index < sorted.length; index += 1) {
    for (let other = index + 1; other < sorted.length; other += 1) {
      const parent = sorted[index].path.toLowerCase();
      const child = sorted[other].path.toLowerCase();
      if (child.startsWith(`${parent}/`)) {
        throw fail(`Output path ancestor collision: ${sorted[index].path} and ${sorted[other].path}`);
      }
    }
  }
  return { owners, byComparison };
}

function validateContributionKey(pieceId: string, key: string): void {
  const parts = key.split(":");
  const partPattern = /^[a-z0-9][a-zA-Z0-9.-]*$/;
  if (
    (parts.length !== 2 && parts.length !== 3) ||
    parts[0] !== pieceId ||
    !parts.every((part) => partPattern.test(part))
  ) {
    throw fail(
      `Contribution key must be <piece-id>:<purpose>[:<resolved-identity>] for ${pieceId}: ${key}`,
    );
  }
}

function resolveContributions(
  composition: Composition,
  ownersByComparison: Map<string, ExpandedOwner>,
): ResolvedContribution[] {
  const variables = templateVariables(composition);
  const contributions: ResolvedContribution[] = [];
  const keys = new Set<string>();
  const identities = new Set<string>();
  for (const found of composition.pieces) {
    for (const spec of found.piece.contributes) {
      if (spec.when) {
        if (!(spec.when.parameter in composition.parameters.values)) {
          throw fail(
            `Contribution condition in ${found.piece.id} references unresolved parameter ${spec.when.parameter}`,
          );
        }
        if (!sameValue(composition.parameters.values[spec.when.parameter], spec.when.equals)) {
          continue;
        }
      }
      const target = normalizeRelativePath(
        expandParameters(spec.target, composition.parameters.values, `${found.piece.id} contribution target`),
        `${found.piece.id} contribution target`,
        fail,
      );
      if (/[{}]/.test(target)) throw fail(`Unresolved contribution target for ${found.piece.id}`);
      const owner = ownersByComparison.get(target.toLowerCase());
      if (!owner) throw fail(`Contribution target is not owned: ${target}`);
      if (owner.path !== target) {
        throw fail(`Contribution target casing must match its exact owned path: ${target} != ${owner.path}`);
      }
      if (!owner.spec.assembly) throw fail(`Contribution target is not registered for assembly: ${target}`);
      const slot = owner.spec.assembly.slots[spec.slot];
      if (!slot) throw fail(`Unknown contribution slot ${spec.slot} for ${target}`);
      if (slot.type !== spec.fragment.type) {
        throw fail(
          `Incompatible contribution fragment ${found.piece.id}:${spec.slot}; expected ${slot.type}, got ${spec.fragment.type}`,
        );
      }
      const key = expandParameters(
        spec.key,
        composition.parameters.values,
        `${found.piece.id} contribution key`,
      );
      validateContributionKey(found.piece.id, key);
      const identity = `${target.toLowerCase()}\0${spec.slot}\0${key}`;
      if (keys.has(key)) throw fail(`Duplicate global contribution key: ${key}`);
      if (identities.has(identity)) throw fail(`Duplicate contribution identity: ${target}, ${spec.slot}, ${key}`);
      keys.add(key);
      identities.add(identity);
      const sourcePath = safeChild(found.directory, spec.fragment.source, "contribution fragment", fail);
      const source = renderEachBlocks(
        readFileSync(sourcePath, "utf8"),
        composition.parameters.values,
        variables,
        `${found.piece.id} contribution fragment`,
      );
      const expanded = expandParameters(
        source,
        composition.parameters.values,
        `${found.piece.id} contribution fragment`,
      );
      const templated = renderTemplate(
        expanded,
        variables,
        `${found.piece.id} contribution fragment`,
      );
      const content = renderRelativePathTokens(
        templated,
        composition.parameters.values,
        `${found.piece.id} contribution fragment`,
      );
      contributions.push({
        found,
        target,
        slot: spec.slot,
        key,
        type: spec.fragment.type,
        content,
        digest: sha256Bytes(Buffer.from(content, "utf8")),
      });
    }
  }
  return contributions.sort(
    (a, b) =>
      cmp(a.target, b.target) ||
      cmp(a.slot, b.slot) ||
      a.found.piece.order - b.found.piece.order ||
      cmp(a.key, b.key),
  );
}

function jsonSlotObject(
  contributions: ResolvedContribution[],
  target: string,
  slot: string,
): JsonObject {
  const merged: JsonObject = {};
  for (const contribution of contributions) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(contribution.content);
    } catch {
      throw fail(`Invalid JSON contribution ${contribution.key} for ${target}#${slot}`);
    }
    if (!isRecord(parsed)) {
      throw fail(`JSON contribution must be an object: ${contribution.key}`);
    }
    for (const [key, value] of sortedEntries(parsed)) {
      if (key in merged) {
        throw fail(`Incompatible JSON contribution key ${key} in ${target}#${slot}`);
      }
      merged[key] = value;
    }
  }
  return merged;
}

function normalizedFragment(contribution: ResolvedContribution): string {
  return contribution.content.replace(/\r\n?/g, "\n").trim();
}

function validateTomlSlot(
  contributions: ResolvedContribution[],
  target: string,
  slot: string,
): void {
  const identities = new Set<string>();
  for (const contribution of contributions) {
    let table = "";
    for (const line of normalizedFragment(contribution).split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const header = trimmed.match(/^\[\[?([^\]]+)\]\]?$/);
      if (header) {
        table = header[1].trim();
        const identity = `table:${table}`;
        if (identities.has(identity)) {
          throw fail(`Duplicate TOML table in ${target}#${slot}: ${table}`);
        }
        identities.add(identity);
        continue;
      }
      const assignment = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=/);
      if (assignment) {
        const identity = `key:${table}:${assignment[1]}`;
        if (identities.has(identity)) {
          throw fail(`Duplicate TOML key in ${target}#${slot}: ${assignment[1]}`);
        }
        identities.add(identity);
      }
    }
  }
}

function validateYamlSlot(
  contributions: ResolvedContribution[],
  target: string,
  slot: string,
): void {
  let shape: "mapping" | "sequence" | undefined;
  const keys = new Set<string>();
  for (const contribution of contributions) {
    const lines = normalizedFragment(contribution).split("\n");
    const first = lines.find((line) => line.trim() && !line.trim().startsWith("#"));
    if (!first) continue;
    const contributionShape = first.trimStart().startsWith("- ") ? "sequence" : "mapping";
    if (shape && shape !== contributionShape) {
      throw fail(`Mixed YAML mapping and sequence fragments in ${target}#${slot}`);
    }
    shape = contributionShape;
    if (shape === "mapping") {
      for (const line of lines) {
        const key = line.match(/^([A-Za-z0-9_.-]+):(?:\s|$)/);
        if (!key) continue;
        if (keys.has(key[1])) throw fail(`Duplicate YAML mapping key in ${target}#${slot}: ${key[1]}`);
        keys.add(key[1]);
      }
    }
  }
}

function textualSlotContent(
  contributions: ResolvedContribution[],
  type: Exclude<Format, "json">,
  target: string,
  slot: string,
): string {
  if (type === "toml") validateTomlSlot(contributions, target, slot);
  if (type === "yaml") validateYamlSlot(contributions, target, slot);
  const separator = type === "typescript" ? "\n" : "\n\n";
  return contributions.map(normalizedFragment).filter(Boolean).join(separator);
}

function renderOwnedFiles(
  composition: Composition,
  owners: Map<string, ExpandedOwner>,
  contributions: ResolvedContribution[],
): { rendered: Record<string, RenderedFile>; assemblies: Record<string, JsonObject> } {
  const rendered: Record<string, RenderedFile> = {};
  const assemblies: Record<string, JsonObject> = {};
  const variables = templateVariables(composition);
  for (const [path, owner] of [...owners.entries()].sort(([a], [b]) => cmp(a, b))) {
    if (owner.spec.generated === "scaffold-lock") continue;
    if (!owner.spec.template) throw fail(`Owned output has no template: ${path}`);
    const templatePath = safeChild(owner.found.directory, owner.spec.template, "owned template", fail);
    const ownerParameters = { ...composition.parameters.values, ...owner.localParameters };
    const localVariables = { ...variables };
    for (const [name, value] of sortedEntries(owner.localParameters)) {
      localVariables[name] = parameterText(value, name);
    }
    for (const [name, value] of sortedEntries(owner.spec.variables ?? {})) {
      localVariables[name] = renderTemplate(value, localVariables, `${path} variable ${name}`);
    }
    let content = renderEachBlocks(
      readFileSync(templatePath, "utf8"),
      ownerParameters,
      localVariables,
      `${path} template`,
    );
    content = expandParameters(
      content,
      ownerParameters,
      `${path} template`,
    );
    content = renderTemplate(content, localVariables, `${path} template`, true);
    const relativePathValues = owner.spec.forEach
      ? {
          ...ownerParameters,
          this: owner.localParameters[owner.spec.forEach.as],
        }
      : ownerParameters;
    content = renderRelativePathTokens(content, relativePathValues, `${path} template`);
    const targetContributions = contributions.filter((item) => item.target === path);
    const contributorIds = [...new Set(targetContributions.map((item) => item.found.piece.id))];
    if (owner.spec.assembly) {
      if (owner.spec.assembly.format === "json") {
        let seed: unknown;
        try {
          seed = JSON.parse(content);
        } catch {
          throw fail(`JSON assembly template must be an object: ${path}`);
        }
        if (!isRecord(seed)) throw fail(`JSON assembly template must be an object: ${path}`);
        const slots: Record<
          string,
          {
            fragment: JsonObject;
            placement: "root" | "property";
            property?: string;
          }
        > = {};
        for (const [slotName, slotSpec] of sortedEntries(owner.spec.assembly.slots)) {
          if (slotSpec.type !== "json") {
            throw fail(`JSON assembly slot ${path}#${slotName} must have type json`);
          }
          if (slotSpec.placement !== "root" && slotSpec.placement !== "property") {
            throw fail(`JSON assembly slot ${path}#${slotName} has no placement`);
          }
          slots[slotName] = {
            fragment: jsonSlotObject(
              targetContributions.filter((item) => item.slot === slotName),
              path,
              slotName,
            ),
            placement: slotSpec.placement,
            ...(slotSpec.property ? { property: slotSpec.property } : {}),
          };
        }
        content = stringifyJson(mergeJsonAssemblySlots(seed, slots, fail), true);
      } else {
        const markerCounts = new Map<string, number>();
        for (const match of content.matchAll(SLOT_MARKER_RE)) {
          markerCounts.set(match[1], (markerCounts.get(match[1]) ?? 0) + 1);
        }
        for (const marker of markerCounts.keys()) {
          if (!owner.spec.assembly.slots[marker]) throw fail(`Unknown slot marker ${marker} in ${path}`);
        }
        for (const [slotName, slotSpec] of sortedEntries(owner.spec.assembly.slots)) {
          if (markerCounts.get(slotName) !== 1) {
            throw fail(`Assembly target ${path} must contain exactly one marker for slot ${slotName}`);
          }
          const replacement = textualSlotContent(
            targetContributions.filter((item) => item.slot === slotName),
            slotSpec.type as Exclude<Format, "json">,
            path,
            slotName,
          );
          content = content.replace(`{{contributions:${slotName}}}`, replacement);
        }
        SLOT_MARKER_RE.lastIndex = 0;
        if (SLOT_MARKER_RE.test(content)) throw fail(`Unresolved assembly marker in ${path}`);
        SLOT_MARKER_RE.lastIndex = 0;
      }
      assemblies[path] = {
        owner: CORE_AGENTS_ID,
        registrant: owner.found.piece.id,
        format: owner.spec.assembly.format,
        contributions: targetContributions.map((item) => ({
          piece: item.found.piece.id,
          slot: item.slot,
          key: item.key,
          digest: item.digest,
        })),
      };
    } else if (targetContributions.length) {
      throw fail(`Contributions target a non-assembly output: ${path}`);
    }
    if (!content.endsWith("\n")) content += "\n";
    const bytes = Buffer.from(content, "utf8");
    rendered[path] = {
      piece: owner.spec.assembly ? CORE_AGENTS_ID : owner.found.piece.id,
      content: bytes,
      renderedSha256: sha256Bytes(bytes),
      ...(contributorIds.length ? { contributors: contributorIds } : {}),
    };
  }
  return { rendered, assemblies };
}

function renderEmissionInventory(
  found: FoundPiece,
  spec: EmissionSpec,
  composition: Composition,
): Inventory {
  const sourceRoot = safeChild(found.directory, spec.source, "emission source", fail);
  const files: Record<string, Uint8Array> = {};
  const variables = templateVariables(composition);
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => cmp(a.name, b.name));
    for (const entry of entries) {
      const sourcePath = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw fail(`Symlinks are not supported in skill emission: ${sourcePath}`);
      if (entry.isDirectory()) {
        visit(sourcePath);
        continue;
      }
      if (!entry.isFile()) continue;
      let outputPath = relative(sourceRoot, sourcePath).replaceAll("\\", "/");
      const isTemplate = outputPath.endsWith(".tmpl");
      if (isTemplate) outputPath = outputPath.slice(0, -5);
      outputPath = normalizeRelativePath(outputPath, `${spec.name} emission output`, fail);
      if (files[outputPath]) throw fail(`Duplicate emission output: ${spec.name}/${outputPath}`);
      if (isTemplate) {
        const expanded = expandParameters(
          readFileSync(sourcePath, "utf8"),
          composition.parameters.values,
          `${spec.name} emission template`,
        );
        const templated = renderTemplate(
          expanded,
          variables,
          `${spec.name} emission template`,
        );
        const relativePaths = renderRelativePathTokens(
          templated,
          composition.parameters.values,
          `${spec.name} emission template`,
        );
        files[outputPath] = Buffer.from(
          relativePaths,
          "utf8",
        );
      } else {
        files[outputPath] = readFileSync(sourcePath);
      }
    }
  };
  visit(sourceRoot);
  const digestInput = Object.entries(files)
    .sort(([a], [b]) => cmp(a, b))
    .map(([path, bytes]) => `${path}\0${sha256Bytes(bytes)}`)
    .join("\n");
  return { files, digest: sha256Bytes(Buffer.from(digestInput, "utf8")) };
}

function frontmatterName(bytes: Uint8Array, label: string): string {
  const text = Buffer.from(bytes).toString("utf8");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw fail(`${label} must begin with YAML frontmatter`);
  const fields = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (field) fields.set(field[1], field[2].replace(/^(["'])(.*)\1$/, "$2"));
  }
  const name = fields.get("name");
  const description = fields.get("description");
  if (!name || name.length > 64 || !SKILL_NAME_RE.test(name)) {
    throw fail(`${label} has an invalid or missing frontmatter name`);
  }
  if (!description) throw fail(`${label} has a missing frontmatter description`);
  return name;
}

function declaredFrontmatterName(bytes: Uint8Array): string | undefined {
  const text = Buffer.from(bytes).toString("utf8");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return undefined;
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^name:\s*(.*?)\s*$/);
    if (field) return field[1].replace(/^(["'])(.*)\1$/, "$2");
  }
  return undefined;
}

function directoryInventory(directory: string): Inventory {
  const files: Record<string, Uint8Array> = {};
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => cmp(a.name, b.name))) {
      const path = resolve(current, entry.name);
      if (entry.isSymbolicLink()) throw fail(`Symlinks are not supported in existing skill folders: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        const output = relative(directory, path).replaceAll("\\", "/");
        files[output] = readFileSync(path);
      }
    }
  };
  visit(directory);
  const digestInput = Object.entries(files)
    .sort(([a], [b]) => cmp(a, b))
    .map(([path, bytes]) => `${path}\0${sha256Bytes(bytes)}`)
    .join("\n");
  return { files, digest: sha256Bytes(Buffer.from(digestInput, "utf8")) };
}

function existingSkillNames(root: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const skillsRoot = resolve(root, ".agents", "skills");
  for (const skillPath of walkNamedFiles(skillsRoot, "SKILL.md", "existing formal skills")) {
    const name = declaredFrontmatterName(readFileSync(skillPath));
    if (!name) continue;
    const destinations = result.get(name) ?? [];
    destinations.push(relative(root, dirname(skillPath)).replaceAll("\\", "/"));
    result.set(name, destinations);
  }
  return result;
}

function readExistingLock(root: string): ScaffoldLock | undefined {
  const lockPath = resolve(root, LOCK_NAME);
  if (!existsSync(lockPath)) return undefined;
  const lock = loadJson(lockPath) as ScaffoldLock;
  validateScaffoldLockShape(lock, fail);
  return lock;
}

function priorRecord(lock: ScaffoldLock | undefined, path: string): LockRecord | undefined {
  if (!lock) return undefined;
  return lock.files[path] ?? lock.obsoleteFiles?.[path];
}

function destinationMatchesRecord(root: string, path: string, record: LockRecord | undefined): boolean {
  if (!record || typeof record.renderedSha256 !== "string") return false;
  const destination = safeChild(root, path, "managed destination", fail);
  return existsSync(destination) && statSync(destination).isFile() && sha256File(destination) === record.renderedSha256;
}

function emissionWasManaged(
  root: string,
  lock: ScaffoldLock | undefined,
  destination: string,
  spec: EmissionSpec,
): boolean {
  if (!lock || lock.schemaVersion !== 2 || !isRecord(lock.emissions)) return false;
  const record = lock.emissions[destination];
  if (
    !isRecord(record) ||
    record.destination !== destination ||
    record.name !== spec.name ||
    typeof record.digest !== "string"
  ) {
    return false;
  }
  const prefix = `${destination}/`;
  const managedPaths = Object.keys(lock.files).filter((path) => path.startsWith(prefix));
  if (!managedPaths.length) return false;
  const current = directoryInventory(safeChild(root, destination, "managed formal-skill destination", fail));
  const currentPaths = Object.keys(current.files).sort(cmp);
  const recordedPaths = managedPaths.map((path) => path.slice(prefix.length)).sort(cmp);
  if (!sameValue(currentPaths, recordedPaths)) return false;
  for (const target of managedPaths) {
    if (!destinationMatchesRecord(root, target, lock.files[target])) return false;
  }
  return true;
}

function planEmissions(
  root: string,
  composition: Composition,
  lock: ScaffoldLock | undefined,
  args: Args,
): PlannedEmission[] {
  const planned: PlannedEmission[] = [];
  const emittedNames = new Set<string>();
  const emittedDestinations = new Set<string>();
  const existingNames = existingSkillNames(root);
  const policy = String(composition.parameters.values["emission.collisionPolicy"] ?? "fail");
  if (!POLICIES.includes(policy as (typeof POLICIES)[number])) {
    throw fail(`Unsupported emission collision policy: ${policy}`);
  }
  for (const found of composition.pieces) {
    for (const spec of found.piece.emits) {
      const destination = normalizeRelativePath(
        expandParameters(spec.destination, composition.parameters.values, `${spec.name} destination`),
        `${spec.name} destination`,
        fail,
      );
      const expectedDestination = `.agents/skills/${spec.name}`;
      if (destination !== expectedDestination) {
        throw fail(
          `Formal skill ${spec.name} destination must be exactly ${expectedDestination}; got ${destination}`,
        );
      }
      const destinationKey = destination.toLowerCase();
      if (emittedNames.has(spec.name)) throw fail(`Duplicate emitted formal-skill name: ${spec.name}`);
      if (emittedDestinations.has(destinationKey)) {
        throw fail(`Duplicate formal-skill destination: ${destination}`);
      }
      emittedNames.add(spec.name);
      emittedDestinations.add(destinationKey);

      const inventory = renderEmissionInventory(found, spec, composition);
      const skillDocument = inventory.files["SKILL.md"];
      if (!skillDocument) throw fail(`Formal skill ${spec.name} must emit SKILL.md`);
      const outputName = frontmatterName(skillDocument, `${spec.name} emitted SKILL.md`);
      if (outputName !== spec.name) {
        throw fail(`Formal-skill manifest/source/output/frontmatter mismatch for ${spec.name}: ${outputName}`);
      }

      const absoluteDestination = safeChild(root, destination, "formal-skill destination", fail);
      const destinationExists = existsSync(absoluteDestination);
      if (destinationExists && !statSync(absoluteDestination).isDirectory()) {
        throw fail(`Formal-skill destination is not a directory: ${destination}`);
      }
      const sameNameDestinations = (existingNames.get(spec.name) ?? []).sort(cmp);
      const otherSameNames = sameNameDestinations.filter(
        (item) => item.toLowerCase() !== destinationKey,
      );
      const managed = destinationExists && emissionWasManaged(root, lock, destination, spec);
      if (managed && otherSameNames.length) {
        throw fail(
          `Existing folders declare formal-skill name ${spec.name}: ${otherSameNames.join(", ")}`,
        );
      }
      if (managed) {
        const current = directoryInventory(absoluteDestination);
        planned.push({
          found,
          spec,
          destination,
          inventory,
          action: current.digest === inventory.digest ? "unchanged" : "update",
          policy,
          provenanceAction: current.digest === inventory.digest ? "unchanged" : "update",
          provenancePolicy: policy,
        });
        continue;
      }

      if (policy === "migrate") {
        if (!args.migration) throw fail(`Migration policy requires --migration for ${spec.name}`);
        const migration = spec.migrations.find((item) => item.name === args.migration);
        if (!migration) {
          throw fail(`Piece ${found.piece.id} does not supply migration ${args.migration} for ${spec.name}`);
        }
        const migrationSource = normalizeRelativePath(
          expandParameters(migration.from, composition.parameters.values, `${spec.name} migration source`),
          `${spec.name} migration source`,
          fail,
        );
        const migrationParts = migrationSource.split("/");
        if (
          migrationParts.length !== 3 ||
          migrationParts[0] !== ".agents" ||
          migrationParts[1] !== "skills" ||
          !SKILL_NAME_RE.test(migrationParts[2])
        ) {
          throw fail(
            `Migration source must be one exact formal-skill folder under .agents/skills: ${migrationSource}`,
          );
        }
        const absoluteSource = safeChild(root, migrationSource, "formal-skill migration source", fail);
        if (!existsSync(absoluteSource) || !statSync(absoluteSource).isDirectory()) {
          throw fail(`Explicit migration source does not exist: ${migrationSource}`);
        }
        if (destinationExists) throw fail(`Migration destination already exists: ${destination}`);
        const unexpectedSameNames = otherSameNames.filter(
          (item) => item.toLowerCase() !== migrationSource.toLowerCase(),
        );
        if (unexpectedSameNames.length) {
          throw fail(
            `Existing folders declare formal-skill name ${spec.name}: ${unexpectedSameNames.join(", ")}`,
          );
        }
        planned.push({
          found,
          spec,
          destination,
          inventory,
          action: "migrate",
          policy,
          provenanceAction: "migrate",
          provenancePolicy: "migrate",
          migration,
          migrationSource,
          migrationSourceDigest: directoryInventory(absoluteSource).digest,
        });
        continue;
      }

      if (otherSameNames.length) {
        throw fail(
          `Existing folders declare formal-skill name ${spec.name}: ${otherSameNames.join(", ")}`,
        );
      }
      if (!destinationExists) {
        planned.push({
          found,
          spec,
          destination,
          inventory,
          action: "create",
          policy,
          provenanceAction: "create",
          provenancePolicy: policy,
        });
        continue;
      }

      const current = directoryInventory(absoluteDestination);
      const currentSkill = current.files["SKILL.md"];
      if (!currentSkill || frontmatterName(currentSkill, `${destination}/SKILL.md`) !== spec.name) {
        throw fail(`Existing formal-skill folder identity does not match ${spec.name}: ${destination}`);
      }
      if (policy === "fail") {
        throw fail(`Formal-skill destination already exists under fail policy: ${destination}`);
      }
      if (policy === "adopt") {
        if (!spec.adopt) throw fail(`Piece ${found.piece.id} does not explicitly support adopt for ${spec.name}`);
        if (current.digest !== inventory.digest) {
          throw fail(`Adopt requires an exact folder/frontmatter identity: ${destination}`);
        }
        planned.push({
          found,
          spec,
          destination,
          inventory,
          action: "adopt",
          policy,
          provenanceAction: "adopt",
          provenancePolicy: "adopt",
        });
        continue;
      }
      if (policy === "replace") {
        if (args.collisionPolicy !== "replace") {
          throw fail(`Replace requires an explicit caller choice for ${destination}`);
        }
        planned.push({
          found,
          spec,
          destination,
          inventory,
          action: "replace",
          policy,
          provenanceAction: "replace",
          provenancePolicy: "replace",
        });
        continue;
      }
      throw fail(`Policy ${policy} cannot resolve formal-skill destination ${destination}`);
    }
  }
  return planned.sort((a, b) => cmp(a.destination, b.destination));
}

function pieceDigest(found: FoundPiece): string {
  const hash = createHash("sha256");
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => cmp(a.name, b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw fail(`Symlink in piece digest inventory: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        hash.update(relative(found.directory, path).replaceAll("\\", "/"));
        hash.update("\0");
        hash.update(readFileSync(path));
        hash.update("\0");
      }
    }
  };
  visit(found.directory);
  return `sha256:${hash.digest("hex")}`;
}

function analyzeOwnedChanges(
  root: string,
  rendered: Record<string, RenderedFile>,
  lock: ScaffoldLock | undefined,
): Array<{ path: string; status: ChangeStatus }> {
  const changes: Array<{ path: string; status: ChangeStatus }> = [];
  for (const [path, file] of sortedEntries(rendered)) {
    const destination = safeChild(root, path, "owned output", fail);
    if (!existsSync(destination)) {
      changes.push({ path, status: "create" });
      continue;
    }
    if (!statSync(destination).isFile()) throw fail(`Owned output destination is not a file: ${path}`);
    const currentDigest = sha256File(destination);
    if (currentDigest === file.renderedSha256) {
      changes.push({ path, status: "unchanged" });
      continue;
    }
    if (!destinationMatchesRecord(root, path, priorRecord(lock, path))) {
      throw fail(`Owned output has unmanaged changes: ${path}`);
    }
    changes.push({ path, status: "update" });
  }
  return changes;
}

function assertFinalPathSeparation(
  rendered: Record<string, RenderedFile>,
  emissions: PlannedEmission[],
): void {
  const finalPaths = new Map<string, string>();
  for (const path of Object.keys(rendered)) finalPaths.set(path.toLowerCase(), path);
  for (const emission of emissions) {
    for (const path of Object.keys(emission.inventory.files)) {
      const finalPath = `${emission.destination}/${path}`;
      const key = finalPath.toLowerCase();
      const existing = finalPaths.get(key);
      if (existing) throw fail(`Duplicate final output path: ${existing} and ${finalPath}`);
      for (const [otherKey, otherPath] of finalPaths) {
        if (key.startsWith(`${otherKey}/`) || otherKey.startsWith(`${key}/`)) {
          throw fail(`Final output ancestor collision: ${otherPath} and ${finalPath}`);
        }
      }
      finalPaths.set(key, finalPath);
    }
    if (emission.migrationSource) {
      const source = emission.migrationSource.toLowerCase();
      const destination = emission.destination.toLowerCase();
      if (
        source === destination ||
        source.startsWith(`${destination}/`) ||
        destination.startsWith(`${source}/`)
      ) {
        throw fail(
          `Migration source and destination must be distinct non-ancestor paths: ${emission.migrationSource}`,
        );
      }
      for (const [pathKey, path] of finalPaths) {
        if (
          pathKey === source ||
          pathKey.startsWith(`${source}/`) ||
          source.startsWith(`${pathKey}/`)
        ) {
          throw fail(`Migration source collides with planned output ${path}: ${emission.migrationSource}`);
        }
      }
    }
  }
}

function outputFileRecords(
  rendered: Record<string, RenderedFile>,
  emissions: PlannedEmission[],
): Record<string, JsonObject> {
  const files: Record<string, JsonObject> = {};
  for (const [path, file] of sortedEntries(rendered)) {
    files[path] = {
      piece: file.piece,
      renderedSha256: file.renderedSha256,
      ...(file.contributors ? { contributors: file.contributors } : {}),
    };
  }
  for (const emission of emissions) {
    for (const [path, bytes] of sortedEntries(emission.inventory.files)) {
      const finalPath = `${emission.destination}/${path}`;
      files[finalPath] = {
        piece: emission.found.piece.id,
        emission: emission.spec.name,
        renderedSha256: sha256Bytes(bytes),
      };
    }
  }
  return files;
}

function obsoleteFileRecords(
  root: string,
  existing: ScaffoldLock | undefined,
  current: Record<string, JsonObject>,
): Record<string, JsonObject> {
  if (!existing) return {};
  const obsolete: Record<string, JsonObject> = {};
  const candidates = { ...(existing.obsoleteFiles ?? {}), ...existing.files };
  for (const [path, rawRecord] of sortedEntries(candidates)) {
    if (current[path] || !isRecord(rawRecord)) continue;
    if (destinationMatchesRecord(root, path, rawRecord)) obsolete[path] = rawRecord;
  }
  return obsolete;
}

function buildLock(
  root: string,
  composition: Composition,
  rendered: Record<string, RenderedFile>,
  assemblies: Record<string, JsonObject>,
  emissions: PlannedEmission[],
  existing: ScaffoldLock | undefined,
): Uint8Array {
  const version = stringValue(SKILL_VERSION, "skill version", VERSION_RE);
  const pieces: Record<string, JsonObject> = {};
  for (const found of composition.pieces) {
    pieces[found.piece.id] = {
      version: found.piece.version,
      kind: found.piece.kind,
      order: found.piece.order,
      digest: pieceDigest(found),
    };
  }
  const files = outputFileRecords(rendered, emissions);
  const obsoleteFiles = obsoleteFileRecords(root, existing, files);
  const parameterResolution: Record<string, JsonObject> = {};
  for (const [name, value] of sortedEntries(composition.parameters.values)) {
    parameterResolution[name] = {
      value,
      source: composition.parameters.sources[name],
    };
  }
  const emissionRecords: Record<string, JsonObject> = {};
  for (const emission of emissions) {
    emissionRecords[emission.destination] = {
      piece: emission.found.piece.id,
      name: emission.spec.name,
      destination: emission.destination,
      policy: emission.provenancePolicy,
      action: emission.provenanceAction,
      digest: emission.inventory.digest,
      ...(emission.migration ? { migration: emission.migration.name } : {}),
      ...(emission.migrationSource
        ? {
            migrationSource: emission.migrationSource,
            migrationSourceDigest: emission.migrationSourceDigest,
          }
        : {}),
    };
  }
  const lock: JsonObject = {
    schemaVersion: 2,
    generator: {
      skill: stringValue(SKILL_NAME, "skill name", SKILL_NAME_RE),
      version,
    },
    profile: String(composition.parameters.values["composition.profile"]),
    inputs: {
      projectName: String(composition.parameters.values["project.name"]),
      scopes: composition.parameters.values["project.scopes"] ?? [],
    },
    resolution: {
      profileChain: composition.profile.chain,
      profileCatalogDigest: composition.profile.catalogDigest,
      pieceOrder: composition.pieces.map((found) => found.piece.id),
      capabilityProviders: composition.providers,
      parameters: parameterResolution,
    },
    pieces,
    files,
    ...(Object.keys(obsoleteFiles).length ? { obsoleteFiles } : {}),
    assemblies,
    emissions: emissionRecords,
  };
  validateScaffoldLockShape(lock, fail);
  return Buffer.from(stringifyJson(lock, true), "utf8");
}

function buildPlan(args: Args): Plan {
  const root = resolveRootPath(args.root);
  if (existsSync(root) && !statSync(root).isDirectory()) throw fail(`Target root is not a directory: ${root}`);
  const discovered = discoverPieces();
  const catalog = loadProfiles(discovered);
  const profile = expandProfile(args.profile, catalog.profiles, catalog.digest);
  const resolved = resolvePieces(profile, discovered);
  const composition: Composition = {
    profile,
    pieces: resolved.pieces,
    providers: resolved.providers,
    parameters: { values: {}, sources: {} },
  };
  composition.parameters = resolveParameters(
    composition.pieces,
    discovered,
    profile,
    { ...args, root },
  );
  const { owners, byComparison } = resolveOwners(composition);
  const contributions = resolveContributions(composition, byComparison);
  const { rendered, assemblies } = renderOwnedFiles(composition, owners, contributions);
  const existingLock = readExistingLock(root);
  const emissions = planEmissions(root, composition, existingLock, args);
  assertFinalPathSeparation(rendered, emissions);
  const changes = analyzeOwnedChanges(root, rendered, existingLock);
  const lockContent = buildLock(
    root,
    composition,
    rendered,
    assemblies,
    emissions,
    existingLock,
  );
  return {
    root,
    profile: args.profile,
    composition,
    rendered,
    assemblies,
    emissions,
    changes,
    lockContent,
  };
}

function applyPlan(plan: Plan): void {
  mkdirSync(plan.root, { recursive: true });
  const statuses = new Map(plan.changes.map((change) => [change.path, change.status]));
  for (const [path, file] of sortedEntries(plan.rendered)) {
    if (statuses.get(path) === "unchanged") continue;
    atomicWrite(safeChild(plan.root, path, "owned output", fail), file.content);
  }
  for (const emission of plan.emissions) {
    if (["adopt", "unchanged"].includes(emission.action)) continue;
    atomicReplaceDirectory(
      safeChild(plan.root, emission.destination, "formal-skill destination", fail),
      emission.inventory.files,
      fail,
    );
    if (emission.action === "migrate" && emission.migrationSource) {
      const source = safeChild(plan.root, emission.migrationSource, "formal-skill migration source", fail);
      if (existsSync(source)) rmSync(source, { recursive: true, force: false });
    }
  }
  atomicWrite(resolve(plan.root, LOCK_NAME), plan.lockContent);
}

function parseParameterAssignment(value: string): [string, unknown] {
  const equals = value.indexOf("=");
  if (equals <= 0) throw fail(`--param must be NAME=VALUE: ${value}`);
  const name = value.slice(0, equals);
  if (!PARAM_RE.test(name)) throw fail(`Invalid parameter name: ${name}`);
  const raw = value.slice(equals + 1);
  if (!raw.length) return [name, ""];
  try {
    return [name, JSON.parse(raw)];
  } catch {
    return [name, raw];
  }
}

function parseArgs(argv: string[]): Args {
  const command = argv.shift();
  if (command !== "plan" && command !== "apply") {
    throw fail("Usage: scaffold.ts <plan|apply> --root PATH [--profile ID] [options]");
  }
  let root: string | undefined;
  let profile = "agents-minimal";
  let projectName: string | undefined;
  let collisionPolicy: string | undefined;
  let migration: string | undefined;
  let asJson = false;
  const scopes: string[] = [];
  const parameters: Record<string, unknown> = {};
  const next = (flag: string): string => {
    const value = argv.shift();
    if (value === undefined) throw fail(`Missing value for ${flag}`);
    return value;
  };
  while (argv.length) {
    const flag = argv.shift()!;
    if (flag === "--root") root = next(flag);
    else if (flag === "--profile") profile = next(flag);
    else if (flag === "--project-name") projectName = next(flag);
    else if (flag === "--scope") scopes.push(next(flag));
    else if (flag === "--param") {
      const [name, value] = parseParameterAssignment(next(flag));
      if (name in parameters) throw fail(`Duplicate caller parameter: ${name}`);
      parameters[name] = value;
    } else if (flag === "--collision-policy") collisionPolicy = next(flag);
    else if (flag === "--migration") migration = next(flag);
    else if (flag === "--json") asJson = true;
    else throw fail(`Unknown argument: ${flag}`);
  }
  if (!root) throw fail("--root is required");
  if (!ID_RE.test(profile)) throw fail(`Invalid profile ID: ${profile}`);
  if (collisionPolicy && !POLICIES.includes(collisionPolicy as (typeof POLICIES)[number])) {
    throw fail(`Invalid collision policy: ${collisionPolicy}`);
  }
  if (collisionPolicy !== "migrate" && migration) {
    throw fail("--migration is valid only with --collision-policy migrate");
  }
  return {
    command,
    root,
    profile,
    scopes,
    projectName,
    parameters,
    collisionPolicy,
    migration,
    asJson,
  };
}

function planSummary(plan: Plan): JsonObject {
  return {
    root: plan.root,
    profile: plan.profile,
    profileChain: plan.composition.profile.chain,
    pieceOrder: plan.composition.pieces.map((found) => found.piece.id),
    parameters: plan.composition.parameters,
    files: plan.changes,
    emissions: plan.emissions.map((emission) => ({
      name: emission.spec.name,
      destination: emission.destination,
      action: emission.action,
      policy: emission.provenancePolicy,
      ...(emission.migration ? { migration: emission.migration.name } : {}),
    })),
  };
}

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    const plan = buildPlan(args);
    if (args.command === "apply") applyPlan(plan);
    const summary = planSummary(plan);
    if (args.asJson) console.log(stringifyJson(summary, true).trimEnd());
    else {
      console.log(`${args.command === "apply" ? "Applied" : "Planned"} profile ${plan.profile}`);
      console.log(`Pieces: ${plan.composition.pieces.map((found) => found.piece.id).join(", ")}`);
      for (const change of plan.changes) console.log(`${change.status.padEnd(9)} ${change.path}`);
      for (const emission of plan.emissions) {
        console.log(`${emission.action.padEnd(9)} ${emission.destination}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`project-scaffold: ${message}`);
    process.exitCode = 1;
  }
}

main();
