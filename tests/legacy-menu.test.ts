import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { excludeByName } from "../src/plugins.js";

// ===========================================================================
// TUI 菜单 —— 追溯 VAL-TUI-005:「其他插件」子选择排除 auriga-workflow,
// 断言对象是纯函数 `excludeByName`。
// ===========================================================================

describe("excludeByName — 「其他插件」子选择排除", () => {
  const plugins = [
    { name: "auriga-workflow" },
    { name: "auriga-notify" },
    { name: "skill-creator" },
    { name: "codex" },
  ];

  // VAL-TUI-005
  test("排除 auriga-workflow 后余下其它全部插件", () => {
    const result = excludeByName(plugins, ["auriga-workflow"]);
    assert.deepEqual(
      result.map((p) => p.name),
      ["auriga-notify", "skill-creator", "codex"],
      "结果应为全部插件去掉 auriga-workflow 的余集",
    );
  });

  // boundary —— 空 / undefined 排除集是 no-op。
  test("undefined 排除集原样返回", () => {
    assert.deepEqual(excludeByName(plugins, undefined), plugins);
  });
});
