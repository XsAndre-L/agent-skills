import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const SKILL_ROOT = resolve(import.meta.dir, "..");
const SCAFFOLD = resolve(import.meta.dir, "scaffold.ts");
const ANGULAR_DEVELOPER_SOURCE = resolve(
  SKILL_ROOT,
  "assets",
  "pieces",
  "stack.angular",
  "emissions",
  "angular-developer",
);
const temporaryRoots: string[] = [];

function temporaryProject(label: string): string {
  const project = mkdtempSync(join(tmpdir(), `project-scaffold-skill-inventory-${label}-`));
  temporaryRoots.push(project);
  return project;
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

function skillDocument(name: string, body = "# Test skill", newline = "\n"): string {
  return [
    "---",
    `name: ${name}`,
    `description: Test fixture for ${name}.`,
    "---",
    "",
    body,
    "",
  ].join(newline);
}

function writeInstalledSkill(
  project: string,
  folder: string,
  name: string,
  body?: string,
  newline?: string,
): string {
  const destination = join(project, ".agents", "skills", folder);
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, "SKILL.md"), skillDocument(name, body, newline));
  return destination;
}

function fileSnapshot(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      if (entry.isFile()) {
        const relativePath = relative(root, path).replaceAll("\\", "/");
        snapshot[relativePath] = createHash("sha256").update(readFileSync(path)).digest("hex");
      }
    }
  };
  visit(root);
  return snapshot;
}

function planArgs(project: string, extras: string[] = []): string[] {
  return [
    "plan",
    "--root",
    project,
    "--profile",
    "angular-webquark",
    ...extras,
    "--json",
  ];
}

