// Dashboard — top-level page. Composes Layout + TopBar + 4 category
// columns of StateCards + a right-rail OUTPUT column (LogPanel) that
// hosts the SSE log buffer and the Apply/Cancel actions.
//
// Spec mapping:
//   - Layout/composition: docs/architecture/web-ui.md §12 "页面布局"
//   - Category order:     §12.2 (Workflow → Skills → Recommended Skills →
//                         Plugins). The spec lists Plugins (Claude)
//                         and Plugins (Codex) as separate sub-headers, but
//                         StateReport carries them in one `plugins[]` array
//                         distinguished by `plugin.agent`. We group inline.
//   - Visual encoding:    §13 (status → StateCard, no chip chrome, single
//                         clay accent on the LogPanel footer border).
//
// Default action derivation (when a card is selected):
//
//   status="installed"     → action="uninstall"
//   status="not-installed" → action="install"
//   status="partial-install" → action="install" (backfill missing side)
//
// Rationale: the most likely user intent given the current state. Toggling
// the action between install/uninstall on an already-installed item is a
// post-M3 affordance (the design has room for a secondary action menu).
// v1.19.0 dropped the "update" action — re-running install is the update
// path for every category.
//
// Selection key shape: "<category>:<name>". `category` matches
// ApplyCategory exactly so we can derive ApplyItemRef without a lookup map.
// `name` is the per-category identifier (workflow→"workflow", skill→skill
// name, plugin→plugin.id).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import Layout from "../components/Layout.js";
import LogPanel from "../components/LogPanel.js";
import type { LogLine } from "../components/LogPanel.js";
import StateCard from "../components/StateCard.js";
import type { CardStatus } from "../components/StateCard.js";
import TopBar from "../components/TopBar.js";
import type { MarketplaceStatus } from "../components/TopBar.js";
import { fetchState, openProgress, ping, submitApply } from "../lib/api.js";
import type {
  ApplyAction,
  ApplyCategory,
  ApplyItemRef,
  ApplyPresetAgent,
  ItemStatus,
  PluginState,
  ProgressEvent as ApiProgressEvent,
  SkillState,
  StateReport,
  WorkflowState,
} from "../../../src/api-types.js";

const PING_INTERVAL_MS = 5000;

function toCardStatus(status: ItemStatus): CardStatus {
  return status;
}

// Selecting an already-installed row defaults to **re-install** (action =
// "install"). Re-install is the v1.19.0 update path — installers are
// idempotent and overwriting, so a fresh `install` on an installed row
// pulls latest upstream and refreshes contents. The user explicitly opts
// into uninstall via the output-bar mode toggle. Not-installed rows
// always queue install (no meaningful uninstall action for an absent
// item, regardless of mode).
function deriveAction(status: ItemStatus, mode: ApplyAction): ApplyAction {
  if (status === "not-installed") return "install";
  return mode === "uninstall" ? "uninstall" : "install";
}

function makeKey(category: ApplyCategory, name: string): string {
  return `${category}:${name}`;
}

// ---------------------------------------------------------------------------
// Section: small presentational helper for category headers (no separate
// component file — kept inline to keep Dashboard self-contained per spec
// "no sidebar/footer chrome").
// ---------------------------------------------------------------------------

type Scope = "project" | "user";
type Lang = "en" | "zh-CN";
const DEFAULT_WORKFLOW_LANG: Lang = "zh-CN";
/** Preset install runtime — Claude Code, Codex, or both. */
type PresetAgent = ApplyPresetAgent;

// Restrained clay-accented dropdown. Used for both the per-column scope
// picker (project|user) and the Workflow column's AGENTS.md language
// picker. Centralized so the two pickers stay visually identical — they
// are the only two interactive controls in the column headers, and
// drifting their styles is the kind of small entropy that erodes the
// dashboard's read-rhythm.
const DROPDOWN_STYLE = {
  appearance: "none" as const,
  WebkitAppearance: "none" as const,
  MozAppearance: "none" as const,
  backgroundColor: "var(--color-ivory-medium)",
  border: "1px solid var(--color-clay)",
  borderRadius: "0",
  padding: "2px 20px 2px 8px",
  fontFamily: "var(--font-anthropic-mono)",
  fontSize: "10px",
  letterSpacing: "0.04em",
  fontWeight: 600,
  // Clay text on ivory-medium fails WCAG AA (~2.7:1). slate-dark on
  // ivory-medium clears 4.5:1 comfortably — keep the clay border for the
  // visual accent, but ink the text in slate so the dropdown's value is
  // legible to users with low-contrast vision.
  color: "var(--color-slate-dark)",
  cursor: "pointer",
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%23d97757' stroke-width='1.75'><path d='M3 5l3 3 3-3'/></svg>\")",
  backgroundRepeat: "no-repeat" as const,
  backgroundPosition: "right 4px center",
  backgroundSize: "10px 10px",
};
const DROPDOWN_OPTION_STYLE = {
  color: "var(--color-slate-dark)",
  backgroundColor: "var(--color-ivory-light)",
};

