import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mergeJsonAssemblySlots } from "./core.ts";

const SKILL_ROOT = resolve(import.meta.dir, "..");
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

describe("foundation blockers and Bun workspace integration", () => {
  test("merges root-object and named JSON slots deterministically", () => {
    const merged = mergeJsonAssemblySlots(
      {},
      {
        scripts: { verify: "bun run --workspaces --if-present verify" },
        "root-object": {
          name: "workspace-root",
          private: true,
          workspaces: ["frontend", "backend", "packages/*"],
        },
      },
      (message) => new Error(message),
    );

    expect(merged).toEqual({
      name: "workspace-root",
      private: true,
      workspaces: ["frontend", "backend", "packages/*"],
      scripts: { verify: "bun run --workspaces --if-present verify" },
    });
    expect(() =>
      mergeJsonAssemblySlots(
        { scripts: {} },
        { scripts: { build: "bun run --workspaces --if-present build" } },
        (message) => new Error(message),
      ),
    ).toThrow("JSON assembly slot collision: scripts");
  });

  test("resolves the foundation capability and applies the workspace piece", () => {
    const fixturePlugin = join(temporaryRoot("workspace"), "project-scaffold");
    cpSync(resolve(SKILL_ROOT, "..", ".."), fixturePlugin, { recursive: true });
    const fixture = join(fixturePlugin, "skills", "project-scaffold");
    const profilesPath = join(fixture, "references", "profiles.json");
    const profiles = JSON.parse(readFileSync(profilesPath, "utf8"));
    profiles.profiles["workspace-only"] = {
      description: "Focused workspace regression profile.",
      extends: ["agents-minimal"],
      pieces: ["workspace.bun-monorepo"],
      pieceOrders: [],
      excludeKinds: ["release", "delivery"],
      parameters: {},
    };
    writeFileSync(profilesPath, `${JSON.stringify(profiles, null, 2)}\n`);

    const project = join(temporaryRoot("target"), "project");
    const result = run(join(fixture, "scripts", "scaffold.ts"), [
      "apply",
      "--root",
      project,
      "--profile",
      "workspace-only",
      "--json",
    ]);
    expect(result.exitCode, result.stderr).toBe(0);

    const packageJson = JSON.parse(readFileSync(join(project, "package.json"), "utf8"));
    expect(packageJson).toEqual({
      name: "workspace-root",
      packageManager: "bun@1.3.14",
      private: true,
      scripts: {
        build: "bun run --workspaces --if-present build",
        dev: "bun run --workspaces --if-present --parallel dev",
        lint: "bun run --workspaces --if-present lint",
        test: "bun run --workspaces --if-present test",
        typecheck: "bun run --workspaces --if-present typecheck",
        verify: "bun run --workspaces --if-present verify",
      },
      workspaces: ["frontend", "backend", "packages/*"],
    });
    expect(readFileSync(join(project, "bunfig.toml"), "utf8")).toContain(
      "linkWorkspacePackages = true",
    );

    const lock = JSON.parse(
      readFileSync(join(project, ".project-scaffold.lock.json"), "utf8"),
    );
    expect(lock.resolution.pieceOrder).toEqual([
      "core.agents",
      "workspace.bun-monorepo",
    ]);
    expect(lock.assemblies["package.json"].contributions).toHaveLength(2);
    expect(lock.assemblies["package.json"].contributors).toBeUndefined();
    expect(
      lock.assemblies[".agents/shared/project.md"].contributions.map(
        (item: { key: string }) => item.key,
      ),
    ).toContain("workspace.bun-monorepo:project");
  });
});
