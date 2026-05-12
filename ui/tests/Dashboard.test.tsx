// Dashboard integration tests.
//
// Covers the slice integration logic that lives in Dashboard.tsx itself:
//   - loading state on mount
//   - fetch success → all category sections render
//   - fetch failure → error banner
//   - selection → ApplyBar appears with derived actions
//   - cancel clears selection (ApplyBar unmounts)
//   - empty StateReport (all arrays empty + workflow present) → no crash
//
// We use `vi.stubGlobal("fetch", ...)` so the component's real fetch call
// goes through a controllable double; no msw needed for this slice.

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import Dashboard from "../src/pages/Dashboard";
import type { StateReport } from "../../src/api-types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeReport(overrides: Partial<StateReport> = {}): StateReport {
  return {
    workflow: {
      status: "installed",
      currentVersion: "1.6.0",
      expectedVersion: "1.6.0",
    },
    skills: [
      {
        name: "test-driven-development",
        description: "TDD red/green workflow",
        status: "installed",
        isWorkflow: true,
        currentHash: "abc12345",
        expectedHash: "abc12345",
      },
      {
        name: "systematic-debugging",
        description: "Debug-root-cause-first protocol",
        status: "update-available",
        isWorkflow: true,
        currentHash: "old11111",
        expectedHash: "new22222",
      },
    ],
    recommendedSkills: [
      {
        name: "frontend-design",
        description: "Distinctive frontend interfaces",
        status: "not-installed",
        isWorkflow: false,
        expectedHash: "fed99999",
      },
    ],
    plugins: [
      {
        id: "auriga-go@auriga-cli",
        description: "Workflow autopilot",
        status: "installed",
        agent: "claude",
        currentVersion: "1.0.0",
        expectedVersion: "1.0.0",
        versionSource: "catalog",
      },
    ],
    hooks: [
      {
        name: "notify",
        description: "Desktop notifications",
        status: "not-installed",
        expectedHash: "h00kfeed",
      },
    ],
    warnings: [],
    ...overrides,
  };
}

function emptyReport(): StateReport {
  return makeReport({
    skills: [],
    recommendedSkills: [],
    plugins: [],
    hooks: [],
  });
}

// fetch-mock helpers — these mutate per-test via vi.stubGlobal so describe
// blocks can switch behavior without leaking across tests.

