// Dashboard — top-level page. Composes Layout + TopBar + 5 category
// columns of StateCards + a right-rail OUTPUT column (LogPanel) that
// hosts the SSE log buffer and the Apply/Cancel actions.
//
// Spec mapping:
//   - Layout/composition: docs/architecture/web-ui.md §12 "页面布局"
//   - Category order:     §12.2 (Workflow → Skills → Recommended Skills →
//                         Plugins → Hooks). The spec lists Plugins (Claude)
//                         and Plugins (Codex) as separate sub-headers, but
//                         StateReport carries them in one `plugins[]` array
//                         distinguished by `plugin.agent`. We group inline.
//   - Visual encoding:    §13 (status → StateCard, no chip chrome, single
//                         clay accent on the LogPanel footer border).
//
// Default action derivation (when a card is selected):
//
//   status="installed"        → action="uninstall"
//   status="update-available" → action="update"
//   status="not-installed"    → action="install"
//
// Rationale: the most likely user intent given the current state. Toggling
// the action between install/uninstall on an already-installed item is a
// post-M3 affordance (the design has room for a secondary action menu).
//
// Selection key shape: "<category>:<name>". `category` matches
// ApplyCategory exactly so we can derive ApplyItemRef without a lookup map.
// `name` is the per-category identifier (workflow→"workflow", skill→skill
// name, plugin→plugin.id, hook→hook name).

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
  HookState,
  ItemStatus,
  PluginState,
  ProgressEvent as ApiProgressEvent,
  SkillState,
  StateReport,
  WorkflowState,
} from "../../../src/api-types.js";

const PING_INTERVAL_MS = 5000;

// Map server's ItemStatus (3 states) onto StateCard's CardStatus (4 states).
// `error` is reserved for future per-item failures that the scanner doesn't
// surface today — keeping the mapping explicit makes the upgrade cheap.
function toCardStatus(status: ItemStatus): CardStatus {
  return status;
}

function deriveAction(status: ItemStatus): ApplyAction {
  switch (status) {
    case "installed":
      return "uninstall";
    case "update-available":
      return "update";
    case "not-installed":
      return "install";
  }
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

// Restrained clay-accented dropdown. Used for both the per-column scope
// picker (project|user) and the Workflow column's CLAUDE.md language
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
  color: "var(--color-clay)",
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
  children,
}: CategorySectionProps): JSX.Element {
  return (
    <section
      data-testid={testId}
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
        }}
      >
        {children}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

// Categories that take a scope selector. workflow is excluded — it has no
// scope concept (single file at repo root).
type ScopableCategory = Exclude<ApplyCategory, "workflow">;

