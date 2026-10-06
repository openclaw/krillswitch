import { createServer, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliError, KrillswitchClient } from "../src/client";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

  it.each([
    "1.5",
    "1.00000000000000001",
    "2147483648",
    "-1",
    "NaN",
    "Infinity",
    "nope",
    "1e3",
    "0x10",
  ])(
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

  it.each(["0", "1", "2147483647"])("accepts timeout boundary %s", (value) => {
    vi.stubEnv("KRILLSWITCH_TIMEOUT_MS", value);
    expect(
      () =>
        new KrillswitchClient({
          baseUrl: "https://example.com",
          token: "ksat_test",
        }),
    ).not.toThrow();
  });

  it.each([401, 403])(
    "preserves the %i error and cancels its stalled body with no deadline",
    async (status) => {
      let onBodyClosed: () => void = () => {};
      const bodyClosed = new Promise<void>((resolve) => {
        onBodyClosed = resolve;
      });
      await withServer(
        (response) => {
          response.on("close", onBodyClosed);
          response.writeHead(status);
          response.write("authentication failed");
        },
        async (baseUrl) => {
          await expect(
            new KrillswitchClient({ baseUrl, token: "ksat_test" }, 0).request(
              "/admin/projects",
            ),
          ).rejects.toThrow(status === 401 ? "unauthorized:" : "forbidden:");
          await bodyClosed;
        },
      );
    },
  );

  it.each([
    "success",
    "network error",
    "HTTP error",
    "invalid JSON",
    "timeout",
  ])("releases the deadline timer after %s", async (outcome) => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", async (_input: unknown, init: RequestInit) => {
      if (outcome === "network error") throw new TypeError("network down");
      if (outcome === "timeout") {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            {
              once: true,
            },
          );
        });
      }
      if (outcome === "HTTP error")
        return new Response("denied", { status: 401 });
      return new Response(outcome === "invalid JSON" ? "{" : '{"ok":true}');
    });
    const request = new KrillswitchClient({
      baseUrl: "https://example.com",
      token: "ksat_test",
    }).request("/admin/projects");
    const result =
      outcome === "success"
        ? expect(request).resolves.toEqual({ ok: true })
        : expect(request).rejects.toThrow();
    if (outcome === "timeout") {
      await vi.advanceTimersByTimeAsync(29_999);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
    }
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

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
