import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import matter from "gray-matter";

const repoRoot = path.resolve(new URL(".", import.meta.url).pathname, "..", "..");
const pluginRoot = path.join(repoRoot, "plugins", "quality-gate-scaffolder");

const skillNames = [
  "scaffold-swift-ios-quality-gates",
  "scaffold-kotlin-android-quality-gates",
  "scaffold-python-backend-quality-gates",
  "scaffold-typescript-frontend-quality-gates",
  "scaffold-node-tool-quality-gates",
];

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf-8");
}

function readJson<T>(rel: string): T {
  return JSON.parse(read(rel)) as T;
}

function markdownReferences(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    refs.add(match[1]);
  }
  for (const match of text.matchAll(/`([^`\n]+\.md)`/g)) {
    refs.add(match[1]);
  }
  return [...refs].filter(
    (ref) => !ref.startsWith("#") && !/^[a-z][a-z0-9+.-]*:/i.test(ref),
  );
}

describe("quality-gate-scaffolder 插件契约", () => {
  test("同时注册到 Codex 和 Claude Code marketplace", () => {
    const codexManifest = readJson<{
      name: string;
      skills?: string;
      interface?: { shortDescription?: string };
    }>("plugins/quality-gate-scaffolder/.codex-plugin/plugin.json");
    assert.equal(codexManifest.name, "quality-gate-scaffolder");
    assert.equal(codexManifest.skills, "./skills/");
    assert.match(codexManifest.interface?.shortDescription ?? "", /质量门禁/);

    const codexMarketplace = readJson<{
      plugins: Array<{ name: string; source: { path: string } }>;
    }>(".agents/plugins/marketplace.json");
    assert.ok(
      codexMarketplace.plugins.some(
        (plugin) =>
          plugin.name === "quality-gate-scaffolder" &&
          plugin.source.path === "./plugins/quality-gate-scaffolder",
      ),
      "Codex marketplace 必须把 quality-gate-scaffolder 暴露为本地插件",
    );

    const claudeManifest = readJson<{ name: string }>(
      "plugins/quality-gate-scaffolder/.claude-plugin/plugin.json",
    );
    assert.equal(claudeManifest.name, "quality-gate-scaffolder");

    const claudeMarketplace = readJson<{
      plugins: Array<{ name: string; source: string }>;
    }>(".claude-plugin/marketplace.json");
    assert.ok(
      claudeMarketplace.plugins.some(
        (plugin) =>
          plugin.name === "quality-gate-scaffolder" &&
          plugin.source === "./plugins/quality-gate-scaffolder",
      ),
      "Claude marketplace 必须把 quality-gate-scaffolder 暴露为本地插件",
    );
  });

  test("每个受支持技术栈都有一个脚手架技能", () => {
    for (const skillName of skillNames) {
      const skillPath = path.join(pluginRoot, "skills", skillName, "SKILL.md");
      assert.ok(fs.existsSync(skillPath), `${skillName} 必须有 SKILL.md`);

      const raw = fs.readFileSync(skillPath, "utf-8");
      const parsed = matter(raw);
      assert.equal(parsed.data.name, skillName);
      assert.match(parsed.data.description as string, /质量门禁/);

      const body = parsed.content;
      for (const anchor of [
        "第一层：检查工具",
        "第二层：检查规则",
        "第三层：调用时机",
        "confirmation-before-write",
        "../references/three-layer-model.md",
        "../references/landing-safety.md",
        "../references/github-review-and-rulesets.md",
        "../references/invocation-examples.md",
        "../references/gate-levels-and-template.md",
        "references/platform-quality-gates.md",
        "references/concrete-rules.md",
        "不要只凭记忆补规则",
        "不要替用户决定档位",
      ]) {
        assert.ok(body.includes(anchor), `${skillName} 必须包含 ${anchor}`);
      }
      assert.doesNotMatch(
        body,
        /plugins\/quality-gate-scaffolder\//,
        `${skillName} 不应使用基于仓库根的插件路径`,
      );
      assert.doesNotMatch(
        body,
        /skills\/references\//,
        `${skillName} 不应使用非相对的 skills/references 路径`,
      );
    }
  });

  test("共享参考和平台参考保留来源项目证据", () => {
    for (const rel of [
      "three-layer-model.md",
      "landing-safety.md",
      "github-review-and-rulesets.md",
      "invocation-examples.md",
      "gate-levels-and-template.md",
    ]) {
      const reference = path.join(pluginRoot, "skills", "references", rel);
      assert.ok(fs.existsSync(reference), `${reference} 必须存在`);
    }

    const evidenceBySkill: Record<string, string[]> = {
      "scaffold-swift-ios-quality-gates": ["CurioSea-iOS", "check-ios-affected.swift"],
      "scaffold-kotlin-android-quality-gates": [
        "CurioSea-Android",
        "check-affected-android-quality.sh",
      ],
      "scaffold-python-backend-quality-gates": ["lingolens/backend", "run_gates.sh"],
      "scaffold-typescript-frontend-quality-gates": ["lingolens", "Biome", "Vitest"],
      "scaffold-node-tool-quality-gates": ["lark-connect", "node --test"],
    };

    for (const [skillName, anchors] of Object.entries(evidenceBySkill)) {
      const reference = path.join(
        pluginRoot,
        "skills",
        skillName,
        "references",
        "platform-quality-gates.md",
      );
      assert.ok(fs.existsSync(reference), `${skillName} 必须随附 platform-quality-gates.md`);
      const text = fs.readFileSync(reference, "utf-8");
      for (const anchor of [
        "## 第一层：工具选型和版本策略",
        "## 第二层：现有规则配置参考",
        "## 具体规则文件",
        "## 第三层：触发时机建议",
        "## 示例",
      ]) {
        assert.ok(text.includes(anchor), `${skillName} 参考文档必须包含 ${anchor}`);
      }
      for (const anchor of anchors) {
        assert.ok(text.includes(anchor), `${skillName} 参考文档必须包含 ${anchor}`);
      }
    }
  });

  test("技能入口和平台总览中的相对 Markdown 引用都能从所在文件解析", () => {
    for (const skillName of skillNames) {
      for (const file of [
        path.join(pluginRoot, "skills", skillName, "SKILL.md"),
        path.join(pluginRoot, "skills", skillName, "references", "platform-quality-gates.md"),
      ]) {
        const text = fs.readFileSync(file, "utf-8");
        for (const ref of markdownReferences(text)) {
          if (path.basename(file) === "SKILL.md" && !ref.includes("/")) {
            continue;
          }
          const [refPath] = ref.split("#", 1);
          const resolved = path.resolve(path.dirname(file), refPath);
          assert.ok(
            fs.existsSync(resolved),
            `${path.relative(repoRoot, file)} 引用了不存在的相对文档 ${ref}`,
          );
        }
      }
    }
  });

  test("远端 GitHub 写操作必须保留二次确认安全契约", () => {
    const safety = fs.readFileSync(
      path.join(pluginRoot, "skills", "references", "landing-safety.md"),
      "utf-8",
    );
    for (const anchor of [
      "远端 GitHub 写操作",
      "第二次明确确认",
      "ruleset",
      "branch protection",
      "required status check",
    ]) {
      assert.ok(safety.includes(anchor), `landing-safety.md 必须包含 ${anchor}`);
    }
  });

  test("共享调用示例保持通用,具体规则下沉到独立文件", () => {
    const shared = fs.readFileSync(
      path.join(pluginRoot, "skills", "references", "invocation-examples.md"),
      "utf-8",
    );
    assert.ok(shared.length < 3600, "共享 invocation examples 应保持短小,避免堆平台细节");
    assert.doesNotMatch(
      shared,
      /Ruff|Mypy|Import Linter|SwiftLint|Detekt|Biome|ESLint|Vitest|Gradle|ktlint|xcodebuild|uv run|npm run/,
      "共享 invocation examples 不应包含平台专属工具或命令",
    );

    const concreteAnchorsBySkill: Record<string, string[]> = {
      "scaffold-swift-ios-quality-gates": [
        "## 官方文档入口",
        "https://github.com/realm/SwiftLint",
        "https://realm.github.io/SwiftLint/rule-directory.html",
        "https://github.com/swiftlang/swift-format",
        "## SwiftLint 规则清单",
        "localized_swiftui_literal",
        "force_unwrapping",
        "capture_variable",
      ],
      "scaffold-kotlin-android-quality-gates": [
        "## 官方文档入口",
        "https://detekt.dev/docs/intro/",
        "https://developer.android.com/studio/write/lint",
        "https://docs.gradle.org/current/userguide/version_catalogs.html",
        "## Detekt 规则清单",
        "GlobalCoroutineUsage",
        "ModifierMissing",
        "ForbiddenImport",
      ],
      "scaffold-python-backend-quality-gates": [
        "## 官方文档入口",
        "https://docs.astral.sh/ruff/rules/",
        "https://mypy.readthedocs.io/en/stable/config_file.html",
        "https://import-linter.readthedocs.io/",
        "## Ruff 规则清单",
        "E/W/F/I/N/UP/B/A/C4/SIM/PTH/TID/ARG/RUF/PLE/PLW/ASYNC/S",
        "api ⊥ worker",
        "gate_provider_egress_guard",
      ],
      "scaffold-typescript-frontend-quality-gates": [
        "## 官方文档入口",
        "https://biomejs.dev/linter/",
        "https://eslint.org/docs/latest/rules/",
        "https://typescript-eslint.io/rules/",
        "## Biome 规则清单",
        "useExhaustiveDependencies",
        "no-restricted-imports",
        "gateLintConfig.test.ts",
      ],
      "scaffold-node-tool-quality-gates": [
        "## 官方文档入口",
        "https://nodejs.org/api/test.html",
        "https://docs.npmjs.com/files/package.json/",
        "https://docs.npmjs.com/cli/v11/commands/npm-pack/",
        "## 命令行入口规则",
        "quality gate package contract",
        "process.exit",
        "appSecret",
      ],
    };

    for (const [skillName, anchors] of Object.entries(concreteAnchorsBySkill)) {
      const rulesReference = path.join(
        pluginRoot,
        "skills",
        skillName,
        "references",
        "concrete-rules.md",
      );
      assert.ok(fs.existsSync(rulesReference), `${skillName} 必须随附 concrete-rules.md`);
      const text = fs.readFileSync(rulesReference, "utf-8");
      assert.ok(text.length > 2400, `${skillName} concrete-rules.md 应包含详细规则清单`);
      const overview = fs.readFileSync(
        path.join(pluginRoot, "skills", skillName, "references", "platform-quality-gates.md"),
        "utf-8",
      );
      for (const anchor of anchors) {
        assert.ok(text.includes(anchor), `${skillName} concrete-rules.md 必须包含 ${anchor}`);
        assert.ok(
          !overview.includes(anchor),
          `${skillName} platform-quality-gates.md 不应承载具体规则 ${anchor}`,
        );
      }
    }
  });

  test("共享分级表和最终脚手架模板把决策权交给用户", () => {
    const shared = fs.readFileSync(
      path.join(pluginRoot, "skills", "references", "gate-levels-and-template.md"),
      "utf-8",
    );
    for (const anchor of [
      "## 门禁分级参考表",
      "AGENTS.md 软约束",
      "本地 git hook + planner",
      "PR 持续集成",
      "## 最终脚手架建议模板",
      "最终决策权属于用户",
      "不要替用户决定档位",
      "## 用户确认问题",
    ]) {
      assert.ok(shared.includes(anchor), `gate-levels-and-template.md 必须包含 ${anchor}`);
    }
  });

  test("仓库主测试入口保留既有测试并追加插件契约测试", () => {
    const pkg = readJson<{ scripts: { test: string; "test:watch": string } }>("package.json");
    for (const scriptName of ["test", "test:watch"] as const) {
      assert.match(
        pkg.scripts[scriptName],
        /dist-test\/tests\/apply-handlers\.test\.js/,
        `${scriptName} 必须继续运行 apply-handlers.test.js`,
      );
      assert.match(
        pkg.scripts[scriptName],
        /dist-test\/tests\/quality-gate-scaffolder-plugin\.test\.js/,
        `${scriptName} 必须运行 quality-gate-scaffolder-plugin.test.js`,
      );
    }
  });
});
