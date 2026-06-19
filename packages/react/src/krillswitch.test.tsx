import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

const { FeatureFlagProvider, useFeatureFlag, useFeatureFlags } =
  createKrillswitch({
    souls: false,
    theme: "light",
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

    const neverCalled = () => {
      // @ts-expect-error undeclared flag keys must not compile
      useFeatureFlag("soulz");
    };
    expect(neverCalled).toBeDefined();
  });
});
