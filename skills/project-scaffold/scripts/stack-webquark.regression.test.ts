import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const SCAFFOLD = resolve(import.meta.dir, "scaffold.ts");
const VALIDATE = resolve(import.meta.dir, "validate.ts");
const temporaryRoots: string[] = [];

function temporaryProject(label: string): string {
  const parent = mkdtempSync(join(tmpdir(), `project-scaffold-webquark-${label}-`));
  temporaryRoots.push(parent);
  return join(parent, "project");
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

function profileArgs(project: string, enabled: boolean): string[] {
  const args = ["--root", project, "--profile", "angular-webquark"];
  if (!enabled) args.push("--param", "webquark.integrationEnabled=false");
  return [...args, "--json"];
}

function relativeFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  visit(root);
  return files.sort();
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("stack.webquark scaffold regression", () => {
  test("agents-minimal plans without resolving optional frontend assemblies", () => {
    const project = temporaryProject("minimal");
    const result = run(SCAFFOLD, [
      "plan",
      "--root",
      project,
      "--profile",
      "agents-minimal",
      "--json",
    ]);

    expect(result.exitCode, result.stderr).toBe(0);
    const plan = JSON.parse(result.stdout);
    expect(plan.pieceOrder).toEqual(["core.agents"]);
    expect(plan.files.every((file: { path: string }) => !/^(?:frontend|backend)\//.test(file.path))).toBe(true);
    expect(existsSync(project)).toBe(false);
  });

  test("renders and validates the inactive shared styling seam", () => {
    const project = temporaryProject("inactive");
    const plan = run(SCAFFOLD, ["plan", ...profileArgs(project, false)]);
    expect(plan.exitCode, plan.stderr).toBe(0);
    expect(existsSync(project)).toBe(false);

    const apply = run(SCAFFOLD, ["apply", ...profileArgs(project, false)]);
    expect(apply.exitCode, apply.stderr).toBe(0);

    const foundationRoot = join(project, "frontend", "libs", "shared", "ui-foundation");
    expect(relativeFiles(foundationRoot)).toEqual([
      "README.md",
      "styles/foundation.css",
      "styles/webquark-theme.css",
    ]);
    expect(readFileSync(join(foundationRoot, "styles", "foundation.css"), "utf8")).toBe(
      '@import "@webquark/core/dist/webquark/webquark.css";\n@import "./webquark-theme.css";\n',
    );
    expect(readFileSync(join(foundationRoot, "styles", "webquark-theme.css"), "utf8")).toBe(
      "/* Add application-wide --q-* WebQuark token overrides here. */\n",
    );
    expect(existsSync(join(foundationRoot, "src", "setup-webquark.ts"))).toBe(false);
    expect(existsSync(join(project, "backend"))).toBe(false);

    const frontendPackage = JSON.parse(readFileSync(join(project, "frontend", "package.json"), "utf8"));
    expect(frontendPackage.dependencies["@webquark/core"]).toBeUndefined();
    expect(readFileSync(join(project, "frontend", "apps", "app", "src", "main.ts"), "utf8")).not.toContain(
      "setupWebQuark",
    );
    expect(readFileSync(join(project, "frontend", "apps", "app", "src", "styles.css"), "utf8")).not.toContain(
      "ui-foundation",
    );

    const lock = JSON.parse(readFileSync(join(project, ".project-scaffold.lock.json"), "utf8"));
    expect(lock.files["frontend/libs/shared/ui-foundation/README.md"].piece).toBe("stack.webquark");
    expect(lock.files["frontend/libs/shared/ui-foundation/styles/foundation.css"].renderedSha256).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    expect(
      lock.assemblies["frontend/package.json"].contributions.some(
        (item: { key: string }) => item.key === "stack.webquark:core-dependency",
      ),
    ).toBe(false);

    const validation = run(VALIDATE, ["--root", project, "--json"]);
    expect(validation.exitCode, validation.stderr).toBe(0);
  });

  test("renders exact active integration and reapplies idempotently", () => {
    const project = temporaryProject("active");
    const apply = run(SCAFFOLD, ["apply", ...profileArgs(project, true)]);
    expect(apply.exitCode, apply.stderr).toBe(0);

    const foundationRoot = join(project, "frontend", "libs", "shared", "ui-foundation");
    expect(relativeFiles(foundationRoot)).toEqual([
      "README.md",
      "src/setup-webquark.ts",
      "styles/foundation.css",
      "styles/webquark-theme.css",
    ]);
    const frontendPackage = JSON.parse(readFileSync(join(project, "frontend", "package.json"), "utf8"));
    expect(frontendPackage.dependencies["@webquark/core"]).toBe("1.0.2");

    const main = readFileSync(join(project, "frontend", "apps", "app", "src", "main.ts"), "utf8");
    expect(main).toContain("setupWebQuark");
    expect(main.indexOf("await setupWebQuark();")).toBeLessThan(main.indexOf("bootstrapApplication("));
    const styles = readFileSync(join(project, "frontend", "apps", "app", "src", "styles.css"), "utf8");
    expect(styles.split("\n")[0]).toBe(
      '@import "../../../libs/shared/ui-foundation/styles/foundation.css";',
    );
    const app = readFileSync(join(project, "frontend", "apps", "app", "src", "app", "app.ts"), "utf8");
    expect(app).toContain("CUSTOM_ELEMENTS_SCHEMA");
    expect(app).toContain("schemas: [CUSTOM_ELEMENTS_SCHEMA]");

    const lockPath = join(project, ".project-scaffold.lock.json");
    const firstLock = readFileSync(lockPath);
    const lock = JSON.parse(firstLock.toString("utf8"));
    expect(lock.resolution.pieceOrder).toEqual([
      "core.agents",
      "workspace.bun-monorepo",
      "structure.frontend",
      "stack.webquark",
      "stack.angular",
    ]);
    expect(lock.files["frontend/libs/shared/ui-foundation/src/setup-webquark.ts"].piece).toBe(
      "stack.webquark",
    );
    expect(
      lock.assemblies["frontend/package.json"].contributions.map(
        (item: { key: string }) => item.key,
      ),
    ).toContain("stack.webquark:core-dependency");

    const secondApply = run(SCAFFOLD, ["apply", ...profileArgs(project, true)]);
    expect(secondApply.exitCode, secondApply.stderr).toBe(0);
    expect(
      JSON.parse(secondApply.stdout).files.every(
        (file: { status: string }) => file.status === "unchanged",
      ),
    ).toBe(true);
    const secondLock = readFileSync(lockPath);
    expect(JSON.parse(secondLock.toString("utf8")).files).toEqual(
      JSON.parse(firstLock.toString("utf8")).files,
    );
    const thirdApply = run(SCAFFOLD, ["apply", ...profileArgs(project, true)]);
    expect(thirdApply.exitCode, thirdApply.stderr).toBe(0);
    expect(readFileSync(lockPath)).toEqual(secondLock);

    const validation = run(VALIDATE, ["--root", project, "--json"]);
    expect(validation.exitCode, validation.stderr).toBe(0);
    expect(JSON.parse(validation.stdout).counts.modified).toBe(0);
  });

  test("rejects floating versions and preserves the target on collision", () => {
    const invalidProject = temporaryProject("floating");
    const invalid = run(SCAFFOLD, [
      "plan",
      ...profileArgs(invalidProject, true).slice(0, -1),
      "--param",
      'webquark.coreVersion="^1.0.2"',
      "--json",
    ]);
    expect(invalid.exitCode).not.toBe(0);
    expect(invalid.stderr).toContain("webquark.coreVersion");
    expect(existsSync(invalidProject)).toBe(false);

    const project = temporaryProject("collision");
    expect(run(SCAFFOLD, ["apply", ...profileArgs(project, true)]).exitCode).toBe(0);
    const themePath = join(
      project,
      "frontend",
      "libs",
      "shared",
      "ui-foundation",
      "styles",
      "webquark-theme.css",
    );
    const lockPath = join(project, ".project-scaffold.lock.json");
    const mainPath = join(project, "frontend", "apps", "app", "src", "main.ts");
    const lockBefore = readFileSync(lockPath);
    const mainBefore = readFileSync(mainPath);
    appendFileSync(themePath, "/* user change */\n");
    const themeBefore = readFileSync(themePath);

    const apply = run(SCAFFOLD, ["apply", ...profileArgs(project, true)]);
    expect(apply.exitCode).not.toBe(0);
    expect(apply.stderr).toContain(
      "Owned output has unmanaged changes: frontend/libs/shared/ui-foundation/styles/webquark-theme.css",
    );
    expect(readFileSync(themePath)).toEqual(themeBefore);
    expect(readFileSync(mainPath)).toEqual(mainBefore);
    expect(readFileSync(lockPath)).toEqual(lockBefore);
  });
});
