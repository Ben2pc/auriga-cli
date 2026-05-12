// Dashboard — top-level page. Composes Layout + TopBar + 5 category
// sections (each a list of StateCards) + the sticky ApplyBar.
//
// Spec mapping:
//   - Layout/composition: docs/specs/web-ui.md §12 "页面布局"
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

function CategoryHeader({ children }: { children: string }): JSX.Element {
  return (
    <h2
      data-testid="category-header"
      className="font-anthropic-sans text-slate-dark"
      style={{
        fontSize: "20px",
        lineHeight: "var(--leading-heading-sm)",
        fontWeight: 600,
        margin: 0,
        marginBottom: "var(--spacing-16)",
      }}
    >
      {children}
    </h2>
  );
}

interface CategorySectionProps {
  title: string;
  testId: string;
  children: React.ReactNode;
}

function CategorySection({
  title,
  testId,
  children,
}: CategorySectionProps): JSX.Element {
  return (
    <section
      data-testid={testId}
      style={{ marginBottom: "var(--spacing-32)" }}
    >
      <CategoryHeader>{title}</CategoryHeader>
      <div className="flex flex-col" style={{ gap: "8px" }}>
        {children}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export default function Dashboard(): JSX.Element {
  const [state, setState] = useState<StateReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Map keyed by "<category>:<name>" so toggle is O(1) and the same item
  // can't be double-selected even if categories collide on names.
  const [selected, setSelected] = useState<Map<string, ApplyItemRef>>(
    new Map(),
  );
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
  // delete the map entry.
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
          next.set(key, {
            category,
            name,
            action: deriveAction(status),
          });
        } else {
          next.delete(key);
        }
        return next;
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

        <WorkflowSection
          workflow={state.workflow}
          selected={selected}
          onToggle={toggleSelection}
        />
        <SkillsSection
          skills={state.skills}
          selected={selected}
          onToggle={toggleSelection}
        />
        <RecommendedSkillsSection
          recommendedSkills={state.recommendedSkills}
          selected={selected}
          onToggle={toggleSelection}
        />
        <PluginsSection
          plugins={state.plugins}
          selected={selected}
          onToggle={toggleSelection}
        />
        <HooksSection
          hooks={state.hooks}
          selected={selected}
          onToggle={toggleSelection}
        />
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
    <CategorySection title="Workflow" testId="section-workflow">
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
}

function SkillsSection({
  skills,
  selected,
  onToggle,
}: SkillsSectionProps): JSX.Element | null {
  if (skills.length === 0) return null;
  return (
    <CategorySection title="Skills" testId="section-skills">
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
}

function RecommendedSkillsSection({
  recommendedSkills,
  selected,
  onToggle,
}: RecommendedSkillsSectionProps): JSX.Element | null {
  if (recommendedSkills.length === 0) return null;
  return (
    <CategorySection
      title="Recommended Skills"
      testId="section-recommended-skills"
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
}

function PluginsSection({
  plugins,
  selected,
  onToggle,
}: PluginsSectionProps): JSX.Element | null {
  if (plugins.length === 0) return null;
  return (
    <CategorySection title="Plugins" testId="section-plugins">
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
}

function HooksSection({
  hooks,
  selected,
  onToggle,
}: HooksSectionProps): JSX.Element | null {
  if (hooks.length === 0) return null;
  return (
    <CategorySection title="Hooks" testId="section-hooks">
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