function initialScopeMap(): Map<ScopableCategory, Scope> {
  // Default everything to USER. Rationale: a user-level install reaches
  // every project the user opens, which is what most engineers want by
  // default; PROJECT is the deliberate opt-in for repo-local pinning.
  // Matches `claude plugins install`'s own default scope.
  return new Map<ScopableCategory, Scope>([
    ["skill", "user"],
    ["recommended-skill", "user"],
    ["plugin", "user"],
    ["hook", "user"],
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
  // CLAUDE.md language picker. Workflow is a singleton, so we keep this
  // as a flat top-level state rather than per-category map.
  const [workflowLang, setWorkflowLang] = useState<Lang>("en");
  const [applying, setApplying] = useState(false);

  // Initial state fetch.
  useEffect(() => {
    let cancelled = false;
    fetchState()
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
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Heartbeat: ping every 5s so the server's 15s idle-exit timer stays
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
            action: deriveAction(status),
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
    [scopeByCategory, workflowLang],
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

  // Same pattern as changeScope, but for the Workflow column's CLAUDE.md
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

  const handleCancel = useCallback(() => {
    setSelected(new Map());
  }, []);

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

  const handleApply = useCallback(async () => {
    if (selected.size === 0) return;
    setApplying(true);
    setLogLines([]);
    setJobStatus("Submitting apply request…");
    const items = Array.from(selected.values());
    try {
      appendLog("meta", `── Apply ${items.length} item${items.length > 1 ? "s" : ""}`);
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
          fetchState()
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
  }, [selected, appendLog, formatProgressEvent]);

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

        <div
          data-testid="dashboard-grid"
          style={{
            display: "grid",
            // 5 category columns + 1 OUTPUT column (fixed 320px).
            // minmax(0, 1fr) lets the category columns shrink to 0 and rely
            // on min-width: 0 inside each section for overflow.
            gridTemplateColumns: "repeat(5, minmax(0, 1fr)) 320px",
            gap: "12px",
            alignItems: "stretch",
            minHeight: "calc(100vh - 160px)",
          }}
        >
          <WorkflowSection
            workflow={state.workflow}
            selected={selected}
            onToggle={toggleSelection}
            lang={workflowLang}
            onLangChange={changeWorkflowLang}
          />
          <SkillsSection
            skills={state.skills}
            selected={selected}
            onToggle={toggleSelection}
            scope={scopeByCategory.get("skill") ?? "user"}
            onScopeChange={(s) => changeScope("skill", s)}
          />
          <RecommendedSkillsSection
            recommendedSkills={state.recommendedSkills}
            selected={selected}
            onToggle={toggleSelection}
            scope={scopeByCategory.get("recommended-skill") ?? "user"}
            onScopeChange={(s) => changeScope("recommended-skill", s)}
          />
          <PluginsSection
            plugins={state.plugins}
            selected={selected}
            onToggle={toggleSelection}
            scope={scopeByCategory.get("plugin") ?? "user"}
            onScopeChange={(s) => changeScope("plugin", s)}
          />
          <HooksSection
            hooks={state.hooks}
            selected={selected}
            onToggle={toggleSelection}
            scope={scopeByCategory.get("hook") ?? "user"}
            onScopeChange={(s) => changeScope("hook", s)}
          />
          <LogPanel
            lines={logLines}
            pendingCount={selected.size}
            applying={applying}
            status={jobStatus}
            onApply={() => void handleApply()}
            onCancel={handleCancel}
          />
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
}

function WorkflowSection({
  workflow,
  selected,
  onToggle,
  lang,
  onLangChange,
}: WorkflowSectionProps): JSX.Element {
  const key = makeKey("workflow", "workflow");
  return (
    <CategorySection
      title="Workflow"
      testId="section-workflow"
      count={1}
      lang={lang}
      onLangChange={onLangChange}
      langTestId="section-workflow-lang"
    >
      <StateCard
        name="CLAUDE.md workflow"
        description="The auriga workflow template installed at the repo root."
        status={toCardStatus(workflow.status)}
        currentVersion={workflow.currentVersion}
        expectedVersion={workflow.expectedVersion}
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
}

function SkillsSection({
  skills,
  selected,
  onToggle,
  scope,
  onScopeChange,
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
    >
      {skills.map((skill) => {
        const key = makeKey("skill", skill.name);
        return (
          <StateCard
            key={key}
            name={skill.name}
            description={skill.description}
            status={toCardStatus(skill.status)}
            currentHash={skill.currentHash}
            expectedHash={skill.expectedHash}
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
}

function RecommendedSkillsSection({
  recommendedSkills,
  selected,
  onToggle,
  scope,
  onScopeChange,
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
    >
      {recommendedSkills.map((skill) => {
        const key = makeKey("recommended-skill", skill.name);
        return (
          <StateCard
            key={key}
            name={skill.name}
            description={skill.description}
            status={toCardStatus(skill.status)}
            currentHash={skill.currentHash}
            expectedHash={skill.expectedHash}
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
}

function PluginsSection({
  plugins,
  selected,
  onToggle,
  scope,
  onScopeChange,
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
    >
      {plugins.map((plugin) => {
        const key = makeKey("plugin", plugin.id);
        return (
          <StateCard
            key={key}
            name={plugin.id}
            description={plugin.description}
            status={toCardStatus(plugin.status)}
            currentVersion={plugin.currentVersion}
            expectedVersion={plugin.expectedVersion}
            selected={selected.has(key)}
            onSelectChange={(isSel) =>
              onToggle("plugin", plugin.id, plugin.status, isSel)
            }
          />
        );
      })}
    </CategorySection>
  );
}

interface HooksSectionProps {
  hooks: HookState[];
  selected: Map<string, ApplyItemRef>;
  onToggle: ToggleFn;
  scope: Scope;
  onScopeChange: (next: Scope) => void;
}

function HooksSection({
  hooks,
  selected,
  onToggle,
  scope,
  onScopeChange,
}: HooksSectionProps): JSX.Element | null {
  if (hooks.length === 0) return null;
  return (
    <CategorySection
      title="Hooks"
      testId="section-hooks"
      count={hooks.length}
      scope={scope}
      onScopeChange={onScopeChange}
      scopeTestId="section-hooks-scope"
    >
      {hooks.map((hook) => {
        const key = makeKey("hook", hook.name);
        return (
          <StateCard
            key={key}
            name={hook.name}
            description={hook.description}
            status={toCardStatus(hook.status)}
            currentHash={hook.currentHash}
            expectedHash={hook.expectedHash}
            selected={selected.has(key)}
            onSelectChange={(isSel) =>
              onToggle("hook", hook.name, hook.status, isSel)
            }
          />
        );
      })}
    </CategorySection>
  );
}
