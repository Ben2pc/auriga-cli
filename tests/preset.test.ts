import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";

import { parseArgs } from "../src/cli.js";

// ===========================================================================
// 失败测试 (TDD 红阶段) —— `--preset` 行为簇,追溯 VAL-CLI-001 ~ VAL-CLI-009。
//
// 范围说明:VAL-CLI-001 ~ 009 在 validation-contract.md 中标注的工具是
// `e2e-cli`(真实落盘端到端)。真实落盘断言归属网络态独立套件
// tests/e2e-install.test.ts。本文件覆盖同一批 VAL 的**密封可验证契约面**:
//   - 解析层 (`parseArgs` 返回结构 / 参数互斥拒绝) —— 纯逻辑,unit 测试。
//   - 分发层 (`main` 在 installer 边界 mock,断言传给各 installer 的 opts、
//     退出码、stderr) —— 跨边界但无网络无真实安装,integration 测试。
// 二者合起来锁定 `--preset` 的可观察行为契约,真实磁盘副作用交给 e2e 套件。
//
// ----- 顶部假设(无法从只读文件验证,实现时必须满足,否则本文件不被执行)-----
// 假设 1:实现 Agent 会把编译产物 `dist-test/tests/preset.test.js` 加入
//         `package.json` 的 `test` 与 `test:watch` 脚本文件列表。`npm test`
//         跑的是显式白名单,不是目录扫描;不加列表则本文件永不被跑到。
// 假设 2:`--preset` 实现后,`parseArgs(["install","--preset", ...])` 返回的
//         `install` 对象用一个布尔字段 `preset` 表达「这是预设安装」。本文件
//         以 `install.preset === true` 断言。若实现选用别的字段名(如
//         `mode:"preset"`),本文件解析层断言需同步改字段名——但行为契约
//         (互斥拒绝、默认值、覆盖)不变。
// 假设 3:`--preset` 的三个默认值按 spec §1:scope=user、agent=both、lang=en。
//         分发层测试断言这三个默认值最终出现在传给 installer 的 opts 上。
// 假设 4:`--preset` 安装覆盖三类成员:workflow 文档、`auriga-workflow` 插件、
//         5 个 WORKFLOW_SKILLS。分发层以「这三个 installer 各被调用恰一次、
//         且未触达 recommended installer」断言成员集合。
// 假设 5:`--preset` 与 `--all` 一样具备分级退出码:全成功 exit 0、致命
//         错误 exit 1、部分类别失败 exit 2 且 stderr 列出失败类别。
// 假设 6:`install-nontty.test.ts` 的 `importMain` mock 形态在本特性落地后
//         仍可用(mock.module 覆盖 workflow/skills/plugins/recommended 四个
//         installer 的 named export)。`installRecommendedSkills` 当前在
//         skills.js 中导出,本文件为分发层 mock 增加对它的覆盖。
// ===========================================================================

function installArgs(argv: string[]) {
  return parseArgs(["install", ...argv]);
}

function expectParseError(argv: string[], pattern: RegExp): void {
  assert.throws(() => parseArgs(argv), pattern);
}

// 互斥/原子约束类断言的专用 helper。
//
// 为什么不能直接 `assert.throws(..., /preset/i)`:今天 parseArgs 遇到
// `--preset` 会立即抛 generic `unknown argument '--preset'.` —— 该文案恰好
// 含 "preset" 子串,会让一条只匹配 /preset/i 的「互斥被拒绝」测试 fake-green
// (它「通过」是因为标志根本不存在,而非因为特性正确拒绝了非法组合)。
//
// 真正的红:今天必须因「`--preset` 不被识别」失败 —— 即抛出的恰恰是 generic
// unknown-argument 错误。特性正确实现后 `--preset` 被识别为有效标志,generic
// unknown-argument 不再可能命中;此时该组合必须仍被拒绝,但错误文案必须是
// 一条「针对该非法组合」的专门信息(不再是 generic unknown-argument)。
// 因此这里断言:① 确实抛错;② 错误文案 **不是** generic unknown-argument。
const GENERIC_UNKNOWN_ARG_RE = /^unknown argument /i;

