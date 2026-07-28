import type { FlagValue } from "@openclaw/krillswitch-core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { startTransition, useState } from "react";
import { renderToString } from "react-dom/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";
import {
  ANONYMOUS_KEY_STORAGE_KEY,
  createKrillswitch,
  flagValuesStorageKey,
} from "./index";
import { createKrillswitchEvaluator } from "./server";

const { evaluateFlags, FeatureFlagProvider, useFeatureFlag, useFeatureFlags } =
  createKrillswitch({
    souls: false,
    theme: "light",
  });
const serverEvaluator = createKrillswitchEvaluator({
  searchTuning: { semantic: true },
});
const jsonClient = createKrillswitch({
  searchTuning: { semantic: true },
});

const EVAL_KEY = "ks_clawhub_development_local";
const BASE_URL = "https://krillswitch.test";
const CACHED_CONTEXT_KEY = "cached-user";
const VALUES_STORAGE_KEY = flagValuesStorageKey(
  EVAL_KEY,
  CACHED_CONTEXT_KEY,
  "null",
);

function SoulsProbe() {
  const souls = useFeatureFlag("souls");
  const all = useFeatureFlags();
  return (
    <div>
      <output data-testid="souls">{String(souls)}</output>
      <output data-testid="theme">{all.theme}</output>
    </div>
  );
}

function renderDemo(props: { contextKey?: string } = {}) {
  return render(
    <FeatureFlagProvider evalKey={EVAL_KEY} baseUrl={BASE_URL} {...props}>
      <SoulsProbe />
    </FeatureFlagProvider>,
  );
}

function renderCachedDemo() {
  return renderDemo({ contextKey: CACHED_CONTEXT_KEY });
}

function evalResponse(flags: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      flags: Object.fromEntries(
        Object.entries(flags).map(([key, value]) => [
          key,
          { value, variationId: `var_${key}`, reason: { kind: "default" } },
        ]),
      ),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("server evaluation", () => {
  it("posts an explicit context and returns manifest-safe values", async () => {
    fetchMock.mockResolvedValue(
      evalResponse({
        souls: true,
        theme: 42,
        undeclared: "ignored",
      }),
    );

    const values = await evaluateFlags({
      evalKey: EVAL_KEY,
      baseUrl: `${BASE_URL}/`,
      context: {
        key: "cookie-user-123",
        attributes: { plan: "pro", staff: true },
      },
    });

    expect(values).toEqual({ souls: true, theme: "light" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE_URL}/v1/eval`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${EVAL_KEY}`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      context: {
        key: "cookie-user-123",
        attributes: { plan: "pro", staff: true },
      },
    });
  });

  it("preserves transport failures for the server caller", async () => {
    fetchMock.mockResolvedValue(new Response("unavailable", { status: 503 }));

    await expect(
      evaluateFlags({
        evalKey: EVAL_KEY,
        baseUrl: BASE_URL,
        context: { key: "cookie-user-123" },
      }),
    ).rejects.toThrow("503");
  });

  it("rejects malformed evaluation responses", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ flags: { souls: true } }), { status: 200 }),
    );

    await expect(
      evaluateFlags({
        evalKey: EVAL_KEY,
        baseUrl: BASE_URL,
        context: { key: "cookie-user-123" },
      }),
    ).rejects.toThrow("invalid flag");
  });

  it("forwards cancellation to the evaluation request", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("SSR budget elapsed", "TimeoutError"));
    fetchMock.mockRejectedValue(controller.signal.reason);

    await expect(
      evaluateFlags({
        evalKey: EVAL_KEY,
        baseUrl: BASE_URL,
        context: { key: "cookie-user-123" },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.signal).toBe(controller.signal);
  });

  it("accepts a different JSON shape for a JSON-kind flag", async () => {
    fetchMock.mockResolvedValue(evalResponse({ searchTuning: "disabled" }));

    await expect(
      serverEvaluator({
        evalKey: EVAL_KEY,
        baseUrl: BASE_URL,
        context: { key: "cookie-user-123" },
      }),
    ).resolves.toEqual({ searchTuning: "disabled" });
  });
});

