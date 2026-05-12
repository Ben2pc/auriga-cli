// Dashboard — top-level page. Composes Layout + TopBar + 5 category
// sections (each a list of StateCards) + the sticky ApplyBar.
//
// Spec mapping:
//   - Layout/composition: docs/architecture/web-ui.md §12 "页面布局"
//   - Category order:     §12.2 (Workflow → Skills → Recommended Skills →
//                         Plugins → Hooks). The spec lists Plugins (Claude)
//                         and Plugins (Codex) as separate sub-headers, but
//                         StateReport carries them in one `plugins[]` array
//                         distinguished by `plugin.agent`. We group inline.
//   - Visual encoding:    §13 (status → StateCard, no chip chrome, single
//                         clay accent on the ApplyBar top border).
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

import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import ApplyBar from "../components/ApplyBar.js";
import type { PendingAction } from "../components/ApplyBar.js";
import Layout from "../components/Layout.js";
import StateCard from "../components/StateCard.js";
import type { CardStatus } from "../components/StateCard.js";
import TopBar from "../components/TopBar.js";
import type { MarketplaceStatus } from "../components/TopBar.js";
import { fetchState, ping, submitApply } from "../lib/api.js";
import type {
  ApplyAction,
  ApplyCategory,
  ApplyItemRef,
  HookState,
  ItemStatus,
  PluginState,
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

function CategoryHeader({
  children,
  count,
  scope,
  onScopeChange,
  scopeTestId,
}: {
  children: string;
  count?: number;
  scope?: Scope;
  onScopeChange?: (next: Scope) => void;
  scopeTestId?: string;
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
          style={{
            appearance: "none",
            WebkitAppearance: "none",
            MozAppearance: "none",
            backgroundColor: "transparent",
            border: "1px solid var(--color-cloud-light)",
            borderRadius: "0",
            padding: "2px 18px 2px 6px",
            fontFamily: "var(--font-anthropic-mono)",
            fontSize: "10px",
            letterSpacing: "0.04em",
            color: "var(--color-slate-dark)",
            cursor: "pointer",
            // Inline caret marker.
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%23656762' stroke-width='1.5'><path d='M3 5l3 3 3-3'/></svg>\")",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 4px center",
            backgroundSize: "10px 10px",
          }}
        >
          <option value="project">PROJECT</option>
          <option value="user">USER</option>
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
  children: React.ReactNode;
}

function CategorySection({
  title,
  testId,
  count,
  scope,
  onScopeChange,
  scopeTestId,
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
  return new Map<ScopableCategory, Scope>([
    ["skill", "project"],
    ["recommended-skill", "project"],
    ["plugin", "user"], // plugins default to user-scope (memory: plugin scope = user)
    ["hook", "project"],
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
              scopeByCategory.get(category as ScopableCategory) ?? "project";
          }
          next.set(key, ref);
        } else {
          next.delete(key);
        }
        return next;
      });
    },
    [scopeByCategory],
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

  const pendingActions = useMemo<PendingAction[]>(() => {
    return Array.from(selected.values()).map((ref) => ({
      category: ref.category,
      name: ref.name,
      action: ref.action,
    }));
  }, [selected]);

  const handleCancel = useCallback(() => {
    setSelected(new Map());
  }, []);

  const handleApply = useCallback(async () => {
    if (selected.size === 0) return;
    setApplying(true);
    try {
      await submitApply({
        items: Array.from(selected.values()),
      });
      // M3 wires the SSE flow to drive the log panel; for now we just clear
      // the pending set so the user sees the submit succeeded.
      setSelected(new Map());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "apply failed";
      setError(msg);
    } finally {
      setApplying(false);
    }
  }, [selected]);

  // Resolve the cwd label for the top bar. The server doesn't echo cwd in
  // the state report yet, so we fall back to a placeholder; M3+ will surface
  // it. Using a generic label avoids leaking a hard-coded path.
  const cwdLabel = "current project";

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

  const bottomBar =
    pendingActions.length > 0 ? (
      <ApplyBar
        pendingActions={pendingActions}
        onCancel={handleCancel}
        onApply={() => void handleApply()}
        applying={applying}
      />
    ) : undefined;

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
    <Layout topBar={topBar} bottomBar={bottomBar}>
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
            // 5 columns, each can shrink to 0 (minmax handles content
            // overflow inside via min-width: 0 on the section).
            gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
            gap: "12px",
            alignItems: "start",
          }}
        >
          <WorkflowSection
            workflow={state.workflow}
            selected={selected}
            onToggle={toggleSelection}
          />
          <SkillsSection
            skills={state.skills}
            selected={selected}
            onToggle={toggleSelection}
            scope={scopeByCategory.get("skill") ?? "project"}
            onScopeChange={(s) => changeScope("skill", s)}
          />
          <RecommendedSkillsSection
            recommendedSkills={state.recommendedSkills}
            selected={selected}
            onToggle={toggleSelection}
            scope={scopeByCategory.get("recommended-skill") ?? "project"}
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
            scope={scopeByCategory.get("hook") ?? "project"}
            onScopeChange={(s) => changeScope("hook", s)}
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
}

function WorkflowSection({
  workflow,
  selected,
  onToggle,
}: WorkflowSectionProps): JSX.Element {
  const key = makeKey("workflow", "workflow");
  return (
    <CategorySection title="Workflow" testId="section-workflow" count={1}>
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
