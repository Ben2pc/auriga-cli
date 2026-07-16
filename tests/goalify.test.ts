import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Compiled test lives at dist-test/tests/goalify.test.js; ../.. = repo root.
const repoRoot = path.resolve(
  new URL(".", import.meta.url).pathname,
  "..",
  "..",
);

function readSkill(): string {
  return fs.readFileSync(
    path.join(repoRoot, "plugins/auriga-workflow/skills/goalify/SKILL.md"),
    "utf-8",
  );
}

describe("goalify skill contract", () => {
  test("accepts formal and conversational sources without bypassing architecture approval", () => {
    const text = readSkill();

    assert.match(text, /只在用户明确要求或选择自主运行时使用/);
    assert.ok(text.includes("spec.md") && text.includes("validation-contract.md"));
    assert.match(text, /不要求任务必须有正式规格/);
    assert.match(text, /对话、问题单、当前分支、提交历史和拉取请求正文/);
    assert.match(text, /自主运行不能批准或绕过架构确认门禁/);
    assert.match(text, /实质性架构决定，停止并交回用户/);
  });

  test("keeps the goal compact and delegates implementation planning", () => {
    const text = readSkill();
    const contractSection = text.match(/## 组织目标[\s\S]*?## 确定终点/);
    assert.ok(contractSection, "goalify must document the compact goal contract");
    const contract = contractSection[0];
    let previousIndex = -1;

    for (const section of [
      "**目标**",
      "**权威事实与约束**",
      "**终点与停止条件**",
      "**交接**",
    ]) {
      const sectionIndex = contract.indexOf(section);
      assert.notEqual(sectionIndex, -1, `goal contract must include ${section}`);
      assert.ok(sectionIndex > previousIndex, `goal contract must keep ${section} in order`);
      previousIndex = sectionIndex;
    }

    assert.match(text, /基于当前任务状态推进，不假设必须重新从默认分支开始/);
    assert.match(text, /不要在目标里硬编切片、复制现有事实正文或预判评审发现/);
    assert.doesNotMatch(text, /从 main 建分支/);
    assert.doesNotMatch(text, /先做切片 1/);
    assert.doesNotMatch(text, /deep-review 将发现/);
    assert.ok(text.includes("incremental-impl"));
  });

  test("uses an explicit endpoint and preserves deep-review convergence", () => {
    const text = readSkill();
    const endpointSection = text.match(/## 确定终点[\s\S]*?## 启动与交接/);
    assert.ok(endpointSection, "goalify must document endpoint selection");
    const endpoints = endpointSection[0];

    assert.match(endpoints, /用户已经明确终点时直接采用，不重复询问/);
    assert.match(
      endpoints,
      /没有说明跑到哪里，或自定义终点缺少可验证的停止条件时，再询问/,
    );
    assert.ok(endpoints.includes("PR Ready"));
    assert.ok(endpoints.includes("深度评审收敛"));
    assert.ok(endpoints.includes("合并"));
    assert.ok(endpoints.includes("自定义终点"));
    assert.match(endpoints, /最近一轮深度评审没有阻塞项/);
    assert.match(endpoints, /所有拉取请求检查通过/);
    assert.match(endpoints, /没有未解决的阻塞性评审意见/);
    assert.match(endpoints, /明确授权为达成收敛而再次运行深度评审/);
    assert.match(endpoints, /只有用户明确授权合并时才能采用/);
  });

  test("dispatches according to runtime capability and requires a bounded handoff", () => {
    const text = readSkill();

    assert.ok(text.includes("Codex") && text.includes("Claude Code"));
    assert.match(text, /Codex 暴露目标启动能力时，直接设置并启动目标/);
    assert.match(text, /Claude Code 通常输出可粘贴到 `\/goal` 的文本/);
    assert.match(text, /不假装已经操作其交互界面/);
    assert.match(text, /到达终点或触发停止条件后立即交接/);
    assert.match(text, /完成内容、验收方式、剩余风险和用户下一步可以做什么/);
  });
});
