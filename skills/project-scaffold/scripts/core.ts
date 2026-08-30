#!/usr/bin/env bun

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";

export type JsonObject = Record<string, unknown>;
export type ErrorFactory = (message: string) => Error;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SEMANTIC_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WINDOWS_DEVICE_PATTERN =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformedLock(makeError: ErrorFactory): never {
  throw makeError("Unsupported or malformed scaffold lock");
}

function validateGenerator(
  lock: JsonObject,
  makeError: ErrorFactory,
): void {
  const generator = lock.generator;
  if (
    !isRecord(generator) ||
    typeof (lock.schemaVersion === 1 ? generator.plugin : generator.skill) !== "string" ||
    typeof generator.version !== "string" ||
    !SEMANTIC_VERSION_PATTERN.test(generator.version)
  ) {
    malformedLock(makeError);
  }
}

function validatePieceRecords(
  value: unknown,
  makeError: ErrorFactory,
): void {
  if (!isRecord(value)) malformedLock(makeError);
  for (const piece of Object.values(value)) {
    if (
      !isRecord(piece) ||
      typeof piece.version !== "string" ||
      !SEMANTIC_VERSION_PATTERN.test(piece.version) ||
      typeof piece.digest !== "string" ||
      !SHA256_PATTERN.test(piece.digest) ||
      (piece.kind !== undefined && typeof piece.kind !== "string") ||
      (piece.order !== undefined && !Number.isInteger(piece.order))
    ) {
      malformedLock(makeError);
    }
  }
}

function validateFileRecords(
  value: unknown,
  makeError: ErrorFactory,
): void {
  if (!isRecord(value)) malformedLock(makeError);
  for (const record of Object.values(value)) {
    if (
      !isRecord(record) ||
      typeof record.piece !== "string" ||
      typeof record.renderedSha256 !== "string" ||
      !SHA256_PATTERN.test(record.renderedSha256) ||
      (record.emission !== undefined && typeof record.emission !== "string") ||
      (record.contributors !== undefined &&
        (!Array.isArray(record.contributors) ||
          !record.contributors.every((key) => typeof key === "string")))
    ) {
      malformedLock(makeError);
    }
  }
}

export function validateScaffoldLockShape(
  lock: JsonObject,
  makeError: ErrorFactory,
): void {
  if (lock.schemaVersion !== 1 && lock.schemaVersion !== 2) {
    malformedLock(makeError);
  }
  validateGenerator(lock, makeError);
  if (
    typeof lock.profile !== "string" ||
    !isRecord(lock.inputs) ||
    typeof lock.inputs.projectName !== "string" ||
    !Array.isArray(lock.inputs.scopes) ||
    !lock.inputs.scopes.every((scope) => typeof scope === "string")
  ) {
    malformedLock(makeError);
  }
  validatePieceRecords(lock.pieces, makeError);
  validateFileRecords(lock.files, makeError);
  if (lock.obsoleteFiles !== undefined) {
    validateFileRecords(lock.obsoleteFiles, makeError);
  }
  if (lock.schemaVersion === 1) return;

  if (
    !isRecord(lock.resolution) ||
    !Array.isArray(lock.resolution.profileChain) ||
    !lock.resolution.profileChain.every((item) => typeof item === "string") ||
    !Array.isArray(lock.resolution.pieceOrder) ||
    !lock.resolution.pieceOrder.every((item) => typeof item === "string") ||
    typeof lock.resolution.profileCatalogDigest !== "string" ||
    !SHA256_PATTERN.test(lock.resolution.profileCatalogDigest) ||
    !isRecord(lock.resolution.capabilityProviders) ||
    !isRecord(lock.resolution.parameters) ||
    !isRecord(lock.assemblies) ||
    !isRecord(lock.emissions)
  ) {
    malformedLock(makeError);
  }
  for (const assembly of Object.values(lock.assemblies)) {
    if (
      !isRecord(assembly) ||
      assembly.owner !== "core.agents" ||
      typeof assembly.registrant !== "string" ||
      typeof assembly.format !== "string" ||
      !Array.isArray(assembly.contributions) ||
      !assembly.contributions.every(
        (item) =>
          isRecord(item) &&
          typeof item.piece === "string" &&
          typeof item.slot === "string" &&
          typeof item.key === "string" &&
          typeof item.digest === "string" &&
          SHA256_PATTERN.test(item.digest),
      )
    ) {
      malformedLock(makeError);
    }
  }
  for (const emission of Object.values(lock.emissions)) {
    if (
      !isRecord(emission) ||
      typeof emission.piece !== "string" ||
      typeof emission.name !== "string" ||
      emission.name.length > 64 ||
      !SKILL_NAME_PATTERN.test(emission.name) ||
      typeof emission.destination !== "string" ||
      typeof emission.policy !== "string" ||
      !["fail", "adopt", "replace", "migrate"].includes(emission.policy) ||
      typeof emission.action !== "string" ||
      !["adopt", "create", "migrate", "replace", "unchanged", "update"].includes(
        emission.action,
      ) ||
      typeof emission.digest !== "string" ||
      !SHA256_PATTERN.test(emission.digest) ||
      (emission.migration !== undefined &&
        typeof emission.migration !== "string") ||
      (emission.migrationSource !== undefined &&
        typeof emission.migrationSource !== "string") ||
      (emission.migrationSourceDigest !== undefined &&
        (typeof emission.migrationSourceDigest !== "string" ||
          !SHA256_PATTERN.test(emission.migrationSourceDigest)))
    ) {
      malformedLock(makeError);
    }
  }
}

