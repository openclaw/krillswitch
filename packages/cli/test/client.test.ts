import { createServer, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliError, KrillswitchClient } from "../src/client";

afterEach(() => vi.unstubAllEnvs());

async function withServer(
  respond: (response: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer((_request, response) => respond(response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("API request deadlines", () => {
  it.each([200, 500])(
    "reports a timeout while reading a %i body",
    async (status) => {
      await withServer(
        (response) => {
          response.writeHead(status, { "content-type": "application/json" });
          response.write('{"message":');
        },
        async (baseUrl) => {
          await expect(
            new KrillswitchClient({ baseUrl, token: "ksat_test" }, 100).request(
              "/admin/projects",
            ),
          ).rejects.toThrow(
            new CliError(`request to ${baseUrl} timed out after 100ms`),
          );
        },
      );
    },
  );

  it.each(["1.5", "2147483648", "-1", "NaN", "Infinity", "nope"])(
    "rejects invalid timeout configuration %s before making a request",
    (value) => {
      vi.stubEnv("KRILLSWITCH_TIMEOUT_MS", value);
      expect(
        () =>
          new KrillswitchClient({
            baseUrl: "https://example.com",
            token: "ksat_test",
          }),
      ).toThrow(
        "KRILLSWITCH_TIMEOUT_MS must be an integer between 0 and 2147483647",
      );
    },
  );

  it("allows operators to disable the deadline with zero", async () => {
    vi.stubEnv("KRILLSWITCH_TIMEOUT_MS", "0");
    await withServer(
      (response) => response.end('{"ok":true}'),
      async (baseUrl) => {
        await expect(
          new KrillswitchClient({ baseUrl, token: "ksat_test" }).request(
            "/admin/projects",
          ),
        ).resolves.toEqual({ ok: true });
      },
    );
  });
});