function CategoryHeader({
  children,
  count,
  scope,
  onScopeChange,
  scopeTestId,
  lang,
  onLangChange,
  langTestId,
}: {
  children: string;
  count?: number;
  scope?: Scope;
  onScopeChange?: (next: Scope) => void;
  scopeTestId?: string;
  lang?: Lang;
  onLangChange?: (next: Lang) => void;
  langTestId?: string;
}): JSX.Element {
  return (
    <h2
      data-testid="category-header"
      className="font-anthropic-mono text-cloud-dark uppercase"
      style={{
        fontSize: "11px",
        lineHeight: 1.3,
        fontFamily: "var(--font-anthropic-mono)",
        fontWeight: 500,
        letterSpacing: "0.06em",
        margin: 0,
        padding: "12px 12px 6px 12px",
        display: "flex",
        alignItems: "baseline",
        gap: "8px",
        justifyContent: "space-between",
      }}
    >
      <span style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
        <span>{children}</span>
        {count !== undefined && (
          <span
            data-testid="category-header-count"
            style={{
              color: "var(--color-cloud-light)",
              fontSize: "11px",
              fontWeight: 400,
            }}
          >
            ({count})
          </span>
        )}
      </span>
      {scope !== undefined && onScopeChange && (
        <select
          data-testid={scopeTestId ?? "category-header-scope"}
          aria-label={`${children} install scope`}
          value={scope}
          onChange={(e) => onScopeChange(e.target.value as Scope)}
          className="font-anthropic-mono uppercase"
          style={DROPDOWN_STYLE}
        >
          <option value="project" style={DROPDOWN_OPTION_STYLE}>
            PROJECT
          </option>
          <option value="user" style={DROPDOWN_OPTION_STYLE}>
            USER
          </option>
        </select>
      )}
      {lang !== undefined && onLangChange && (
        <select
          data-testid={langTestId ?? "category-header-lang"}
          aria-label={`${children} language`}
          value={lang}
          onChange={(e) => onLangChange(e.target.value as Lang)}
          className="font-anthropic-mono uppercase"
          style={DROPDOWN_STYLE}
        >
          <option value="en" style={DROPDOWN_OPTION_STYLE}>
            EN
          </option>
          <option value="zh-CN" style={DROPDOWN_OPTION_STYLE}>
            ZH-CN
          </option>
        </select>
      )}
    </h2>
  );
}

interface CategorySectionProps {
  title: string;
  testId: string;
  count?: number;
  scope?: Scope;
  onScopeChange?: (next: Scope) => void;
  scopeTestId?: string;
  lang?: Lang;
  onLangChange?: (next: Lang) => void;
  langTestId?: string;
  /** True while /api/state is being re-fetched after a scope flip. Surfaces
   *  as `aria-busy` + a subtle opacity dip on the list so the user has a
   *  visual + screen-reader signal that the click registered and the
   *  shown rows are about to update. The list stays interactive (Apply
   *  button etc. don't disappear), matching the "don't blank during
   *  refetch" decision in Dashboard.useEffect. */
  refetching?: boolean;
  children: React.ReactNode;
}

function CategorySection({
  title,
  testId,
  count,
  scope,
  onScopeChange,
  scopeTestId,
  lang,
  onLangChange,
  langTestId,
  refetching = false,
  children,
}: CategorySectionProps): JSX.Element {
  return (
    <section
      data-testid={testId}
      aria-busy={refetching || undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        // Columns get fixed-ish width via the parent grid; allow content
        // to size with the column rather than the items.
        minWidth: 0,
      }}
    >
      <CategoryHeader
        count={count}
        scope={scope}
        onScopeChange={onScopeChange}
        scopeTestId={scopeTestId}
        lang={lang}
        onLangChange={onLangChange}
        langTestId={langTestId}
      >
        {title}
      </CategoryHeader>
      <div
        data-testid={`${testId}-list`}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          flex: 1,
          minHeight: 0,
          // Subtle visual feedback while the scope flip is in flight. We
          // keep the rows interactive but dim them so the user sees the
          // click landed and the data is stale-pending.
          opacity: refetching ? 0.55 : 1,
          transition: "opacity 120ms ease",
        }}
      >
        {children}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PresetBar — one-click "install the recommended preset" affordance with
// inline scope / agent / lang controls. Sits above the category grid and
// is independent of the per-item Apply queue: clicking submits a single
// `preset` apply item. Defaults match the `--preset` CLI flag
// (user / both / en).
// ---------------------------------------------------------------------------