describe("bootstrap render", () => {
  it("renders manifest defaults immediately on a cold profile", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderDemo();
    expect(screen.getByTestId("souls").textContent).toBe("false");
    expect(screen.getByTestId("theme").textContent).toBe("light");
  });

  it("renders last-known localStorage values on first paint", () => {
    window.localStorage.setItem(
      VALUES_STORAGE_KEY,
      JSON.stringify({ souls: true, theme: "dark" }),
    );
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderCachedDemo();
    expect(screen.getByTestId("souls").textContent).toBe("true");
    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  it("ignores cached values whose type no longer matches the manifest", () => {
    window.localStorage.setItem(
      VALUES_STORAGE_KEY,
      JSON.stringify({ souls: "yes", theme: 3 }),
    );
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderCachedDemo();
    expect(screen.getByTestId("souls").textContent).toBe("false");
    expect(screen.getByTestId("theme").textContent).toBe("light");
  });

  it("keeps bootstrap values through hydration while refresh is pending", async () => {
    window.localStorage.setItem(
      VALUES_STORAGE_KEY,
      JSON.stringify({ souls: false, theme: "cached" }),
    );
    fetchMock.mockReturnValue(new Promise(() => {}));
    const tree = (
      <FeatureFlagProvider
        evalKey={EVAL_KEY}
        baseUrl={BASE_URL}
        contextKey={CACHED_CONTEXT_KEY}
        initialValues={{ souls: true, theme: "bootstrapped" }}
      >
        <SoulsProbe />
      </FeatureFlagProvider>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.appendChild(container);

    expect(container.querySelector('[data-testid="souls"]')?.textContent).toBe(
      "true",
    );
    render(tree, { container, hydrate: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(container.querySelector('[data-testid="souls"]')?.textContent).toBe(
      "true",
    );
    expect(container.querySelector('[data-testid="theme"]')?.textContent).toBe(
      "bootstrapped",
    );
  });

  it("merges partial bootstrap with defaults instead of browser cache", () => {
    window.localStorage.setItem(
      VALUES_STORAGE_KEY,
      JSON.stringify({ souls: true, theme: "cached" }),
    );
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(
      <FeatureFlagProvider
        evalKey={EVAL_KEY}
        baseUrl={BASE_URL}
        contextKey={CACHED_CONTEXT_KEY}
        initialValues={{ theme: "bootstrapped" }}
      >
        <SoulsProbe />
      </FeatureFlagProvider>,
    );

    expect(screen.getByTestId("souls").textContent).toBe("false");
    expect(screen.getByTestId("theme").textContent).toBe("bootstrapped");
  });

  it("keeps explicit SSR fallback defaults through hydration", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const tree = (
      <FeatureFlagProvider
        evalKey={EVAL_KEY}
        baseUrl={BASE_URL}
        contextKey={CACHED_CONTEXT_KEY}
        initialValues={null}
      >
        <SoulsProbe />
      </FeatureFlagProvider>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    window.localStorage.setItem(
      VALUES_STORAGE_KEY,
      JSON.stringify({ souls: true, theme: "cached" }),
    );
    document.body.appendChild(container);

    render(tree, { container, hydrate: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(container.querySelector('[data-testid="souls"]')?.textContent).toBe(
      "false",
    );
    expect(container.querySelector('[data-testid="theme"]')?.textContent).toBe(
      "light",
    );
  });
});

describe("fetch lifecycle", () => {
  it("updates values in place and persists them when the fetch settles", async () => {
    fetchMock.mockResolvedValue(evalResponse({ souls: true, theme: "dark" }));
    renderCachedDemo();
    expect(screen.getByTestId("souls").textContent).toBe("false");
    await waitFor(() => {
      expect(screen.getByTestId("souls").textContent).toBe("true");
    });
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(
      JSON.parse(window.localStorage.getItem(VALUES_STORAGE_KEY) ?? "{}"),
    ).toEqual({ souls: true, theme: "dark" });
  });

  it("refreshes and persists values after starting from server bootstrap", async () => {
    fetchMock.mockResolvedValue(evalResponse({ souls: false, theme: "fresh" }));
    render(
      <FeatureFlagProvider
        evalKey={EVAL_KEY}
        baseUrl={BASE_URL}
        contextKey={CACHED_CONTEXT_KEY}
        initialValues={{ souls: true, theme: "bootstrapped" }}
      >
        <SoulsProbe />
      </FeatureFlagProvider>,
    );

    expect(screen.getByTestId("souls").textContent).toBe("true");
    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("fresh");
    });
    expect(
      JSON.parse(window.localStorage.getItem(VALUES_STORAGE_KEY) ?? "{}"),
    ).toEqual({ souls: false, theme: "fresh" });
  });

  it("keeps server bootstrap when the first refresh fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    render(
      <FeatureFlagProvider
        evalKey={EVAL_KEY}
        baseUrl={BASE_URL}
        contextKey={CACHED_CONTEXT_KEY}
        initialValues={{ souls: true, theme: "bootstrapped" }}
      >
        <SoulsProbe />
      </FeatureFlagProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(screen.getByTestId("souls").textContent).toBe("true");
    expect(screen.getByTestId("theme").textContent).toBe("bootstrapped");
  });

  it("keeps last-known values when the service is unreachable", async () => {
    window.localStorage.setItem(
      VALUES_STORAGE_KEY,
      JSON.stringify({ souls: true }),
    );
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    renderCachedDemo();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByTestId("souls").textContent).toBe("true");
  });

  it("keeps manifest defaults when cold and the service is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    renderCachedDemo();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByTestId("souls").textContent).toBe("false");
  });
});

describe("identity", () => {
  it("generates a persisted anonymous context key and sends it", async () => {
    fetchMock.mockResolvedValue(evalResponse({ souls: true }));
    renderDemo();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const anonymousKey = window.localStorage.getItem(ANONYMOUS_KEY_STORAGE_KEY);
    expect(anonymousKey).toBeTruthy();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body.context.key).toBe(anonymousKey);
  });

  it("keeps an anonymous key stable when storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    fetchMock.mockResolvedValue(evalResponse({ souls: true }));

    renderDemo();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reuses the same anonymous key across mounts", async () => {
    fetchMock.mockResolvedValue(evalResponse({ souls: true }));
    const first = renderDemo();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const anonymousKey = window.localStorage.getItem(ANONYMOUS_KEY_STORAGE_KEY);
    first.unmount();

    renderDemo();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(window.localStorage.getItem(ANONYMOUS_KEY_STORAGE_KEY)).toBe(
      anonymousKey,
    );
  });

  it("generates distinct anonymous keys for distinct profiles", async () => {
    fetchMock.mockResolvedValue(evalResponse({ souls: true }));
    renderDemo();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const firstProfileKey = window.localStorage.getItem(
      ANONYMOUS_KEY_STORAGE_KEY,
    );

    window.localStorage.clear();
    renderDemo();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const secondProfileKey = window.localStorage.getItem(
      ANONYMOUS_KEY_STORAGE_KEY,
    );
    expect(secondProfileKey).toBeTruthy();
    expect(secondProfileKey).not.toBe(firstProfileKey);
  });

  it("uses the provided context key instead of the anonymous one", async () => {
    fetchMock.mockResolvedValue(evalResponse({ souls: true }));
    renderDemo({ contextKey: "github-123" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body.context.key).toBe("github-123");
  });
});

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("freshness", () => {
  it("refetches when the tab becomes visible and applies new values", async () => {
    fetchMock.mockResolvedValueOnce(evalResponse({ souls: false }));
    renderDemo();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    fetchMock.mockResolvedValueOnce(evalResponse({ souls: true }));
    setVisibility("visible");
    await waitFor(() => {
      expect(screen.getByTestId("souls").textContent).toBe("true");
    });
  });

  it("does not refetch when the tab becomes hidden", async () => {
    fetchMock.mockResolvedValue(evalResponse({ souls: false }));
    renderDemo();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    setVisibility("hidden");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalledOnce();
    setVisibility("visible");
  });

  it("polls on the configured interval and applies new values", async () => {
    fetchMock.mockResolvedValueOnce(evalResponse({ souls: false }));
    fetchMock.mockResolvedValue(evalResponse({ souls: true }));
    render(
      <FeatureFlagProvider
        evalKey={EVAL_KEY}
        baseUrl={BASE_URL}
        pollIntervalMs={40}
      >
        <SoulsProbe />
      </FeatureFlagProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    // A short interval converges quickly — the interval is a real option.
    await waitFor(() => {
      expect(screen.getByTestId("souls").textContent).toBe("true");
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("sends If-None-Match and leaves state untouched on 304", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          flags: {
            souls: {
              value: true,
              variationId: "var_souls_on",
              reason: { kind: "default" },
            },
          },
        }),
        { status: 200, headers: { etag: 'W/"abc123"' } },
      ),
    );
    renderCachedDemo();
    await waitFor(() => {
      expect(screen.getByTestId("souls").textContent).toBe("true");
    });
    const persisted = window.localStorage.getItem(VALUES_STORAGE_KEY);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    setVisibility("visible");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [, init] = fetchMock.mock.calls[1] ?? [];
    expect(new Headers(init?.headers).get("if-none-match")).toBe('W/"abc123"');
    expect(screen.getByTestId("souls").textContent).toBe("true");
    expect(window.localStorage.getItem(VALUES_STORAGE_KEY)).toBe(persisted);
  });

  it("does not render one context's values while another context loads", async () => {
    fetchMock.mockResolvedValueOnce(evalResponse({ souls: true }));
    const view = renderDemo({ contextKey: "user-a" });
    await waitFor(() => {
      expect(screen.getByTestId("souls").textContent).toBe("true");
    });

    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    view.rerender(
      <FeatureFlagProvider
        evalKey={EVAL_KEY}
        baseUrl={BASE_URL}
        contextKey="user-b"
      >
        <SoulsProbe />
      </FeatureFlagProvider>,
    );
    expect(screen.getByTestId("souls").textContent).toBe("false");
  });

  it("does not reuse server bootstrap after the context changes", () => {
    window.localStorage.setItem(
      flagValuesStorageKey(EVAL_KEY, "user-b", "null"),
      JSON.stringify({ souls: false, theme: "user-b-cache" }),
    );
    fetchMock.mockReturnValue(new Promise(() => {}));
    const view = render(
      <FeatureFlagProvider
        evalKey={EVAL_KEY}
        baseUrl={BASE_URL}
        contextKey="user-a"
        initialValues={{ souls: true, theme: "bootstrapped" }}
      >
        <SoulsProbe />
      </FeatureFlagProvider>,
    );
    expect(screen.getByTestId("souls").textContent).toBe("true");

    view.rerender(
      <FeatureFlagProvider
        evalKey={EVAL_KEY}
        baseUrl={BASE_URL}
        contextKey="user-b"
        initialValues={{ souls: true, theme: "bootstrapped" }}
      >
        <SoulsProbe />
      </FeatureFlagProvider>,
    );
    expect(screen.getByTestId("souls").textContent).toBe("false");
    expect(screen.getByTestId("theme").textContent).toBe("user-b-cache");
  });

  it("keeps bootstrap after an interrupted scope render", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const suspended = new Promise<void>(() => {});
    let move: (() => void) | undefined;
    let bump: (() => void) | undefined;

    function SuspendedProbe({ contextKey }: { contextKey: string }) {
      const souls = useFeatureFlag("souls");
      if (contextKey === "user-b") {
        throw suspended;
      }
      return <output data-testid="concurrent-souls">{String(souls)}</output>;
    }

    function ConcurrentDemo() {
      const [contextKey, setContextKey] = useState("user-a");
      const [, setTick] = useState(0);
      move = () => startTransition(() => setContextKey("user-b"));
      bump = () => setTick((value) => value + 1);
      return (
        <FeatureFlagProvider
          evalKey={EVAL_KEY}
          baseUrl={BASE_URL}
          contextKey={contextKey}
          initialValues={{ souls: true, theme: "bootstrapped" }}
        >
          <SuspendedProbe contextKey={contextKey} />
        </FeatureFlagProvider>
      );
    }

    render(<ConcurrentDemo />);
    expect(screen.getByTestId("concurrent-souls").textContent).toBe("true");
    await act(async () => move?.());
    expect(screen.getByTestId("concurrent-souls").textContent).toBe("true");
    await act(async () => bump?.());
    expect(screen.getByTestId("concurrent-souls").textContent).toBe("true");
  });

  it("replaces a stalled refresh when a new one is requested", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    fetchMock.mockResolvedValueOnce(evalResponse({ souls: false }));

    renderDemo({ contextKey: "serialized-user" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    setVisibility("visible");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    resolveFirst?.(evalResponse({ souls: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("souls").textContent).toBe("false");
  });
});

describe("manifest typing", () => {
  it("infers hook types from the manifest", () => {
    expectTypeOf(useFeatureFlag)
      .parameter(0)
      .toEqualTypeOf<"souls" | "theme">();
    expectTypeOf(useFeatureFlag<"souls">).returns.toEqualTypeOf<boolean>();
    expectTypeOf(useFeatureFlag<"theme">).returns.toEqualTypeOf<string>();
    expectTypeOf(useFeatureFlags).returns.toEqualTypeOf<{
      souls: boolean;
      theme: string;
    }>();
    expectTypeOf(evaluateFlags).returns.resolves.toEqualTypeOf<{
      souls: boolean;
      theme: string;
    }>();
    expectTypeOf(serverEvaluator).returns.resolves.toEqualTypeOf<{
      searchTuning: FlagValue;
    }>();
    expectTypeOf(
      jsonClient.useFeatureFlag<"searchTuning">,
    ).returns.toEqualTypeOf<FlagValue>();

    const neverCalled = () => {
      // @ts-expect-error undeclared flag keys must not compile
      useFeatureFlag("soulz");
    };
    expect(neverCalled).toBeDefined();
  });
});