export function loadJsonObject(
  path: string,
  makeError: ErrorFactory,
): JsonObject {
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw makeError(`Missing required file: ${path}`);
    }
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw makeError(`Invalid JSON in ${path}: ${detail}`);
  }
  if (!isRecord(value)) {
    throw makeError(`Expected a JSON object in ${path}`);
  }
  return value;
}

export function expandUserPath(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

export function resolveRootPath(value: string): string {
  const absolute = resolve(expandUserPath(value));
  return existsSync(absolute) ? realpathSync(absolute) : absolute;
}

function isWithin(root: string, candidate: string): boolean {
  const remainder = relative(root, candidate);
  return (
    remainder === "" ||
    (remainder !== ".." &&
      !remainder.startsWith(`..${sep}`) &&
      !isAbsolute(remainder))
  );
}

export function normalizeRelativePath(
  value: string,
  label: string,
  makeError: ErrorFactory,
): string {
  const portable = value.replaceAll("\\", "/");
  const hasWindowsRoot =
    /^[a-zA-Z]:\//.test(portable) || portable.startsWith("//");
  const parts = portable.split("/");
  if (
    !portable ||
    isAbsolute(value) ||
    posix.isAbsolute(portable) ||
    hasWindowsRoot ||
    parts.includes("..") ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        /[\u0000-\u001f<>:"|?*]/.test(part) ||
        /[ .]$/.test(part) ||
        WINDOWS_DEVICE_PATTERN.test(part),
    )
  ) {
    throw makeError(`Unsafe ${label} path: ${value}`);
  }
  const normalized = posix.normalize(portable);
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized !== portable
  ) {
    throw makeError(`Unsafe ${label} path: ${value}`);
  }
  return normalized;
}

export function safeChild(
  root: string,
  value: string,
  label: string,
  makeError: ErrorFactory,
): string {
  const normalized = normalizeRelativePath(value, label, makeError);
  const canonicalRoot = existsSync(root) ? realpathSync(root) : resolve(root);
  let candidate = canonicalRoot;
  const segments = normalized.split("/");

  for (const [index, segment] of segments.entries()) {
    const next = join(candidate, segment);
    if (existsSync(next)) {
      const actual = realpathSync(next);
      if (!isWithin(canonicalRoot, actual)) {
        throw makeError(`${capitalize(label)} escapes its root: ${value}`);
      }
      if (index < segments.length - 1 && !statSync(actual).isDirectory()) {
        throw makeError(
          `${capitalize(label)} has a non-directory ancestor: ${value}`,
        );
      }
      candidate = actual;
    } else {
      candidate = next;
    }
  }

  if (!isWithin(canonicalRoot, candidate)) {
    throw makeError(`${capitalize(label)} escapes its root: ${value}`);
  }
  return candidate;
}