function expectAtomicConflictRejected(argv: string[], note: string): void {
  let err: Error | undefined;
  assert.throws(
    () => parseArgs(argv),
    (e: unknown) => {
      err = e as Error;
      return e instanceof Error;
    },
    note,
  );
  assert.doesNotMatch(
    err!.message,
    GENERIC_UNKNOWN_ARG_RE,
    `${note} —— 必须是针对该非法组合的专门错误,而非 generic 'unknown argument'(后者意味着 --preset 根本没被识别)`,
  );
}

// ---------------------------------------------------------------------------
// Part A —— 解析层 (unit):直接调 parseArgs,断言返回结构与互斥拒绝。
// ---------------------------------------------------------------------------
describe("parseArgs --preset 解析契约", () => {
  // VAL-CLI-001 / VAL-CLI-002 / VAL-CLI-003 / VAL-CLI-004
  // rationale: `--preset` 不带任何修饰标志时必须被识别为预设安装。今天
  // parseArgs 对 `--preset` 抛 "unknown argument" —— 这条会先抓到「标志
  // 完全不存在」的回归;实现后还要保证它不被误并入 `--all` 等其它分支。
  test("空白 --preset 解析为预设安装(不报 unknown argument)", () => {
    const parsed = installArgs(["--preset"]);
    assert.equal(parsed.command, "install");
    assert.equal(
      (parsed as { install: { preset?: boolean } }).install.preset,
      true,
    );
  });

  // VAL-CLI-002 / VAL-CLI-003 / VAL-CLI-004
  // rationale: 三个默认值是 `--preset` 与分类安装的核心差异点。spec §1 明确
  // 默认 scope=user / agent=both / lang=en。这条断言「不带修饰标志时解析
  // 结果不会携带与默认相矛盾的显式值」—— 即默认值要么在解析层落定、要么
  // 留空给分发层兜底,但绝不能解析成 project/claude(分类安装的默认)。
  // 用属性断言:scope 不得为 "project"、agent 不得为 "claude"。
  test("空白 --preset 不会解析出分类安装的默认值 (project / claude)", () => {
    const { install } = installArgs(["--preset"]) as {
      install: { scope?: string; agent?: string };
    };
    assert.notEqual(install.scope, "project");
    assert.notEqual(install.agent, "claude");
  });

  // VAL-CLI-005
  // rationale: `--preset` 必须接受 --scope/--agent/--lang 覆盖。若实现把
  // `--preset` 做成纯原子标志、连这三个修饰标志都拒绝,这条会抓到。
  test("--preset 接受 --scope / --agent / --lang 显式覆盖", () => {
    const { install } = installArgs([
      "--preset",
      "--scope",
      "project",
      "--agent",
      "claude",
      "--lang",
      "zh-CN",
    ]) as {
      install: { preset?: boolean; scope?: string; agent?: string; lang?: string };
    };
    assert.equal(install.preset, true);
    assert.equal(install.scope, "project");
    assert.equal(install.agent, "claude");
    assert.equal(install.lang, "zh-CN");
  });

  // VAL-CLI-005
  // rationale: 等号形式是既有 CLI 约定 (readSingleValue)。`--preset` 的修饰
  // 标志必须同样支持 `--scope=user` 等号形式,否则与现有标志行为不一致。
  test("--preset 的修饰标志支持 --flag=value 等号形式", () => {
    const { install } = installArgs([
      "--preset",
      "--scope=user",
      "--agent=both",
      "--lang=en",
    ]) as {
      install: { preset?: boolean; scope?: string; agent?: string; lang?: string };
    };
    assert.equal(install.preset, true);
    assert.equal(install.scope, "user");
    assert.equal(install.agent, "both");
    assert.equal(install.lang, "en");
  });

  // VAL-CLI-005 (boundary —— 非法值)
  // rationale: 覆盖标志的值校验必须复用既有校验器。非法 scope/agent/lang
  // 必须 fail-fast,否则非法值会一路透传到 installer 造成晦涩失败。
  test("--preset 带非法 --scope 值被拒绝", () => {
    expectParseError(["install", "--preset", "--scope", "team"], /scope/i);
  });
  test("--preset 带非法 --agent 值被拒绝", () => {
    expectParseError(
      ["install", "--preset", "--agent", "nobody"],
      /unknown --agent value/i,
    );
  });
  test("--preset 带非法 --lang 值被拒绝", () => {
    expectParseError(
      ["install", "--preset", "--lang", "xx"],
      /en.*zh-CN|zh-CN.*en|unknown language/i,
    );
  });

  // VAL-CLI-006 (error)
  // rationale: `--preset` 是原子标志,不能与位置参数 `<type>` 同时出现。
  // 用属性断言遍历全部四类 type。断言走 expectAtomicConflictRejected ——
  // 今天会因 generic "unknown argument '--preset'" 而红(--preset 未被
  // 识别);特性实现后 --preset 有效,该组合必须仍以专门互斥错误被拒绝。
  test("--preset 与任一 <type> 位置参数同时出现被拒绝 (exit-path: 解析报错)", () => {
    for (const type of ["workflow", "skills", "recommended", "plugins"]) {
      expectAtomicConflictRejected(
        ["install", "--preset", type],
        `--preset 与 '${type}' 共用应报参数互斥错误`,
      );
    }
  });
  // 顺序无关:type 在前、--preset 在后同样必须被拒绝。
  test("--preset 与 <type> 顺序颠倒同样被拒绝", () => {
    for (const type of ["workflow", "skills", "recommended", "plugins"]) {
      expectAtomicConflictRejected(
        ["install", type, "--preset"],
        `'${type}' 在前、--preset 在后同样应报错`,
      );
    }
  });

  // VAL-CLI-007 (error)
  // rationale: `--preset` 不能与任一子项过滤标志同时出现。这是 spec §1
  // 明确的原子约束。遍历三个过滤标志,保证覆盖完整而非样例。
  test("--preset 与任一子项过滤标志同时出现被拒绝", () => {
    const cases: [string, string][] = [
      ["--skill", "systematic-debugging"],
      ["--plugin", "auriga-workflow"],
      ["--recommended-skill", "codex-agent"],
    ];
    for (const [flag, value] of cases) {
      expectAtomicConflictRejected(
        ["install", "--preset", flag, value],
        `--preset 与 ${flag} 共用应报参数互斥错误`,
      );
    }
  });

  // VAL-CLI-006 / VAL-CLI-007 边界:--preset 与 --all 同时出现。
  // rationale: spec "--preset 与 --all 仍是各自原子" —— 两个原子标志不能
  // 叠加。同时给出二者必须 fail-fast,且因 --all 已是已知标志,该组合的
  // 错误必须是专门互斥文案,不能是 generic unknown-argument。
  test("--preset 与 --all 同时出现被拒绝", () => {
    expectAtomicConflictRejected(
      ["install", "--preset", "--all"],
      "--preset 与 --all 共用应报原子互斥错误",
    );
    expectAtomicConflictRejected(
      ["install", "--all", "--preset"],
      "--all 与 --preset 共用应报原子互斥错误",
    );
  });

  // VAL-CLI-005 (boundary —— 等号空值)
  // rationale: `--preset` 是布尔标志,不取值;`--preset=` 等号形式无意义。
  // 实现必须**主动拒绝**它(而非静默接受空字符串值或静默成功)。
  // 这条今天因 `--preset` 整体未被识别而红 —— expectAtomicConflictRejected
  // 要求错误不是 generic unknown-argument,所以「今天抛 unknown」会令断言
  // 失败(真红);实现后 `--preset=` 必须抛一条专门的「不取值」错误。
  test("--preset= 等号带空值被显式拒绝", () => {
    expectAtomicConflictRejected(
      ["install", "--preset="],
      "--preset 不取值,等号空值形式应被专门拒绝",
    );
  });

  // VAL-CLI-005 (concurrency-or-order —— 重复标志)
  // rationale: 重复 `--preset` 不应改变语义。这条直接断言「解析成功且
  // preset===true」—— 今天第一个 `--preset` 即抛 unknown-argument,异常
  // 冒泡使本测试失败(真红:标志缺失);实现后重复 `--preset` 必须幂等地
  // 仍解析为预设安装。若实现选择显式拒绝重复标志(与既有 "repeated" 过滤
  // 标志一致),则本条改为 expectAtomicConflictRejected —— 实现期二选一。
  test("重复 --preset 幂等保留预设语义", () => {
    const parsed = parseArgs(["install", "--preset", "--preset"]);
    assert.equal(parsed.command, "install");
    assert.equal(
      (parsed as { install: { preset?: boolean } }).install.preset,
      true,
      "重复 --preset 必须仍解析为预设安装",
    );
  });
});

