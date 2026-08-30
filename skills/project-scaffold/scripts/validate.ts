#!/usr/bin/env bun

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  isRecord,
  loadJsonObject,
  resolveRootPath,
  safeChild,
  sha256File,
  sortedEntries,
  stringifyJson,
  validateScaffoldLockShape,
  type JsonObject,
} from "./core.ts";

const LOCK_NAME = ".project-scaffold.lock.json";

interface ValidationArguments {
  root: string;
  asJson: boolean;
}

interface ScaffoldLock extends JsonObject {
  schemaVersion: 1;
  files: Record<string, unknown>;
  obsoleteFiles?: Record<string, unknown>;
}

type ValidationStatus =
  | "missing"
  | "modified"
  | "obsolete-generated"
  | "obsolete-modified"
  | "ok";

export class ValidationError extends Error {}

const validationError = (message: string): ValidationError => new ValidationError(message);

function loadLock(path: string): ScaffoldLock {
  let lock: JsonObject;
  try {
    lock = loadJsonObject(path, validationError);
  } catch (error) {
    if (error instanceof ValidationError && error.message.startsWith("Missing required file:")) {
      throw new ValidationError(`Missing scaffold lock: ${path}`);
    }
    if (error instanceof ValidationError && error.message.startsWith("Invalid JSON in")) {
      throw new ValidationError(
        error.message.replace(
          `Invalid JSON in ${path}: `,
          "Invalid scaffold lock JSON: ",
        ),
      );
    }
    throw error;
  }
  validateScaffoldLockShape(lock, validationError);
  return lock as ScaffoldLock;
}

function inspect(
  root: string,
  lock: ScaffoldLock,
): Array<{ path: string; status: ValidationStatus }> {
  const results: Array<{ path: string; status: ValidationStatus }> = [];
  for (const [relative, unknownRecord] of sortedEntries(lock.files)) {
    if (!isRecord(unknownRecord) || typeof unknownRecord.renderedSha256 !== "string") {
      throw new ValidationError(`Invalid file record in lock: ${relative}`);
    }
    const target = safeChild(root, relative, "locked", validationError);
    let status: ValidationStatus;
    if (!existsSync(target) || !statSync(target).isFile()) status = "missing";
    else if (sha256File(target) !== unknownRecord.renderedSha256) status = "modified";
    else status = "ok";
    results.push({ path: relative, status });
  }

  for (const [relative, unknownRecord] of sortedEntries(lock.obsoleteFiles ?? {})) {
    const target = safeChild(root, relative, "locked", validationError);
    if (!existsSync(target)) continue;
    const expected = isRecord(unknownRecord) ? unknownRecord.renderedSha256 : undefined;
    const status: ValidationStatus =
      statSync(target).isFile() &&
      typeof expected === "string" &&
      sha256File(target) === expected
        ? "obsolete-generated"
        : "obsolete-modified";
    results.push({ path: relative, status });
  }
  return results;
}

function parseArguments(argv: string[]): ValidationArguments {
  let root: string | undefined;
  let asJson = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--json") {
      asJson = true;
      continue;
    }
    const name = token.split("=", 1)[0]!;
    if (name !== "--root") throw new ValidationError(`Unknown argument: ${token}`);
    const equals = token.indexOf("=");
    if (equals >= 0) root = token.slice(equals + 1);
    else {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new ValidationError("Missing value for --root");
      }
      root = value;
      index += 1;
    }
  }
  if (!root) throw new ValidationError("--root is required.");
  return { root, asJson };
}

export function runValidation(argv: string[]): number {
  try {
    const args = parseArguments(argv);
    const root = resolveRootPath(args.root);
    const lock = loadLock(resolve(root, LOCK_NAME));
    const results = inspect(root, lock);
    const statuses: ValidationStatus[] = [
      "missing",
      "modified",
      "obsolete-generated",
      "obsolete-modified",
      "ok",
    ];
    const counts = Object.fromEntries(
      statuses.map((status) => [
        status,
        results.filter((item) => item.status === status).length,
      ]),
    ) as Record<ValidationStatus, number>;
    const summary: JsonObject = {
      root,
      profile: lock.profile,
      generator: lock.generator,
      results,
      counts,
    };
    if (args.asJson) console.log(stringifyJson(summary));
    else {
      for (const item of results) {
        console.log(`${item.status.padStart(18)}  ${item.path}`);
      }
      console.log(
        `Summary: ${Object.keys(counts)
          .sort()
          .map((name) => `${name}=${counts[name as ValidationStatus]}`)
          .join(", ")}`,
      );
    }
    return counts.missing || counts.modified || counts["obsolete-modified"] ? 1 : 0;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`error: ${detail}`);
    return 2;
  }
}

if (import.meta.main) process.exitCode = runValidation(Bun.argv.slice(2));
