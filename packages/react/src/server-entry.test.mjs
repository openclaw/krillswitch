import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("loads a React-free evaluator under React server conditions", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      'import("@openclaw/krillswitch-react/server").then(({ createKrillswitchEvaluator }) => console.log(typeof createKrillswitchEvaluator({ souls: false })))',
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  expect(output.trim()).toBe("function");
});