// ---------------------------------------------------------------------------
// Part B —— 分发层 (integration):mock installer 边界,断言 main 的行为。
// 沿用 tests/install-nontty.test.ts 的 importMain + captureStderr 模式。
// ---------------------------------------------------------------------------

const CATALOG = {
  generatedAt: "2026-04-21T00:00:00.000Z",
  workflowSkills: [
    { name: "planning-with-files", description: "x" },
    { name: "playwright-cli", description: "x" },
    { name: "systematic-debugging", description: "x" },
    { name: "test-driven-development", description: "x" },
    { name: "verification-before-completion", description: "x" },
  ],
  recommendedSkills: [{ name: "codex-agent", description: "x" }],
  plugins: [
    { name: "auriga-workflow", description: "x" },
    { name: "auriga-notify", description: "x" },
  ],
  hooks: [],
};

let importSerial = 0;

interface InstallerCall {
  category: "workflow" | "skills" | "recommended" | "plugins";
  scope?: string;
  agent?: string;
  lang?: string;
}

async function captureStderr<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; stderr: string }> {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    return { result: await fn(), stderr: chunks.join("") };
  } finally {
    process.stderr.write = original;
  }
}

/**
 * Import a fresh `main` with the four real installers replaced by
 * spies that record each call (category + the scope/agent/lang opts
 * they were handed). Only the install boundary is mocked — argv
 * parsing, dispatch, and graded-exit logic stay real.
 */