function PresetBar({
  scope,
  agent,
  lang,
  onScopeChange,
  onAgentChange,
  onLangChange,
  onApply,
  disabled,
}: {
  scope: Scope;
  agent: PresetAgent;
  lang: Lang;
  onScopeChange: (next: Scope) => void;
  onAgentChange: (next: PresetAgent) => void;
  onLangChange: (next: Lang) => void;
  onApply: () => void;
  disabled: boolean;
}): JSX.Element {
  const controlLabelStyle = {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontFamily: "var(--font-anthropic-mono)",
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.06em",
    color: "var(--color-cloud-dark)",
  } as const;
  return (
    <div
      data-testid="preset-bar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        flexWrap: "wrap",
        padding: "12px",
        marginBottom: "var(--spacing-16)",
        border: "1px solid var(--color-clay)",
        backgroundColor: "var(--color-ivory-medium)",
      }}
    >
      <span
        className="font-anthropic-sans"
        style={{ fontSize: "13px", color: "var(--color-slate-dark)", minWidth: 0 }}
      >
        <span style={{ fontWeight: 600 }}>Recommended preset</span>
        <span
          style={{
            display: "block",
            fontSize: "11px",
            color: "var(--color-cloud-dark)",
          }}
        >
          AGENTS.md/CLAUDE.md + workflow skills + auriga-workflow plugin
          (scope applies to skills/plugins)
        </span>
      </span>
      <span style={{ flex: 1 }} />
      <label style={controlLabelStyle}>
        SCOPE
        <select
          data-testid="preset-scope"
          aria-label="Preset install scope"
          value={scope}
          onChange={(e) => onScopeChange(e.target.value as Scope)}
          style={DROPDOWN_STYLE}
        >
          <option value="user" style={DROPDOWN_OPTION_STYLE}>USER</option>
          <option value="project" style={DROPDOWN_OPTION_STYLE}>PROJECT</option>
        </select>
      </label>
      <label style={controlLabelStyle}>
        AGENT
        <select
          data-testid="preset-agent"
          aria-label="Preset install agent"
          value={agent}
          onChange={(e) => onAgentChange(e.target.value as PresetAgent)}
          style={DROPDOWN_STYLE}
        >
          <option value="both" style={DROPDOWN_OPTION_STYLE}>BOTH</option>
          <option value="claude" style={DROPDOWN_OPTION_STYLE}>CLAUDE</option>
          <option value="codex" style={DROPDOWN_OPTION_STYLE}>CODEX</option>
        </select>
      </label>
      <label style={controlLabelStyle}>
        LANG
        <select
          data-testid="preset-lang"
          aria-label="Preset workflow language"
          value={lang}
          onChange={(e) => onLangChange(e.target.value as Lang)}
          style={DROPDOWN_STYLE}
        >
          <option value="en" style={DROPDOWN_OPTION_STYLE}>EN</option>
          <option value="zh-CN" style={DROPDOWN_OPTION_STYLE}>ZH-CN</option>
        </select>
      </label>
      <button
        data-testid="preset-apply"
        type="button"
        onClick={onApply}
        disabled={disabled}
        className="font-anthropic-mono uppercase"
        style={{
          appearance: "none",
          border: "1px solid var(--color-clay)",
          backgroundColor: disabled
            ? "var(--color-ivory-dark)"
            : "var(--color-clay)",
          color: disabled
            ? "var(--color-cloud-dark)"
            : "var(--color-ivory-light)",
          fontFamily: "var(--font-anthropic-mono)",
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.06em",
          padding: "6px 14px",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        Install preset
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

// Categories with a per-column scope picker. workflow is excluded — it has
// no scope concept (single file at repo root); preset is excluded too — its
// scope lives in the PresetBar's own control, not the per-column scope map.
type ScopableCategory = Exclude<ApplyCategory, "workflow" | "preset">;

function initialScopeMap(): Map<ScopableCategory, Scope> {
  // Default everything to USER. Rationale: a user-level install reaches
  // every project the user opens, which is what most engineers want by
  // default; PROJECT is the deliberate opt-in for repo-local pinning.
  // Matches `claude plugins install`'s own default scope.
  return new Map<ScopableCategory, Scope>([
    ["skill", "user"],
    ["recommended-skill", "user"],
    ["plugin", "user"],
  ]);
}

export default function Dashboard(): JSX.Element {
  const [state, setState] = useState<StateReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Map keyed by "<category>:<name>" so toggle is O(1) and the same item
  // can't be double-selected even if categories collide on names.
  const [selected, setSelected] = useState<Map<string, ApplyItemRef>>(
    new Map(),
  );
  // Per-category scope; updated by the column-header dropdown. Selected
  // items inherit the current scope at selection time; changing the scope
  // also re-derives the scope on already-selected items in that category.
  const [scopeByCategory, setScopeByCategory] = useState<
    Map<ScopableCategory, Scope>
  >(() => initialScopeMap());
  // Workflow language picker. Workflow is a singleton, so we keep this
  // as a flat top-level state rather than per-category map.
  const [workflowLang, setWorkflowLang] = useState<Lang>(DEFAULT_WORKFLOW_LANG);
  // Global Apply mode. Default "install" — selecting an installed row
  // re-installs (= refresh to latest upstream). Flipped to "uninstall" via
  // the output-bar toggle for explicit removal intent. Not-installed rows
  // always queue install regardless. Switching mode retroactively
  // rewrites the action on already-selected installed/partial rows.
  const [applyMode, setApplyMode] = useState<ApplyAction>("install");
  const [applying, setApplying] = useState(false);

  // Preset bar controls. The defaults differ from a category install —
  // scope=user, agent=both, lang=zh-CN — matching the `--preset` CLI flag.
  const [presetScope, setPresetScope] = useState<Scope>("user");
  const [presetAgent, setPresetAgent] = useState<PresetAgent>("both");
  const [presetLang, setPresetLang] = useState<Lang>(DEFAULT_WORKFLOW_LANG);

  // Derive the /api/state `scopes` query payload from the per-column scope
  // pickers. The server splits skill/recommended-skill into one `skills`
  // scope on the truth-source side (both live under
  // <scope>/.claude/skills/), so we route the column picker for `skill` to
  // the API's `skills` channel. `recommended-skill` would conflict if the
  // user dragged them apart; in v0.1 we accept that limitation and let the
  // primary skill picker win for both. Workflow stays on the server
  // default (project) until we add a workflow scope toggle.
  const currentScopes = useMemo(
    () => ({
      skills: scopeByCategory.get("skill") ?? "user",
      plugins: scopeByCategory.get("plugin") ?? "user",
    }),
    [scopeByCategory],
  );

  // Fetch state on mount AND whenever the scope pickers change — the
  // server returns rows scoped to the requested truth source per category,
  // so a scope flip is effectively a per-column re-scan. Subsequent
  // refetches keep the prior state visible (so the Apply button etc.
  // don't disappear mid-flip); only the initial mount blocks on `loading`.
  // `refetching` is a separate signal — see WorkflowSection + scope-picker
  // captions for the visual + a11y treatment.
  const [refetching, setRefetching] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setRefetching(true);
    fetchState(currentScopes)
      .then((report) => {
        if (cancelled) return;
        setState(report);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "unknown error";
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setRefetching(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentScopes]);

  // Heartbeat: ping every 5s so the server's 2-min idle-exit timer stays
  // reset. Best-effort; ping() swallows transient failures.
  useEffect(() => {
    const id = setInterval(() => {
      void ping();
    }, PING_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Toggle helper passed into every StateCard. `isSelected` is the *desired*
  // next state (StateCard already flipped the bool); we use it to insert vs.
  // delete the map entry. Inherits the per-category scope from
  // scopeByCategory at selection time.
  const toggleSelection = useCallback(
    (
      category: ApplyCategory,
      name: string,
      status: ItemStatus,
      isSelected: boolean,
    ) => {
      setSelected((prev) => {
        const next = new Map(prev);
        const key = makeKey(category, name);
        if (isSelected) {
          const ref: ApplyItemRef = {
            category,
            name,
            action: deriveAction(status, applyMode),
          };
          // workflow has no scope; other categories pick from the current
          // column-level scope state.
          if (category !== "workflow") {
            ref.scope =
              scopeByCategory.get(category as ScopableCategory) ?? "user";
          } else {
            // Workflow inherits the current language picker selection.
            ref.lang = workflowLang;
          }
          next.set(key, ref);
        } else {
          next.delete(key);
        }
        return next;
      });
    },
    [scopeByCategory, workflowLang, applyMode],
  );

  // Mode toggle on the output bar. Mirrors changeScope / changeWorkflowLang
  // discipline — flipping mode rewrites the action on every
  // already-selected installed / partial row so the Apply payload matches
  // what the user sees. Not-installed rows are left alone (mode has no
  // effect on them; their action stays "install").
  const changeApplyMode = useCallback(
    (next: ApplyAction) => {
      setApplyMode(next);
      if (state === null) return;
      const statusByKey = new Map<string, ItemStatus>();
      statusByKey.set(makeKey("workflow", "workflow"), state.workflow.status);
      for (const s of state.skills) statusByKey.set(makeKey("skill", s.name), s.status);
      for (const s of state.recommendedSkills)
        statusByKey.set(makeKey("recommended-skill", s.name), s.status);
      for (const p of state.plugins) statusByKey.set(makeKey("plugin", p.id), p.status);
      setSelected((prev) => {
        if (prev.size === 0) return prev;
        let changed = false;
        const out = new Map(prev);
        for (const [key, ref] of out) {
          const status = statusByKey.get(key);
          if (status === undefined) continue;
          const want = deriveAction(status, next);
          if (ref.action !== want) {
            out.set(key, { ...ref, action: want });
            changed = true;
          }
        }
        return changed ? out : prev;
      });
    },
    [state],
  );

  // Update the column scope, and re-derive scope on already-selected items
  // in that column so the apply payload matches what the user currently sees.
  const changeScope = useCallback(
    (category: ScopableCategory, next: Scope) => {
      setScopeByCategory((prev) => {
        const m = new Map(prev);
        m.set(category, next);
        return m;
      });
      setSelected((prev) => {
        const out = new Map(prev);
        for (const [key, ref] of out) {
          if (ref.category === category) {
            out.set(key, { ...ref, scope: next });
          }
        }
        return out;
      });
    },
    [],
  );

  // Same pattern as changeScope, but for the Workflow column's AGENTS.md
  // language picker. Re-derives lang on the (singleton) workflow selection
  // if it's already in the apply queue.
  const changeWorkflowLang = useCallback((next: Lang) => {
    setWorkflowLang(next);
    setSelected((prev) => {
      const out = new Map(prev);
      for (const [key, ref] of out) {
        if (ref.category === "workflow") {
          out.set(key, { ...ref, lang: next });
        }
      }
      return out;
    });
  }, []);

  // ---- Log buffer state ----
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [jobStatus, setJobStatus] = useState<string | undefined>(undefined);
  const sseRef = useRef<{ close: () => void } | null>(null);
  const logSeq = useRef<number>(0);

  // Close any in-flight SSE when the dashboard unmounts.
  useEffect(() => {
    return () => {
      sseRef.current?.close();
      sseRef.current = null;
    };
  }, []);

  const appendLog = useCallback(
    (level: LogLine["level"], text: string) => {
      logSeq.current += 1;
      const id = `${Date.now()}-${logSeq.current}`;
      setLogLines((prev) => {
        // Cap to last 500 lines so a misbehaving installer can't grow the
        // DOM unbounded. The SSE server-side already caps at 200 events,
        // but our log buffer also includes synthesized meta lines.
        const next = prev.length >= 500 ? prev.slice(-499) : prev.slice();
        next.push({ id, level, text });
        return next;
      });
    },
    [],
  );

  // Any selected item with action === "uninstall" triggers destructive
  // visual treatment + Apply-time confirmation. Workflow uninstall is the
  // most dangerous (removes AGENTS.md) so it gets a separate, harder confirm.
  const hasDestructive = useMemo(
    () => Array.from(selected.values()).some((item) => item.action === "uninstall"),
    [selected],
  );

  const handleCancel = useCallback(() => {
    // Two distinct modes:
    //
    //   1. applying === true  → DISCONNECT from the SSE stream. The server
    //      keeps the job running (there's no /api/cancel endpoint in v0.1),
    //      but the UI releases its locked state so the user isn't trapped.
    //      Spelled out in the confirm copy so the user isn't surprised by
    //      the background-continuation.
    //
    //   2. applying === false → CLEAR the pending selection. Confirm before
    //      discarding to defeat misclicks.
    if (applying) {
      const ok = window.confirm(
        "Disconnect from the running apply job?\n\n" +
          "The installer continues running on the server — there's no abort in v0.1. " +
          "You'll stop seeing live log lines, but the install isn't stopped. " +
          "Reload the page later to see the final result.",
      );
      if (!ok) return;
      sseRef.current?.close();
      sseRef.current = null;
      setApplying(false);
      setJobStatus("Disconnected — job continues in background");
      return;
    }
    if (selected.size === 0) return;
    const ok = window.confirm(
      `Clear ${selected.size} pending item${selected.size > 1 ? "s" : ""}? This won't undo anything already applied.`,
    );
    if (!ok) return;
    setSelected(new Map());
  }, [selected, applying]);

  const formatProgressEvent = useCallback(
    (ev: ApiProgressEvent): { level: LogLine["level"]; text: string } | null => {
      switch (ev.type) {
        case "item:start": {
          const scopeSuffix = ev.item.scope ? ` [${ev.item.scope}]` : "";
          return {
            level: "meta",
            text: `▸ ${ev.item.action} ${ev.item.category}/${ev.item.name}${scopeSuffix}  (${ev.index + 1}/${ev.total})`,
          };
        }
        case "item:log":
          return { level: ev.level === "error" ? "error" : ev.level === "warn" ? "warn" : "info", text: `  ${ev.line}` };
        case "item:done":
          if (ev.success) {
            return { level: "ok", text: "  ✓ done" };
          }
          return { level: "error", text: `  ✗ ${ev.error ?? "failed"}` };
        case "all-done":
          if (ev.success) {
            return { level: "ok", text: `── all-done · ${ev.failedCount === 0 ? "all succeeded" : `${ev.failedCount} failed`}` };
          }
          return { level: "error", text: `── all-done · ${ev.failedCount} failed` };
      }
    },
    [],
  );

  // Shared submit + SSE-stream pump. Both the per-item Apply button and
  // the one-click preset button funnel through here so the log buffer,
  // job status, and post-apply rescan behave identically.
  const submitAndStream = useCallback(
    async (items: ApplyItemRef[]) => {
      setApplying(true);
      setLogLines([]);
      setJobStatus("Submitting apply request…");
      try {
        appendLog(
          "meta",
          `── Apply ${items.length} item${items.length > 1 ? "s" : ""}`,
        );
        const { jobId } = await submitApply({ items });
        appendLog("meta", `── job ${jobId.slice(0, 12)}…`);
        setJobStatus(`Job ${jobId.slice(0, 12)}…  running`);

        // Open SSE; close any prior stream first.
        sseRef.current?.close();
        sseRef.current = openProgress(jobId, (ev) => {
          const formatted = formatProgressEvent(ev);
          if (formatted) appendLog(formatted.level, formatted.text);
          if (ev.type === "all-done") {
            sseRef.current?.close();
            sseRef.current = null;
            setApplying(false);
            setJobStatus(
              ev.success
                ? `Last job completed · ${ev.failedCount === 0 ? "all succeeded" : `${ev.failedCount} failed`}`
                : `Last job completed · ${ev.failedCount} failed`,
            );
            // Refresh /api/state so badges reflect the new ground truth.
            // Carry the current scope picks so the post-apply rescan reads
            // from the same truth source the user just operated on.
            fetchState(currentScopes)
              .then((report) => setState(report))
              .catch(() => {
                /* keep prior state; non-fatal */
              });
            setSelected(new Map());
          }
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "apply failed";
        appendLog("error", `submit failed: ${msg}`);
        setJobStatus(undefined);
        setError(msg);
        setApplying(false);
      }
    },
    [appendLog, formatProgressEvent, currentScopes],
  );

  const handleApply = useCallback(async () => {
    if (selected.size === 0) return;
    const items = Array.from(selected.values());

    // Two-stage confirmation for destructive batches:
    //   1. Workflow uninstall is the hardest — removes AGENTS.md / CLAUDE.md
    //      and unconditionally with force=true. Spec §13.5 demands explicit
    //      double-confirm; we use two separate prompts so the user can't
    //      muscle-memory through a single "OK".
    //   2. Any other uninstall (skill / plugin) gets a single confirm
    //      listing what's being removed.
    const workflowUninstall = items.find(
      (i) => i.category === "workflow" && i.action === "uninstall",
    );
    if (workflowUninstall !== undefined) {
      const first = window.confirm(
        "Uninstall workflow? This deletes AGENTS.md and the CLAUDE.md symlink from the current project.",
      );
      if (!first) return;
      const second = window.confirm(
        "Are you sure? This is destructive and cannot be undone from the Web UI.",
      );
      if (!second) return;
    }
    const otherUninstalls = items.filter(
      (i) => i.action === "uninstall" && i.category !== "workflow",
    );
    if (otherUninstalls.length > 0) {
      const summary = otherUninstalls
        .map((i) => `• ${i.category}/${i.name}`)
        .join("\n");
      const ok = window.confirm(
        `Uninstall the following?\n\n${summary}\n\nThis removes their files and settings entries.`,
      );
      if (!ok) return;
    }

    await submitAndStream(items);
  }, [selected, submitAndStream]);

  // One-click preset install. Independent of the per-item `selected`
  // queue — it submits a single `preset` apply item carrying the
  // scope / agent / lang from the preset bar's own controls.
  const handleApplyPreset = useCallback(async () => {
    if (applying) return;
    const item: ApplyItemRef = {
      category: "preset",
      name: "preset",
      action: "install",
      scope: presetScope,
      lang: presetLang,
      agent: presetAgent,
    };
    await submitAndStream([item]);
  }, [applying, presetScope, presetAgent, presetLang, submitAndStream]);

  // cwd surfaced by the server (home-reduced, e.g. `~/Workspace/foo`). Falls
  // back to a generic label until /api/state lands.
  const cwdLabel = state?.cwd ?? "current project";

  // Marketplace status: a `marketplace-offline` warning lands in
  // state.warnings; otherwise treat as online. "unknown" while loading.
  const marketplaceStatus = useMemo<MarketplaceStatus>(() => {
    if (state === null) return "unknown";
    const offline = state.warnings.some(
      (w) => w.code === "marketplace-offline",
    );
    return offline ? "offline" : "online";
  }, [state]);

  const topBar = <TopBar cwd={cwdLabel} marketplaceStatus={marketplaceStatus} />;

  if (loading) {
    return (
      <Layout topBar={topBar}>
        <div
          data-testid="dashboard-loading"
          className="font-anthropic-sans text-cloud-dark"
          style={{ fontSize: "15px", padding: "var(--spacing-32) 0" }}
        >
          Loading…
        </div>
      </Layout>
    );
  }

  if (error !== null && state === null) {
    return (
      <Layout topBar={topBar}>
        <div
          data-testid="dashboard-error"
          role="alert"
          className="font-anthropic-sans"
          style={{
            fontSize: "15px",
            color: "var(--color-accent-ember)",
            padding: "var(--spacing-32) 0",
          }}
        >
          Failed to load state: {error}
        </div>
      </Layout>
    );
  }

  // Defensive: at this point `state` must be set (loading=false + no fatal
  // error). TS narrows it via the explicit null check.
  if (state === null) {
    return <Layout topBar={topBar}>{null}</Layout>;
  }

  return (
    <Layout topBar={topBar}>
      <div data-testid="dashboard-root">
        {/* Non-fatal error banner: e.g. a submitApply failure while state
            is otherwise valid. */}
        {error !== null && (
          <div
            data-testid="dashboard-error-banner"
            role="alert"
            className="font-anthropic-sans"
            style={{
              fontSize: "13px",
              color: "var(--color-accent-ember)",
              marginBottom: "var(--spacing-16)",
            }}
          >
            {error}
          </div>
        )}

        <PresetBar
          scope={presetScope}
          agent={presetAgent}
          lang={presetLang}
          onScopeChange={setPresetScope}
          onAgentChange={setPresetAgent}
          onLangChange={setPresetLang}
          onApply={() => void handleApplyPreset()}
          disabled={applying}
        />

        <div className="dashboard-grid" data-testid="dashboard-grid">
          <div data-section="workflow">
            <WorkflowSection
              workflow={state.workflow}
              selected={selected}
              onToggle={toggleSelection}
              lang={workflowLang}
              onLangChange={changeWorkflowLang}
              refetching={refetching}
            />
          </div>
          <div data-section="skill">
            <SkillsSection
              skills={state.skills}
              selected={selected}
              onToggle={toggleSelection}
              scope={scopeByCategory.get("skill") ?? "user"}
              onScopeChange={(s) => changeScope("skill", s)}
              refetching={refetching}
            />
          </div>
          <div data-section="recommended">
            <RecommendedSkillsSection
              recommendedSkills={state.recommendedSkills}
              selected={selected}
              onToggle={toggleSelection}
              scope={scopeByCategory.get("recommended-skill") ?? "user"}
              onScopeChange={(s) => changeScope("recommended-skill", s)}
              refetching={refetching}
            />
          </div>
          <div data-section="plugin">
            <PluginsSection
              plugins={state.plugins}
              selected={selected}
              onToggle={toggleSelection}
              scope={scopeByCategory.get("plugin") ?? "user"}
              onScopeChange={(s) => changeScope("plugin", s)}
              refetching={refetching}
            />
          </div>
          <div data-section="log">
            <LogPanel
              lines={logLines}
              pendingCount={selected.size}
              applying={applying}
              status={jobStatus}
              hasDestructive={hasDestructive}
              mode={applyMode}
              onModeChange={changeApplyMode}
              onApply={() => void handleApply()}
              onCancel={handleCancel}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Category sections — each is a thin wrapper around CategorySection that
// maps a slice of StateReport → StateCards. Kept inline (single file) so
// the Dashboard remains the single source of truth for shape composition.
// ---------------------------------------------------------------------------

type ToggleFn = (
  category: ApplyCategory,
  name: string,
  status: ItemStatus,
  isSelected: boolean,
) => void;

interface WorkflowSectionProps {
  workflow: WorkflowState;
  selected: Map<string, ApplyItemRef>;
  onToggle: ToggleFn;
  lang: Lang;
  onLangChange: (next: Lang) => void;
  refetching?: boolean;
}

function WorkflowSection({
  workflow,
  selected,
  onToggle,
  lang,
  onLangChange,
  refetching = false,
}: WorkflowSectionProps): JSX.Element {
  const key = makeKey("workflow", "workflow");
  // Workflow is the only column without a scope dropdown (v1.16.1 defers
  // adding one to v0.2 — see docs/architecture/web-ui.md §6.3). Surface
  // the resolved scope as a card-level caption so a user running web-ui
  // from `~/` can see "this row came from your USER-scope CLAUDE.md"
  // rather than guessing whether it's project or user.
  const observed = (workflow as WorkflowState & { observedScope?: Scope }).observedScope;
  const observedCaption =
    observed === "user"
      ? "Source: USER (~/.claude/CLAUDE.md)"
      : observed === "project"
        ? "Source: PROJECT (<cwd>/AGENTS.md)"
        : null;
  const description = observedCaption
    ? `The auriga workflow template. ${observedCaption}`
    : "The auriga workflow template installed at the repo root.";
  return (
    <CategorySection
      title="Workflow"
      testId="section-workflow"
      count={1}
      lang={lang}
      onLangChange={onLangChange}
      langTestId="section-workflow-lang"
      refetching={refetching}
    >
      <StateCard
        name="AGENTS.md workflow"
        description={description}
        status={toCardStatus(workflow.status)}
        selected={selected.has(key)}
        onSelectChange={(isSel) =>
          onToggle("workflow", "workflow", workflow.status, isSel)
        }
      />
    </CategorySection>
  );
}

interface SkillsSectionProps {
  skills: SkillState[];
  selected: Map<string, ApplyItemRef>;
  onToggle: ToggleFn;
  scope: Scope;
  onScopeChange: (next: Scope) => void;
  refetching?: boolean;
}

function SkillsSection({
  skills,
  selected,
  onToggle,
  scope,
  onScopeChange,
  refetching = false,
}: SkillsSectionProps): JSX.Element | null {
  if (skills.length === 0) return null;
  return (
    <CategorySection
      title="Skills"
      testId="section-skills"
      count={skills.length}
      scope={scope}
      onScopeChange={onScopeChange}
      scopeTestId="section-skills-scope"
      refetching={refetching}
    >
      {skills.map((skill) => {
        const key = makeKey("skill", skill.name);
        return (
          <StateCard
            key={key}
            name={skill.name}
            description={skill.description}
            status={toCardStatus(skill.status)}
            selected={selected.has(key)}
            onSelectChange={(isSel) =>
              onToggle("skill", skill.name, skill.status, isSel)
            }
          />
        );
      })}
    </CategorySection>
  );
}

interface RecommendedSkillsSectionProps {
  recommendedSkills: SkillState[];
  selected: Map<string, ApplyItemRef>;
  onToggle: ToggleFn;
  scope: Scope;
  onScopeChange: (next: Scope) => void;
  refetching?: boolean;
}

function RecommendedSkillsSection({
  recommendedSkills,
  selected,
  onToggle,
  scope,
  onScopeChange,
  refetching = false,
}: RecommendedSkillsSectionProps): JSX.Element | null {
  if (recommendedSkills.length === 0) return null;
  return (
    <CategorySection
      title="Recommended Skills"
      testId="section-recommended-skills"
      count={recommendedSkills.length}
      scope={scope}
      onScopeChange={onScopeChange}
      scopeTestId="section-recommended-skills-scope"
      refetching={refetching}
    >
      {recommendedSkills.map((skill) => {
        const key = makeKey("recommended-skill", skill.name);
        return (
          <StateCard
            key={key}
            name={skill.name}
            description={skill.description}
            status={toCardStatus(skill.status)}
            selected={selected.has(key)}
            onSelectChange={(isSel) =>
              onToggle("recommended-skill", skill.name, skill.status, isSel)
            }
          />
        );
      })}
    </CategorySection>
  );
}

interface PluginsSectionProps {
  plugins: PluginState[];
  selected: Map<string, ApplyItemRef>;
  onToggle: ToggleFn;
  scope: Scope;
  onScopeChange: (next: Scope) => void;
  refetching?: boolean;
}

function PluginsSection({
  plugins,
  selected,
  onToggle,
  scope,
  onScopeChange,
  refetching = false,
}: PluginsSectionProps): JSX.Element | null {
  if (plugins.length === 0) return null;
  return (
    <CategorySection
      title="Plugins"
      testId="section-plugins"
      count={plugins.length}
      scope={scope}
      onScopeChange={onScopeChange}
      scopeTestId="section-plugins-scope"
      refetching={refetching}
    >
      {plugins.map((plugin) => {
        const key = makeKey("plugin", plugin.id);
        return (
          <StateCard
            key={key}
            name={plugin.id}
            description={plugin.description}
            status={toCardStatus(plugin.status)}
            selected={selected.has(key)}
            onSelectChange={(isSel) =>
              onToggle("plugin", plugin.id, plugin.status, isSel)
            }
            agents={plugin.agents}
            external={plugin.external}
            missingAgents={plugin.missingAgents}
          />
        );
      })}
    </CategorySection>
  );
}