function stubFetch(impl: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve(impl(url, init)),
    ),
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Dashboard — mount + fetch lifecycle", () => {
  beforeEach(() => {
    // Make sure no token is read out of the URL/storage between tests.
    if (typeof window !== "undefined") {
      window.sessionStorage.clear();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("shows loading state immediately on mount", () => {
    // fetch never resolves in this test — we just assert the initial paint.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    render(<Dashboard />);
    expect(screen.getByTestId("dashboard-loading")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-loading").textContent).toMatch(
      /loading/i,
    );
  });

  test("fetch success renders all 5 category sections + their cards", async () => {
    stubFetch((url) => {
      if (url.includes("/api/state")) return jsonResponse(makeReport());
      return jsonResponse({ ok: true });
    });
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-root")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("section-workflow")).toBeInTheDocument();
    expect(screen.getByTestId("section-skills")).toBeInTheDocument();
    expect(
      screen.getByTestId("section-recommended-skills"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("section-plugins")).toBeInTheDocument();
    expect(screen.getByTestId("section-hooks")).toBeInTheDocument();

    // The fixture has 1 workflow + 2 skills + 1 rec + 1 plugin + 1 hook = 6 cards.
    expect(screen.getAllByTestId("statecard")).toHaveLength(6);
  });

  test("fetch failure (500) renders an error banner instead of categories", async () => {
    stubFetch(() => jsonResponse({ error: "scan-failed" }, 500));
    render(<Dashboard />);
    const banner = await screen.findByTestId("dashboard-error");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/failed to load/i);
    expect(screen.queryByTestId("dashboard-root")).toBeNull();
  });

  test("empty arrays (only workflow present) render without crashing", async () => {
    stubFetch(() => jsonResponse(emptyReport()));
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-root")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("section-workflow")).toBeInTheDocument();
    expect(screen.queryByTestId("section-skills")).toBeNull();
    expect(screen.queryByTestId("section-recommended-skills")).toBeNull();
    expect(screen.queryByTestId("section-plugins")).toBeNull();
    expect(screen.queryByTestId("section-hooks")).toBeNull();
  });
});

describe("Dashboard — selection drives ApplyBar", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.clear();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("no selection → ApplyBar is not rendered", async () => {
    stubFetch((url) =>
      url.includes("/api/state")
        ? jsonResponse(makeReport())
        : jsonResponse({ ok: true }),
    );
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-root")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("applybar")).toBeNull();
  });

  test("selecting an update-available item → ApplyBar shows action='update'", async () => {
    stubFetch((url) =>
      url.includes("/api/state")
        ? jsonResponse(makeReport())
        : jsonResponse({ ok: true }),
    );
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-root")).toBeInTheDocument(),
    );
    // The second skill in the fixture is update-available.
    const cards = screen.getAllByTestId("statecard");
    const updateCard = cards.find(
      (c) => c.getAttribute("data-status") === "update-available",
    );
    expect(updateCard).toBeDefined();

    const cb = updateCard!.querySelector(
      '[data-testid="statecard-checkbox"]',
    ) as HTMLInputElement;
    fireEvent.click(cb);

    const applyBar = await screen.findByTestId("applybar");
    expect(applyBar).toBeInTheDocument();
    expect(applyBar.getAttribute("data-pending-count")).toBe("1");
    // Summary text encodes derived action.
    expect(screen.getByTestId("applybar-summary").textContent).toMatch(
      /1 update/,
    );
  });

  test("selecting a not-installed item → derived action='install'", async () => {
    stubFetch((url) =>
      url.includes("/api/state")
        ? jsonResponse(makeReport())
        : jsonResponse({ ok: true }),
    );
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-root")).toBeInTheDocument(),
    );
    const cards = screen.getAllByTestId("statecard");
    const notInstalled = cards.find(
      (c) => c.getAttribute("data-status") === "not-installed",
    );
    expect(notInstalled).toBeDefined();

    const cb = notInstalled!.querySelector(
      '[data-testid="statecard-checkbox"]',
    ) as HTMLInputElement;
    fireEvent.click(cb);

    const summary = await screen.findByTestId("applybar-summary");
    expect(summary.textContent).toMatch(/1 install/);
  });

  test("selecting an installed item → derived action='uninstall'", async () => {
    stubFetch((url) =>
      url.includes("/api/state")
        ? jsonResponse(makeReport())
        : jsonResponse({ ok: true }),
    );
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-root")).toBeInTheDocument(),
    );
    const cards = screen.getAllByTestId("statecard");
    const installedCards = cards.filter(
      (c) => c.getAttribute("data-status") === "installed",
    );
    // Pick the first installed card (skill).
    const target = installedCards[0];
    expect(target).toBeDefined();
    const cb = target.querySelector(
      '[data-testid="statecard-checkbox"]',
    ) as HTMLInputElement;
    fireEvent.click(cb);

    const summary = await screen.findByTestId("applybar-summary");
    expect(summary.textContent).toMatch(/1 uninstall/);
  });

  test("Cancel clears all selections and unmounts ApplyBar", async () => {
    stubFetch((url) =>
      url.includes("/api/state")
        ? jsonResponse(makeReport())
        : jsonResponse({ ok: true }),
    );
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-root")).toBeInTheDocument(),
    );
    const cards = screen.getAllByTestId("statecard");
    fireEvent.click(
      cards[1].querySelector(
        '[data-testid="statecard-checkbox"]',
      ) as HTMLInputElement,
    );
    expect(await screen.findByTestId("applybar")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("applybar-cancel"));
    await waitFor(() =>
      expect(screen.queryByTestId("applybar")).toBeNull(),
    );
  });
});

describe("Dashboard — TopBar marketplace status", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.clear();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("renders 'online' when warnings has no marketplace-offline", async () => {
    stubFetch((url) =>
      url.includes("/api/state")
        ? jsonResponse(makeReport())
        : jsonResponse({ ok: true }),
    );
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-root")).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("topbar-marketplace").getAttribute("data-status"),
    ).toBe("online");
  });

  test("renders 'offline' when warnings includes marketplace-offline", async () => {
    stubFetch((url) =>
      url.includes("/api/state")
        ? jsonResponse(
            makeReport({
              warnings: [
                {
                  code: "marketplace-offline",
                  message: "Marketplace unreachable",
                },
              ],
            }),
          )
        : jsonResponse({ ok: true }),
    );
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-root")).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("topbar-marketplace").getAttribute("data-status"),
    ).toBe("offline");
  });
});

describe("Dashboard — apply submission", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.clear();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("clicking Apply POSTs the items batch and clears selection", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.includes("/api/state")) {
          return Promise.resolve(jsonResponse(makeReport()));
        }
        if (url.includes("/api/apply")) {
          return Promise.resolve(jsonResponse({ jobId: "test-job" }, 202));
        }
        return Promise.resolve(jsonResponse({ ok: true }));
      }),
    );

    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-root")).toBeInTheDocument(),
    );
    const cards = screen.getAllByTestId("statecard");
    const target = cards.find(
      (c) => c.getAttribute("data-status") === "update-available",
    )!;
    fireEvent.click(
      target.querySelector(
        '[data-testid="statecard-checkbox"]',
      ) as HTMLInputElement,
    );

    const applyBtn = await screen.findByTestId("applybar-apply");
    await act(async () => {
      fireEvent.click(applyBtn);
    });

    const applyCall = calls.find((c) => c.url.includes("/api/apply"));
    expect(applyCall).toBeDefined();
    expect(applyCall!.init?.method).toBe("POST");
    const body = JSON.parse(applyCall!.init!.body as string) as {
      items: Array<{ action: string }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].action).toBe("update");

    // After successful submission selection is cleared → ApplyBar unmounts.
    await waitFor(() =>
      expect(screen.queryByTestId("applybar")).toBeNull(),
    );
  });
});