async function importMainWithSpies(overrides: {
  workflowImpl?: () => Promise<void>;
  skillsImpl?: () => Promise<void>;
  pluginsImpl?: () => Promise<void>;
  recommendedImpl?: () => Promise<void>;
} = {}): Promise<{
  main: (argv: string[]) => Promise<number>;
  calls: InstallerCall[];
}> {
  const calls: InstallerCall[] = [];

  mock.module(new URL("../src/utils.js", import.meta.url), {
    namedExports: {
      LANGUAGES: [
        { value: "en", label: "English", file: "CLAUDE.md" },
        { value: "zh-CN", label: "中文", file: "CLAUDE.zh-CN.md" },
      ],
      exec: () => "",
      execAsync: async () => "",
      fetchContentRoot: async () => process.cwd(),
      getPackageRoot: () => process.cwd(),
      isNonInteractive: () => true,
      readPackageVersion: () => "0.0.0-test",
      log: {
        ok: () => {},
        warn: (msg: string) => process.stderr.write(`${msg}\n`),
        error: (msg: string) => process.stderr.write(`${msg}\n`),
        skip: () => {},
      },
      withEsc: async <T>(prompt: Promise<T>) => prompt,
    },
  });
  mock.module(new URL("../src/catalog.js", import.meta.url), {
    namedExports: { loadCatalog: () => CATALOG },
  });
  mock.module(new URL("../src/workflow.js", import.meta.url), {
    namedExports: {
      installWorkflow: async (
        _root: string,
        opts: { scope?: string; agent?: string; lang?: string },
      ) => {
        calls.push({
          category: "workflow",
          scope: opts.scope,
          agent: opts.agent,
          lang: opts.lang,
        });
        if (overrides.workflowImpl) await overrides.workflowImpl();
      },
    },
  });
  mock.module(new URL("../src/skills.js", import.meta.url), {
    namedExports: {
      installSkills: async (
        _root: string,
        opts: { scope?: string; agent?: string },
      ) => {
        calls.push({ category: "skills", scope: opts.scope, agent: opts.agent });
        if (overrides.skillsImpl) await overrides.skillsImpl();
      },
      installRecommendedSkills: async (
        _root: string,
        opts: { scope?: string; agent?: string },
      ) => {
        calls.push({
          category: "recommended",
          scope: opts.scope,
          agent: opts.agent,
        });
        if (overrides.recommendedImpl) await overrides.recommendedImpl();
      },
    },
  });
  mock.module(new URL("../src/plugins.js", import.meta.url), {
    namedExports: {
      installPlugins: async (
        _root: string,
        opts: { scope?: string; agent?: string },
      ) => {
        calls.push({ category: "plugins", scope: opts.scope, agent: opts.agent });
        if (overrides.pluginsImpl) await overrides.pluginsImpl();
      },
    },
  });
  mock.module(new URL("../src/hooks.js", import.meta.url), {
    namedExports: { installHooks: async () => {} },
  });

  const mod = await import(
    new URL(`../src/cli.js?presetcase=${importSerial++}`, import.meta.url).href
  );
  return { main: mod.main as (argv: string[]) => Promise<number>, calls };
}

