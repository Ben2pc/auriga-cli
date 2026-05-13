// Dashboard integration tests.
//
// Covers the slice integration logic that lives in Dashboard.tsx itself:
//   - loading state on mount
//   - fetch success → all category sections render
//   - fetch failure → error banner
//   - selection → LogPanel Apply button enables with correct pending count
//   - cancel clears selection (Apply button disables again)
//   - empty StateReport (all arrays empty + workflow present) → no crash
//   - submitApply POST carries the correct derived action per item status
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
    cwd: "~/Workspace/test-project",
    workflow: {
      status: "installed",
    },
    skills: [
      {
        name: "test-driven-development",
        description: "TDD red/green workflow",
        status: "installed",
        isWorkflow: true,
      },
      {
        name: "systematic-debugging",
        description: "Debug-root-cause-first protocol",
        status: "not-installed",
        isWorkflow: true,
      },
    ],
    recommendedSkills: [
      {
        name: "frontend-design",
        description: "Distinctive frontend interfaces",
        status: "not-installed",
        isWorkflow: false,
      },
    ],
    plugins: [
      {
        id: "auriga-go@auriga-cli",
        description: "Workflow autopilot",
        status: "installed",
        agents: ["claude"],
      },
      {
        // Dual-Agent plugin with Codex side missing; drives the
        // partial-install action-derivation test case below.
        id: "deep-review@auriga-cli",
        description: "Multi-dimensional PR review",
        status: "partial-install",
        agents: ["claude", "codex"],
        missingAgents: ["codex"],
      },
    ],
    hooks: [
      {
        name: "notify",
        description: "Desktop notifications",
        status: "not-installed",
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

    // The fixture has 1 workflow + 2 skills + 1 rec + 2 plugins + 1 hook = 7 cards.
    expect(screen.getAllByTestId("statecard")).toHaveLength(7);
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

describe("Dashboard — selection drives the LogPanel Apply button", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.clear();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("no selection → LogPanel apply button is disabled + empty-state hint", async () => {
    stubFetch((url) =>
      url.includes("/api/state")
        ? jsonResponse(makeReport())
        : jsonResponse({ ok: true }),
    );
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-root")).toBeInTheDocument(),
    );
    // LogPanel itself is always mounted (right rail), but the Apply button
    // is disabled and the body shows the empty hint when nothing is selected.
    expect(screen.getByTestId("log-panel")).toBeInTheDocument();
    expect(
      (screen.getByTestId("log-panel-apply") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByTestId("log-panel-pending-count")).toBeNull();
    expect(screen.getByTestId("log-panel-empty").textContent).toMatch(
      /select items/i,
    );
  });

  test("selecting an item → Apply button enables and shows pending count", async () => {
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
    // Pick any not-installed card — selecting it derives action="install"
    // and enables the Apply button. v1.19.0 dropped the update-available
    // path the original assertion used.
    const targetCard = cards.find(
      (c) => c.getAttribute("data-status") === "not-installed",
    );
    expect(targetCard).toBeDefined();

    const cb = targetCard!.querySelector(
      '[data-testid="statecard-checkbox"]',
    ) as HTMLInputElement;
    fireEvent.click(cb);

    const applyBtn = (await screen.findByTestId(
      "log-panel-apply",
    )) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);
    expect(applyBtn.textContent).toMatch(/APPLY \(1\)/);
    expect(screen.getByTestId("log-panel-pending-count").textContent).toMatch(
      /\(1\)/,
    );
  });

  test("Cancel clears all selections → Apply button disables again", async () => {
    stubFetch((url) =>
      url.includes("/api/state")
        ? jsonResponse(makeReport())
        : jsonResponse({ ok: true }),
    );
    // Cancel now confirms before clearing (deep-review UX blocker:
    // pre-apply Cancel was destroying batches with no confirm). Mock
    // window.confirm to auto-accept so this test still exercises the
    // clear-selection path.
    vi.spyOn(window, "confirm").mockReturnValue(true);

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
    await waitFor(() =>
      expect(
        (screen.getByTestId("log-panel-apply") as HTMLButtonElement).disabled,
      ).toBe(false),
    );

    fireEvent.click(screen.getByTestId("log-panel-cancel"));
    await waitFor(() =>
      expect(
        (screen.getByTestId("log-panel-apply") as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    expect(screen.queryByTestId("log-panel-pending-count")).toBeNull();
  });
});

describe("Dashboard — TopBar cwd label", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.clear();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("renders the cwd returned by /api/state in the top bar", async () => {
    stubFetch((url) =>
      url.includes("/api/state")
        ? jsonResponse(makeReport({ cwd: "~/Workspace/auriga-ui-demo" }))
        : jsonResponse({ ok: true }),
    );
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-root")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("topbar-cwd").textContent).toBe(
      "~/Workspace/auriga-ui-demo",
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

describe("Dashboard — apply submission carries derived action per status", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.clear();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  type DerivedCase = {
    label: string;
    status: "not-installed" | "installed" | "partial-install";
    expectedAction: "install" | "uninstall";
  };

  // Each card's status drives the action that Dashboard derives at selection
  // time. Verified at the network boundary (POST body) since the new LogPanel
  // doesn't surface the action verb in its DOM.
  const cases: DerivedCase[] = [
    {
      label: "not-installed → action='install'",
      status: "not-installed",
      expectedAction: "install",
    },
    {
      label: "installed → action='uninstall'",
      status: "installed",
      expectedAction: "uninstall",
    },
    {
      // Dual-Agent plugin half-installs derive "install" so a single Apply
      // backfills the missing agent. Apply path calls install on every
      // targeted agent; the already-installed side becomes a CLI no-op.
      label: "partial-install → action='install'",
      status: "partial-install",
      expectedAction: "install",
    },
  ];

  for (const c of cases) {
    test(c.label, async () => {
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
      // Uninstall batches now require a window.confirm before /api/apply
      // fires (deep-review UX blocker). Auto-accept so this test still
      // exercises the derived-action plumbing.
      vi.spyOn(window, "confirm").mockReturnValue(true);

      render(<Dashboard />);
      await waitFor(() =>
        expect(screen.getByTestId("dashboard-root")).toBeInTheDocument(),
      );
      const cards = screen.getAllByTestId("statecard");
      const target = cards.find(
        (card) => card.getAttribute("data-status") === c.status,
      );
      expect(target).toBeDefined();
      fireEvent.click(
        target!.querySelector(
          '[data-testid="statecard-checkbox"]',
        ) as HTMLInputElement,
      );

      const applyBtn = await screen.findByTestId("log-panel-apply");
      await act(async () => {
        fireEvent.click(applyBtn);
      });

      const applyCall = calls.find((call) => call.url.includes("/api/apply"));
      expect(applyCall).toBeDefined();
      expect(applyCall!.init?.method).toBe("POST");
      const body = JSON.parse(applyCall!.init!.body as string) as {
        items: Array<{ action: string }>;
      };
      expect(body.items).toHaveLength(1);
      expect(body.items[0].action).toBe(c.expectedAction);

      // Selection stays until the SSE all-done event arrives. EventSource is
      // not defined in jsdom, so openProgress is a no-op and selection
      // remains — that's the correct behavior, the SSE stream is the source
      // of truth for completion. Assert the UI entered the in-flight state.
      await waitFor(() =>
        expect(
          (screen.getByTestId("log-panel-apply") as HTMLButtonElement)
            .textContent,
        ).toMatch(/APPLYING/),
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Scope / lang re-derivation on already-selected items
// ---------------------------------------------------------------------------
//
// When a user toggles a card and THEN switches the column's scope / language
// picker, Dashboard must rewrite the scope/lang on already-selected items in
// that column so the apply payload matches what the UI now shows.
// Verified at the network boundary (POST body).

describe("Dashboard — changeScope re-derives already-selected items", () => {
  test("switching skill scope to 'project' updates pending skill items", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.includes("/api/state")) {
          return Promise.resolve(jsonResponse(makeReport()));
        }
        if (url.includes("/api/apply")) {
          return Promise.resolve(jsonResponse({ jobId: "x" }, 202));
        }
        return Promise.resolve(jsonResponse({ ok: true }));
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-root")).toBeInTheDocument(),
    );

    // Pick the first skill card (from the Skills section, not Workflow).
    const skillsSection = screen.getByTestId("section-skills");
    const skillCard = skillsSection.querySelector(
      '[data-testid="statecard"]',
    ) as HTMLElement;
    fireEvent.click(
      skillCard.querySelector(
        '[data-testid="statecard-checkbox"]',
      ) as HTMLInputElement,
    );

    // Change the skill column's scope dropdown to project.
    const skillScope = skillsSection.querySelector(
      "select",
    ) as HTMLSelectElement;
    expect(skillScope).toBeTruthy();
    fireEvent.change(skillScope, { target: { value: "project" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("log-panel-apply"));
    });

    const applyCall = calls.find((c) => c.url.includes("/api/apply"));
    expect(applyCall).toBeDefined();
    const body = JSON.parse(applyCall!.init!.body as string) as {
      items: Array<{ category: string; scope?: string }>;
    };
    const skillItem = body.items.find((i) => i.category === "skill");
    expect(skillItem).toBeDefined();
    expect(skillItem!.scope).toBe("project");
  });
});

describe("Dashboard — changeWorkflowLang re-derives already-selected workflow", () => {
  test("switching workflow lang to 'zh-CN' updates the pending workflow item", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.includes("/api/state")) {
          // Use not-installed so the action becomes "install" → carries
          // lang. (Workflow uninstall would skip the lang field.)
          return Promise.resolve(
            jsonResponse(
              makeReport({
                workflow: {
                  status: "not-installed",
                },
              }),
            ),
          );
        }
        if (url.includes("/api/apply")) {
          return Promise.resolve(jsonResponse({ jobId: "x" }, 202));
        }
        return Promise.resolve(jsonResponse({ ok: true }));
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-root")).toBeInTheDocument(),
    );

    // Toggle the workflow card. It's the singleton card under the
    // section-workflow container, named "CLAUDE.md workflow" — locate it
    // by aria-label via getByLabelText against the case-insensitive name.
    const workflowSection = screen.getByTestId("section-workflow");
    const workflowCard = workflowSection.querySelector(
      '[data-testid="statecard"]',
    ) as HTMLElement;
    expect(workflowCard).toBeTruthy();
    fireEvent.click(
      workflowCard.querySelector(
        '[data-testid="statecard-checkbox"]',
      ) as HTMLInputElement,
    );

    // Find the workflow column's lang dropdown. The selector is unique
    // to that column (`en` / `zh-CN` options).
    const dropdowns = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const langDropdown = dropdowns.find((s) =>
      Array.from(s.options).some((o) => o.value === "zh-CN"),
    );
    expect(langDropdown).toBeDefined();
    fireEvent.change(langDropdown!, { target: { value: "zh-CN" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("log-panel-apply"));
    });

    const applyCall = calls.find((c) => c.url.includes("/api/apply"));
    expect(applyCall).toBeDefined();
    const body = JSON.parse(applyCall!.init!.body as string) as {
      items: Array<{ category: string; lang?: string }>;
    };
    const wf = body.items.find((i) => i.category === "workflow");
    expect(wf).toBeDefined();
    expect(wf!.lang).toBe("zh-CN");
  });
});