export function sha256Bytes(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function sha256File(path: string): string {
  return sha256Bytes(readFileSync(path));
}

export function atomicWrite(path: string, content: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const nonce = `${process.pid}.${randomUUID()}`;
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${nonce}.tmp`,
  );
  const backup = join(dirname(path), `.${basename(path)}.${nonce}.bak`);
  let descriptor: number | undefined;
  let backedUp = false;
  let installed = false;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (existsSync(path)) {
      renameSync(path, backup);
      backedUp = true;
    }
    renameSync(temporary, path);
    installed = true;
    if (backedUp) {
      try {
        unlinkSync(backup);
        backedUp = false;
      } catch {
        // Cleanup is best-effort after the destination is committed.
      }
    }
  } catch (error) {
    if (!installed && backedUp && !existsSync(path) && existsSync(backup)) {
      renameSync(backup, path);
      backedUp = false;
    }
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
    if (installed && existsSync(backup)) {
      try {
        unlinkSync(backup);
      } catch {
        // The destination is committed; retain a recoverable backup if cleanup fails.
      }
    }
  }
}

export function atomicReplaceDirectory(
  destination: string,
  files: Record<string, Uint8Array>,
  makeError: ErrorFactory,
): void {
  const parent = dirname(destination);
  mkdirSync(parent, { recursive: true });
  const nonce = `${process.pid}.${randomUUID()}`;
  const staging = join(parent, `.${basename(destination)}.${nonce}.tmp`);
  const backup = join(parent, `.${basename(destination)}.${nonce}.bak`);
  let backedUp = false;
  let installed = false;
  try {
    mkdirSync(staging);
    for (const [relativePath, content] of sortedEntries(files)) {
      atomicWrite(
        safeChild(staging, relativePath, "emission staging", makeError),
        content,
      );
    }
    if (existsSync(destination)) {
      renameSync(destination, backup);
      backedUp = true;
    }
    renameSync(staging, destination);
    installed = true;
    if (backedUp) {
      try {
        rmSync(backup, { recursive: true, force: true });
        backedUp = false;
      } catch {
        // Cleanup is best-effort after the destination is committed.
      }
    }
  } catch (error) {
    if (!installed && !existsSync(destination) && backedUp && existsSync(backup)) {
      renameSync(backup, destination);
      backedUp = false;
    }
    throw error;
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    if (installed && existsSync(backup)) {
      try {
        rmSync(backup, { recursive: true, force: true });
      } catch {
        // The destination is committed; retain a recoverable backup if cleanup fails.
      }
    }
  }
}

export function stringifyJson(
  value: unknown,
  trailingNewline = false,
): string {
  const json = JSON.stringify(sortJson(value), null, 2).replace(
    /[\u007f-\uffff]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return trailingNewline ? `${json}\n` : json;
}

export function sortedEntries<T>(
  record: Record<string, T>,
): Array<[string, T]> {
  return Object.entries(record).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

export function mergeJsonAssemblySlots(
  seed: JsonObject,
  slots: Record<
    string,
    {
      fragment: JsonObject;
      placement: "root" | "property";
      property?: string;
    }
  >,
  makeError: ErrorFactory,
): JsonObject {
  const result: JsonObject = { ...seed };
  for (const [slot, spec] of sortedEntries(slots)) {
    const { fragment } = spec;
    if (!Object.keys(fragment).length) continue;
    if (spec.placement === "root") {
      for (const [key, value] of sortedEntries(fragment)) {
        if (key in result) {
          throw makeError(`JSON assembly root key collision: ${key}`);
        }
        result[key] = value;
      }
      continue;
    }
    const property = spec.property ?? slot;
    if (property in result) {
      throw makeError(`JSON assembly property collision: ${property}`);
    }
    result[property] = fragment;
  }
  return result;
}

export function isNodeError(
  value: unknown,
): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}

function capitalize(value: string): string {
  return value.length ? value[0]!.toUpperCase() + value.slice(1) : value;
}