afterEach(() => {
  mock.restoreAll();
});

describe("main --preset 安装分发", () => {
  // VAL-CLI-001
  // rationale: `--preset` 必须安装且仅安装三类成员 —— workflow 文档、
  // auriga-workflow 插件、5 个 WORKFLOW_SKILLS。这条用集合断言:被触达的
  // installer 类目集合 === {workflow, skills, plugins},且 recommended
  // installer 未被触达(否则就成了 `--all` 的语义)。
  test("install --preset 触达 workflow / skills / plugins 三类 installer", async () => {
    const { main, calls } = await importMainWithSpies();
    const { result } = await captureStderr(() => main(["install", "--preset"]));
    assert.equal(result, 0);
    const touched = new Set(calls.map((c) => c.category));
    assert.deepEqual(
      [...touched].sort(),
      ["plugins", "skills", "workflow"],
      "预设安装必须覆盖 workflow + skills + plugins",
    );
  });

  // VAL-CLI-001 / VAL-CLI-009 的反面:预设不含 recommended。
  // rationale: spec §1 预设成员固定三类,不含 recommended skills。
  // 防 fake-green:今天 `--preset` 在 parseArgs 阶段即报错,main 返回 1、
  // 一个 installer 都不调,「没触达 recommended」会空泛地成立。所以这条先
  // 断言 `result === 0`(证明 --preset 真的被识别并执行了预设安装),再断言
  // recommended 不在触达集合内 —— 二者合起来才区分 `--preset` 与 `--all`。
  test("install --preset 执行成功但不触达 recommended installer", async () => {
    const { main, calls } = await importMainWithSpies();
    const { result } = await captureStderr(() => main(["install", "--preset"]));
    assert.equal(result, 0, "--preset 必须被识别并成功执行预设安装");
    assert.ok(calls.length > 0, "--preset 必须真的触达若干 installer");
    assert.ok(
      !calls.some((c) => c.category === "recommended"),
      "预设安装不应触达 recommended skills",
    );
  });

  // VAL-CLI-002 / VAL-CLI-003 / VAL-CLI-004
  // rationale: 三个默认值是本特性的核心契约。这条断言不带任何修饰标志时,
  // 每个 installer 收到的 opts 都是 scope=user / agent=both / lang=en。
  // 用属性断言遍历所有 installer 调用,而非只查单个。
  test("install --preset 默认把 scope=user / agent=both / lang=en 传给每个 installer", async () => {
    const { main, calls } = await importMainWithSpies();
    const { result } = await captureStderr(() => main(["install", "--preset"]));
    assert.equal(result, 0);
    assert.ok(calls.length > 0, "应至少触达一个 installer");
    for (const c of calls) {
      assert.equal(c.scope, "user", `${c.category} 默认 scope 应为 user`);
      assert.equal(c.agent, "both", `${c.category} 默认 agent 应为 both`);
    }
    // lang 默认 en —— 只有 workflow installer 接收 lang。
    const workflowCall = calls.find((c) => c.category === "workflow");
    assert.ok(workflowCall, "应触达 workflow installer");
    assert.equal(workflowCall.lang, "en", "默认 lang 应为 en");
  });

  // VAL-CLI-005
  // rationale: 显式覆盖必须如实透传到每个 installer。这条用 project /
  // codex / zh-CN 三个非默认值,确认覆盖链路而非默认值链路。
  test("install --preset --scope project --agent codex --lang zh-CN 覆盖透传到 installer", async () => {
    const { main, calls } = await importMainWithSpies();
    const { result } = await captureStderr(() =>
      main([
        "install",
        "--preset",
        "--scope",
        "project",
        "--agent",
        "codex",
        "--lang",
        "zh-CN",
      ]),
    );
    assert.equal(result, 0);
    for (const c of calls) {
      assert.equal(c.scope, "project", `${c.category} 应收到覆盖后的 scope`);
      assert.equal(c.agent, "codex", `${c.category} 应收到覆盖后的 agent`);
    }
    const workflowCall = calls.find((c) => c.category === "workflow");
    assert.ok(workflowCall, "应触达 workflow installer");
    assert.equal(workflowCall.lang, "zh-CN", "应收到覆盖后的 lang");
  });

  // VAL-CLI-008 (happy —— 全成功)
  // rationale: 所有类别成功时分级退出码必须是 0。
  test("install --preset 全部类别成功时 exit 0", async () => {
    const { main } = await importMainWithSpies();
    const { result } = await captureStderr(() => main(["install", "--preset"]));
    assert.equal(result, 0);
  });

  // VAL-CLI-008 (error —— 部分失败)
  // rationale: 部分类别失败时必须 exit 2,且 stderr 必须列出失败的类别名,
  // 让用户知道重试哪一类。这条让 plugins installer 抛错,断言 exit 2 +
  // stderr 含 "plugins"。
  test("install --preset 部分类别失败时 exit 2 且 stderr 列出失败类别", async () => {
    const { main } = await importMainWithSpies({
      pluginsImpl: async () => {
        throw new Error("claude plugin install boom");
      },
    });
    const { result, stderr } = await captureStderr(() =>
      main(["install", "--preset"]),
    );
    assert.equal(result, 2);
    assert.match(stderr, /plugins/i);
  });

  // VAL-CLI-008 (boundary —— 全失败)
  // rationale: 没有任何类别成功时仍属「部分以上失败」,退出码非 0;此处
  // 锁定为 2(与 --all 全失败一致,见 install-nontty.test.ts),并要求
  // stderr 列出所有失败类别。
  test("install --preset 所有类别失败时 exit 2 并列出所有失败类别", async () => {
    const { main } = await importMainWithSpies({
      workflowImpl: async () => {
        throw new Error("w fail");
      },
      skillsImpl: async () => {
        throw new Error("s fail");
      },
      pluginsImpl: async () => {
        throw new Error("p fail");
      },
    });
    const { result, stderr } = await captureStderr(() =>
      main(["install", "--preset"]),
    );
    assert.equal(result, 2);
    assert.match(stderr, /workflow/i);
    assert.match(stderr, /skills/i);
    assert.match(stderr, /plugins/i);
  });
});

