import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanFlagRefs } from "../src/commands/refs";

let root = "";

beforeAll(async () => {
  // realpath: macOS tmpdir is a /var → /private/var symlink and relative()
  // math needs canonical paths.
  root = await realpath(await mkdtemp(join(tmpdir(), "ks-refs-")));
  await mkdir(join(root, "src"));
  await mkdir(join(root, "node_modules", "dep"), { recursive: true });
  await writeFile(
    join(root, "src", "app.ts"),
    'if (flags["souls"]) {\n  render();\n}\nconst theme = useFeatureFlag("theme");\n',
  );
  await writeFile(join(root, "src", "other.ts"), "// mentions souls twice: souls\n");
  await writeFile(
    join(root, "node_modules", "dep", "index.js"),
    '"souls" must not count — dependency code is not a reference\n',
  );
  await writeFile(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x00, 0x47]));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("scanFlagRefs", () => {
  it("finds references with file and line, skipping node_modules and binaries", async () => {
    const { scannedFiles, refs } = await scanFlagRefs(root, [
      "souls",
      "theme",
      "unused-flag",
    ]);
    expect(scannedFiles).toBe(2);
    const souls = refs.get("souls") ?? [];
    expect(souls).toHaveLength(2);
    expect(souls.map((r) => r.file).sort()).toEqual([
      join("src", "app.ts"),
      join("src", "other.ts"),
    ]);
    expect(souls.find((r) => r.file === join("src", "app.ts"))?.line).toBe(1);
    expect(refs.get("theme")).toHaveLength(1);
    expect(refs.get("unused-flag")).toEqual([]);
  });
});
