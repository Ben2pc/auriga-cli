import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LEGACY_MENU_CHOICES } from "../src/cli.js";
import { excludeByName } from "../src/plugins.js";

// ===========================================================================
// TUI 三项菜单重构 —— 追溯 VAL-TUI-001 / 002 / 005。
//
// VAL-TUI-001/002 是「菜单选项集合」契约,断言对象是模块级常量
// `LEGACY_MENU_CHOICES`(无需驱动 inquirer)。
// VAL-TUI-005 是「其他插件」子选择排除 auriga-workflow,断言对象是
// 纯函数 `excludeByName`。
// VAL-TUI-003/004(下钻语义)是 runLegacyMenu 内的 value → installer
// 路由,属构造即正确,这里不重复断言。
// ===========================================================================

describe("LEGACY_MENU_CHOICES — TUI 菜单契约", () => {
  // VAL-TUI-001
  test("菜单恰好提供 3 个选项:preset / recommended / plugins", () => {
    assert.equal(LEGACY_MENU_CHOICES.length, 3);
    assert.deepEqual(
      LEGACY_MENU_CHOICES.map((c) => c.value),
      ["preset", "recommended", "plugins"],
      "菜单选项集合与顺序应为 推荐预设 → 选装 skill → 其他插件",
    );
  });

  // VAL-TUI-001:不含已被吸收 / 移除的旧类目独立项。
  test("菜单不含 workflow / skills / hooks 独立项", () => {
    const values = LEGACY_MENU_CHOICES.map((c) => c.value);
    for (const gone of ["workflow", "skills", "hooks"]) {
      assert.ok(!values.includes(gone as never), `不应再有独立的 ${gone} 项`);
    }
  });

  // VAL-TUI-002
  test("「推荐预设」居首且默认勾选", () => {
    const first = LEGACY_MENU_CHOICES[0];
    assert.equal(first.value, "preset");
    assert.equal(first.checked, true);
  });

  // VAL-TUI-002
  test("「选装 skill」「其他插件」默认不勾选", () => {
    for (const value of ["recommended", "plugins"]) {
      const choice = LEGACY_MENU_CHOICES.find((c) => c.value === value);
      assert.ok(choice, `菜单应含 ${value} 项`);
      assert.equal(choice.checked, false, `${value} 默认不应勾选`);
    }
  });

  // VAL-TUI-002:预设项标签向用户标明静默采用的默认参数。
  test("「推荐预设」标签标明 scope / agent / lang 默认值", () => {
    const label = LEGACY_MENU_CHOICES[0].name;
    assert.match(label, /user/);
    assert.match(label, /both/);
    assert.match(label, /en/);
  });
});

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

  // VAL-TUI-005:保持原顺序。
  test("排除后保留原有顺序", () => {
    const result = excludeByName(plugins, ["skill-creator"]);
    assert.deepEqual(
      result.map((p) => p.name),
      ["auriga-workflow", "auriga-notify", "codex"],
    );
  });

  // boundary —— 空 / undefined 排除集是 no-op。
  test("undefined 排除集原样返回", () => {
    assert.deepEqual(excludeByName(plugins, undefined), plugins);
  });
  test("空数组排除集原样返回", () => {
    assert.deepEqual(excludeByName(plugins, []), plugins);
  });

  // boundary —— 排除一个不存在的名字不影响结果。
  test("排除不存在的插件名是 no-op", () => {
    const result = excludeByName(plugins, ["does-not-exist"]);
    assert.equal(result.length, plugins.length);
  });

  // boundary —— 全部排除得到空集。
  test("排除全部插件名得到空集", () => {
    const result = excludeByName(plugins, plugins.map((p) => p.name));
    assert.equal(result.length, 0);
  });
});