describe("main --all 纳入 recommended", () => {
  // VAL-CLI-009
  // rationale: spec §2 —— `--all` 回归「全装」语义,现在必须把 recommended
  // skills 也纳入。今天 ALL_CATEGORIES = [workflow, skills, plugins, hooks]
  // 不含 recommended,所以这条今天会失败:recommended installer 不被触达。
  test("install --all 触达 recommended installer", async () => {
    const { main, calls } = await importMainWithSpies();
    const { result } = await captureStderr(() => main(["install", "--all"]));
    assert.equal(result, 0);
    assert.ok(
      calls.some((c) => c.category === "recommended"),
      "--all 现在必须把 recommended skills 纳入安装",
    );
  });

  // VAL-CLI-009 (集合断言)
  // rationale: `--all` 必须覆盖 workflow + skills + recommended + plugins
  // 四类。用集合断言一次性锁定成员完整 —— 既抓「漏掉 recommended」也抓
  // 「漏掉其它类」。hooks 已随本特性移除,不在断言集合内。
  test("install --all 覆盖 workflow / skills / recommended / plugins 四类", async () => {
    const { main, calls } = await importMainWithSpies();
    const { result } = await captureStderr(() => main(["install", "--all"]));
    assert.equal(result, 0);
    const touched = new Set(calls.map((c) => c.category));
    assert.deepEqual(
      [...touched].sort(),
      ["plugins", "recommended", "skills", "workflow"],
      "--all 必须覆盖这四类(hooks 已移除)",
    );
  });
});
