import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { atomicWrite, safeChild } from "./core.ts";

const SCAFFOLD = resolve(import.meta.dir, "scaffold.ts");
const VALIDATE = resolve(import.meta.dir, "validate.ts");
const temporaryRoots: string[] = [];

function temporaryRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `project-scaffold-${label}-`));
  temporaryRoots.push(root);
  return root;
}

function run(script: string, args: string[]) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, script, ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("project scaffold Bun CLI", () => {
  test("plans, applies, reapplies idempotently, and validates", () => {
    const project = join(temporaryRoot("lifecycle"), "project");
    const common = [
      "--root",
      project,
      "--profile",
      "agents-minimal",
      "--project-name",
      "Parity Project",
      "--json",
    ];

    const plan = run(SCAFFOLD, ["plan", ...common]);
    expect(plan.exitCode).toBe(0);
    expect(JSON.parse(plan.stdout).files).toHaveLength(9);
    expect(
      JSON.parse(plan.stdout).files.every(
        (file: { status: string }) => file.status === "create",
      ),
    ).toBe(true);
    expect(existsSync(project)).toBe(false);

    const apply = run(SCAFFOLD, ["apply", ...common]);
    expect(apply.exitCode).toBe(0);
    expect(JSON.parse(apply.stdout).files).toHaveLength(9);
    const lockPath = join(project, ".project-scaffold.lock.json");
    const firstLock = readFileSync(lockPath);

    const secondApply = run(SCAFFOLD, ["apply", ...common]);
    expect(secondApply.exitCode).toBe(0);
    expect(
      JSON.parse(secondApply.stdout).files.every(
        (file: { status: string }) => file.status === "unchanged",
      ),
    ).toBe(true);
    expect(readFileSync(lockPath)).toEqual(firstLock);

    const nativeReapply = run(SCAFFOLD, ["apply", ...common.slice(0, -1)]);
    expect(nativeReapply.exitCode).toBe(0);
    expect(nativeReapply.stdout).toContain("Applied profile agents-minimal");
    expect(nativeReapply.stdout).toContain("unchanged AGENTS.md");

    const validation = run(VALIDATE, ["--root", project, "--json"]);
    expect(validation.exitCode).toBe(0);
    expect(JSON.parse(validation.stdout).counts.ok).toBe(9);
  });

  test("protects a user-modified generated file", () => {
    const project = join(temporaryRoot("conflict"), "project");
    const common = ["--root", project, "--profile", "agents-minimal", "--json"];
    expect(run(SCAFFOLD, ["apply", ...common]).exitCode).toBe(0);

    appendFileSync(join(project, ".agents", "shared", "commands.md"), "user change\n");
    const apply = run(SCAFFOLD, ["apply", ...common]);
    expect(apply.exitCode).not.toBe(0);
    expect(apply.stderr).toContain(
      "Owned output has unmanaged changes: .agents/shared/commands.md",
    );

    const validation = run(VALIDATE, ["--root", project, "--json"]);
    expect(validation.exitCode).toBe(1);
    expect(JSON.parse(validation.stdout).counts.modified).toBe(1);
  });

  test("rejects reserved scopes and path traversal", () => {
    const project = join(temporaryRoot("safety"), "project");
    const reserved = run(SCAFFOLD, [
      "plan",
      "--root",
      project,
      "--profile",
      "agents-minimal",
      "--scope",
      "shared",
    ]);
    expect(reserved.exitCode).not.toBe(0);
    expect(reserved.stderr).toContain("Reserved scope: shared");
    const windowsDevice = run(SCAFFOLD, [
      "plan",
      "--root",
      project,
      "--profile",
      "agents-minimal",
      "--scope",
      "con",
    ]);
    expect(windowsDevice.exitCode).not.toBe(0);
    expect(windowsDevice.stderr).toContain("Reserved scope: con");
    expect(() =>
      safeChild(project, "../escape", "output", (message) => new Error(message)),
    ).toThrow("Unsafe output path");
  });

  test("atomically replaces an existing file on this platform", () => {
    const root = temporaryRoot("atomic");
    const target = join(root, "state.txt");
    atomicWrite(target, Buffer.from("first\n"));
    atomicWrite(target, Buffer.from("second\n"));
    expect(readFileSync(target, "utf8")).toBe("second\n");
  });

  test("fails validation for a modified obsolete file", () => {
    const project = join(temporaryRoot("obsolete"), "project");
    expect(
      run(SCAFFOLD, [
        "apply",
        "--root",
        project,
        "--profile",
        "agents-minimal",
        "--json",
      ]).exitCode,
    ).toBe(0);
    const lockPath = join(project, ".project-scaffold.lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.obsoleteFiles = {
      "obsolete.md": {
        piece: "agents",
        renderedSha256: `sha256:${"0".repeat(64)}`,
      },
    };
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    writeFileSync(join(project, "obsolete.md"), "user-owned content\n");

    const validation = run(VALIDATE, ["--root", project, "--json"]);
    expect(validation.exitCode).toBe(1);
    expect(JSON.parse(validation.stdout).counts["obsolete-modified"]).toBe(1);
  });
});
