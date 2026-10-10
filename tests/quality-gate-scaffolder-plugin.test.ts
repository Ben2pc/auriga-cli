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
  test("Codex manifest 声明技能容器", () => {
    const codexManifest = readJson<{ skills?: string }>(
      "plugins/quality-gate-scaffolder/.codex-plugin/plugin.json",
    );
    assert.equal(codexManifest.skills, "./skills/");
  });

  test("每个受支持技术栈都有一个脚手架技能", () => {
    for (const skillName of skillNames) {
      const skillPath = path.join(pluginRoot, "skills", skillName, "SKILL.md");
      assert.ok(fs.existsSync(skillPath), `${skillName} 必须有 SKILL.md`);

      const raw = fs.readFileSync(skillPath, "utf-8");
      const parsed = matter(raw);
      assert.equal(parsed.data.name, skillName);

      const body = parsed.content;
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
});
