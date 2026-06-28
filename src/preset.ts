// src/preset.ts
//
// installPreset —— 「推荐预设安装」的单一编排入口。
//
// 预设由三部分组成,按下面的顺序安装:
//   1. workflow 文档 (AGENTS.md + CLAUDE.md 兼容软链)
//   2. 工作流 skill (WORKFLOW_SKILLS 全集 —— installSkills 自身已限定)
//   3. auriga-workflow 插件
//
// CLI 的 `--preset`、`--preset-plugins-skills`、TUI 的「推荐预设」、
// Web UI 的一键按钮都从这里取预设成员,因此「预设由什么构成」只有这一处真相。
//
// installPreset 返回逐步成败摘要 (PresetStepResult[]):
//   - CLI 用它计算分级退出码(全成功 0 / 部分或全部失败 2),与 runAll
//     的 graded-exit 语义对齐;
//   - TUI / Web UI 忽略该摘要 —— 各自走 log-and-continue / 流式进度。
//
// 三个 installer 经动态 import 引入而非静态 import:这样 preset.ts 是一个
// 零重依赖的薄编排层 —— 只想读 PRESET_PLUGINS 常量的调用方(参数校验、
// 帮助文案)不会被迫拉入 plugins.ts 这张大依赖图;installer 模块也只在
// installPreset 真正被调用时才进入模块图。

import type { InstallOpts, PluginAgent } from "./utils.js";

/**
 * 预设安装的插件成员 —— 固定只装 auriga-workflow。
 * installPlugins 的 `selected` 过滤把安装面收敛到这一个插件。
 * `as const` 冻结这个「单一真相」常量,调用方无法 .push() 篡改它。
 */
export const PRESET_PLUGINS = ["auriga-workflow"] as const;

/**
 * installPreset 的输入。三个默认值(scope=user / agent=both / lang=zh-CN)
 * 与分类安装不同,由调用方负责落定后再传入 —— 预设的默认不在本函数内
 * 兜底,使「默认值是什么」对每个调用端都显式可见。
 */
export interface PresetOpts {
  scope: "project" | "user";
  agent: PluginAgent;
  lang: string;
  /** workflow 文档的安装目标目录;缺省即 installer 自身的 cwd 默认。 */
  cwd?: string;
  /** false = 非交互(CLI / Web UI),installer 在失败处抛错;
   *  true  = 交互(TUI),installer log-and-continue。 */
  interactive: boolean;
  /** 逐行进度回调 —— Web UI 的 SSE 流式输出用。 */
  onLog?: (line: string, stream: "stdout" | "stderr") => void;
}

/** 预设安装中单个步骤的成败。 */
export interface PresetStepResult {
  category: "workflow" | "skills" | "plugins";
  ok: boolean;
  /** ok === false 时携带失败原因。 */
  err?: string;
}

/** 预设的安装顺序:文档 → skill → 插件。 */
const PRESET_STEPS: readonly PresetStepResult["category"][] = [
  "workflow",
  "skills",
  "plugins",
] as const;

/**
 * 按 workflow → skills → plugins 顺序执行预设安装。
 *
 * 每一步独立 try/catch:一步失败不阻断后续步骤(与 runAll 的
 * log-and-continue 一致),逐步成败汇总后返回给调用方。
 */
export async function installPreset(
  packageRoot: string,
  opts: PresetOpts,
): Promise<PresetStepResult[]> {
  return installPresetSteps(PRESET_STEPS, packageRoot, opts);
}

/**
 * 安装 `--preset` 中除 workflow 文档以外的成员。
 *
 * 用于已经手工维护 AGENTS.md / CLAUDE.md、但仍想拿到预设 skills 和
 * auriga-workflow 插件的项目。
 */
export async function installPresetPluginsSkills(
  packageRoot: string,
  opts: Omit<PresetOpts, "lang">,
): Promise<PresetStepResult[]> {
  return installPresetSteps(["skills", "plugins"], packageRoot, {
    ...opts,
    lang: "",
  });
}

async function installPresetSteps(
  steps: readonly PresetStepResult["category"][],
  packageRoot: string,
  opts: PresetOpts,
): Promise<PresetStepResult[]> {
  const results: PresetStepResult[] = [];
  for (const category of steps) {
    try {
      await runPresetStep(category, packageRoot, opts);
      results.push({ category, ok: true });
    } catch (e) {
      results.push({ category, ok: false, err: (e as Error).message });
    }
  }
  return results;
}

async function runPresetStep(
  category: PresetStepResult["category"],
  packageRoot: string,
  opts: PresetOpts,
): Promise<void> {
  // scope / agent / lang 一并透传给每个 installer —— installer 各取所需
  // (workflow 只用 lang/cwd,skills/plugins 只用 scope/agent),用不到的
  // 字段被忽略。
  const base: InstallOpts = {
    interactive: opts.interactive,
    scope: opts.scope,
    agent: opts.agent,
    lang: opts.lang,
    cwd: opts.cwd,
    onLog: opts.onLog,
  };
  switch (category) {
    case "workflow": {
      const { installWorkflow } = await import("./workflow.js");
      return installWorkflow(packageRoot, base);
    }
    case "skills": {
      // installSkills 内部已把安装范围限定到 WORKFLOW_SKILLS 全集 ——
      // 不传 selected 即安装这组工作流 skill,无需在此重复列举。
      const { installSkills } = await import("./skills.js");
      return installSkills(packageRoot, base);
    }
    case "plugins": {
      const { installPlugins } = await import("./plugins.js");
      return installPlugins(packageRoot, {
        ...base,
        selected: [...PRESET_PLUGINS],
      });
    }
  }
}
