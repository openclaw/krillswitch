import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPublishedDistMatches,
  releaseVersionFromTag,
  tarballDigests,
} from "./sdk-release.mjs";

test("SDK tags map to lockstep package versions", () => {
  assert.equal(releaseVersionFromTag("sdk-v0.0.1"), "0.0.1");
  assert.throws(
    () => releaseVersionFromTag("v0.0.1"),
    /must match sdk-vX\.Y\.Z/,
  );
  assert.throws(
    () => releaseVersionFromTag("sdk-v0.0.1-beta.1"),
    /must match sdk-vX\.Y\.Z/,
  );
});

test("registry integrity must match the retained tarball", () => {
  const expected = tarballDigests(Buffer.from("exact artifact"));
  assert.doesNotThrow(() =>
    assertPublishedDistMatches(
      expected,
      { ...expected },
      "@openclaw/example",
      "1.0.0",
    ),
  );
  assert.throws(
    () =>
      assertPublishedDistMatches(
        expected,
        { ...expected, shasum: "different" },
        "@openclaw/example",
        "1.0.0",
      ),
    /registry shasum does not match/,
  );
});