function emissionAction(output: string, name: string): string | undefined {
  return JSON.parse(output).emissions.find(
    (item: { name: string }) => item.name === name,
  )?.action;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("repository-local formal-skill inventory", () => {
  test("runs a repository-local master skill without inventorying nested SKILL.md files", () => {
    const project = temporaryProject("local-master");
    const installedMaster = join(project, ".agents", "skills", "project-scaffold");
    mkdirSync(resolve(project, ".agents", "skills"), { recursive: true });
    cpSync(SKILL_ROOT, installedMaster, { recursive: true });

    const unrelated = writeInstalledSkill(project, "unrelated", "unrelated");
    const nested = join(unrelated, "references", "nested");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "SKILL.md"), skillDocument("angular-developer"));

    const before = fileSnapshot(project);
    const installedScaffold = join(installedMaster, "scripts", "scaffold.ts");
    const first = run(installedScaffold, planArgs(project));
    const second = run(installedScaffold, planArgs(project));

    expect(first.exitCode, first.stderr).toBe(0);
    expect(second.exitCode, second.stderr).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    expect(fileSnapshot(project)).toEqual(before);
    expect(emissionAction(first.stdout, "angular-developer")).toBe("create");
    expect(emissionAction(first.stdout, "angular-new-app")).toBe("create");
    expect(JSON.parse(first.stdout).pieceOrder).toEqual([
      "core.agents",
      "workspace.bun-monorepo",
      "structure.frontend",
      "stack.webquark",
      "stack.angular",
    ]);
  });

  test("rejects genuine and case-variant sibling destinations without writing", () => {
    const exactProject = temporaryProject("exact-sibling");
    writeInstalledSkill(exactProject, "angular-developer", "angular-developer");
    const exactBefore = fileSnapshot(exactProject);
    const exact = run(SCAFFOLD, planArgs(exactProject));
    expect(exact.exitCode).not.toBe(0);
    expect(exact.stderr).toContain(
      "Formal-skill destination already exists under fail policy: .agents/skills/angular-developer",
    );
    expect(fileSnapshot(exactProject)).toEqual(exactBefore);

    const caseProject = temporaryProject("case-sibling");
    writeInstalledSkill(
      caseProject,
      "Angular-Developer",
      "angular-developer",
      "# Windows case fixture",
      "\r\n",
    );
    const caseBefore = fileSnapshot(caseProject);
    const caseVariant = run(SCAFFOLD, planArgs(caseProject));
    expect(caseVariant.exitCode).not.toBe(0);
    expect(caseVariant.stderr).toContain(
      "Formal-skill destination casing conflicts with .agents/skills/angular-developer: .agents/skills/Angular-Developer",
    );
    expect(fileSnapshot(caseProject)).toEqual(caseBefore);
  });

  test("preserves fail, adopt, replace, and migrate planning policies", () => {
    const adoptProject = temporaryProject("adopt");
    const adoptDestination = join(adoptProject, ".agents", "skills", "angular-developer");
    mkdirSync(resolve(adoptProject, ".agents", "skills"), { recursive: true });
    cpSync(ANGULAR_DEVELOPER_SOURCE, adoptDestination, { recursive: true });
    const adoptBefore = fileSnapshot(adoptProject);
    const adopt = run(
      SCAFFOLD,
      planArgs(adoptProject, ["--collision-policy", "adopt"]),
    );
    expect(adopt.exitCode, adopt.stderr).toBe(0);
    expect(emissionAction(adopt.stdout, "angular-developer")).toBe("adopt");
    expect(fileSnapshot(adoptProject)).toEqual(adoptBefore);

    const replaceProject = temporaryProject("replace");
    writeInstalledSkill(
      replaceProject,
      "angular-developer",
      "angular-developer",
      "# Existing replacement candidate",
    );
    const replaceBefore = fileSnapshot(replaceProject);
    const replace = run(
      SCAFFOLD,
      planArgs(replaceProject, ["--collision-policy", "replace"]),
    );
    expect(replace.exitCode, replace.stderr).toBe(0);
    expect(emissionAction(replace.stdout, "angular-developer")).toBe("replace");
    expect(fileSnapshot(replaceProject)).toEqual(replaceBefore);

    const fixtureRoot = temporaryProject("migration-source");
    const fixtureSkill = join(fixtureRoot, "project-scaffold");
    cpSync(SKILL_ROOT, fixtureSkill, { recursive: true });
    const angularManifestPath = join(
      fixtureSkill,
      "assets",
      "pieces",
      "stack.angular",
      "piece.json",
    );
    const angularManifest = JSON.parse(readFileSync(angularManifestPath, "utf8"));
    const angularEmission = angularManifest.emits.find(
      (item: { name: string }) => item.name === "angular-developer",
    );
    angularEmission.migrations = [
      {
        name: "from-legacy",
        from: ".agents/skills/legacy-angular-developer",
      },
    ];
    const angularNewAppEmission = angularManifest.emits.find(
      (item: { name: string }) => item.name === "angular-new-app",
    );
    angularNewAppEmission.migrations = [
      {
        name: "from-legacy",
        from: ".agents/skills/legacy-angular-new-app",
      },
    ];
    writeFileSync(angularManifestPath, `${JSON.stringify(angularManifest, null, 2)}\n`);

    const migrateProject = temporaryProject("migrate");
    writeInstalledSkill(
      migrateProject,
      "legacy-angular-developer",
      "angular-developer",
      "# Explicit migration source",
    );
    writeInstalledSkill(
      migrateProject,
      "legacy-angular-new-app",
      "angular-new-app",
      "# Explicit migration source",
    );
    const migrateBefore = fileSnapshot(migrateProject);
    const migrate = run(
      join(fixtureSkill, "scripts", "scaffold.ts"),
      planArgs(migrateProject, [
        "--collision-policy",
        "migrate",
        "--migration",
        "from-legacy",
      ]),
    );
    expect(migrate.exitCode, migrate.stderr).toBe(0);
    expect(emissionAction(migrate.stdout, "angular-developer")).toBe("migrate");
    expect(fileSnapshot(migrateProject)).toEqual(migrateBefore);
  });
});
