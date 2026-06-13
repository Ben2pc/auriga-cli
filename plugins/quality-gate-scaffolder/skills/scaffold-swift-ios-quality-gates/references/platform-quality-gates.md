# Swift iOS 质量门禁参考

## 已验证来源项目

CurioSea-iOS 提供了来源模式。已观察到的硬门禁入口是 `Tools/Quality/check-ios-affected.swift`，配套检查包括 Swift 格式化、SwiftLint、SwiftLint analyze、package 边界、本地化、依赖解析和设计 token 契约。

GitHub 侧模式是在默认分支启用 active 状态的 ruleset、拉取请求要求、required conversation resolution、code owner review，以及名为 `Quality Script Tests` 的 required check。

## 第一层：工具选型和版本策略

| 工具 | 作用 | 版本选择建议 |
| --- | --- | --- |
| Swift toolchain / Xcode | 编译、测试、Swift Package Manager 解析、`swift format`、iOS 平台 analyze 构建 | PR Linux workflow 用 `SWIFT_TOOLCHAIN_VERSION` 做单一来源；Xcode 的 Swift 语言模式不要和 Linux toolchain 变量混用；macOS runner 上的 Xcode 版本要在合并后门禁里显式固定或打印 |
| `swift format lint` | 检查 Swift 格式，适合按 diff 文件列表跑 | 跟随 Swift toolchain；配置放 `.swift-format`，升级 toolchain 时先跑格式脚本自测和代表性格式 diff |
| SwiftLint | 补 Swift 编译器和 `swift-format` 不覆盖的结构性约束 | 本机优先 `swiftlint`；没有本机二进制时用 Docker 镜像兜底，例如 `ghcr.io/realm/swiftlint:0.63.2`；镜像 tag 写进脚本默认值并允许环境变量覆盖 |
| SwiftLint analyze | 依赖真实编译日志，执行文件局部 analyzer 规则 | 只放在 macOS / Xcode 环境；用真实 iOS 构建日志，不用宿主 `swift build`；升级 SwiftLint 或 Xcode 时必须关注 analyzer 覆盖文件数 |
| `check-ios-affected.swift` | 根据 diff 推导最小门禁任务，避免本地 pre-push 全量过慢 | 作为项目源码维护；用 Swift 脚本自测锁路径分类、Package 描述解析和任务输出协议 |
| package 边界 / 依赖解析 / 本地化脚本 | 执行项目架构和资源规则 | 规则与脚本同仓库版本化；脚本改动应触发全量门禁，因为它改变“怎么检查” |
| GitHub Actions | 提供不可绕过的 required check | `actions/checkout` 等 action 使用稳定主版本或提交 SHA；Swift setup action 可用提交 SHA 固定；required check 名以 PR 页面实际 job 名为准 |

## 第二层：现有规则配置参考

| 配置或脚本 | 当前规则参考 |
| --- | --- |
| `.swiftlint.yml` | `only_rules` 显式严格集，覆盖运行时安全、明显错误、Swift 并发、性能、遗留 API、lint 治理、SwiftUI 可访问性、本地化和复杂度 |
| `.swiftlint.yml` analyzer | 只启用文件局部 analyzer 规则；需要全程序视野的 analyzer 规则不启用，因为测试文件无法稳定 analyze |
| `.swiftlint.yml` thresholds | 复杂度、文件长度、函数长度、闭包长度、嵌套深度和类型长度有 warning/error 阈值；高风险可空逃生口升为 error |
| `.swiftlint.yml` custom_rules | SwiftUI 和 display model 的用户可见字符串必须本地化，覆盖 `Text`、`Label`、`Button`、`navigationTitle`、`accessibilityLabel` 等形态 |
| `check-package-boundaries.swift` | 从 `Package.swift` 推导 target 和依赖关系，守 package 边界，不手维护映射表 |
| `check-localization.swift` | 校验 `.xcstrings` 和源码本地化契约 |
| `check-package-dependency-resolution.swift` | 校验 Swift Package 依赖解析和锁文件漂移 |
| `check-ios-affected-tests.swift` 等脚本自测 | 锁住 dispatcher、hook、SwiftLint、format、analyze、package 边界、本地化、依赖解析的行为，防门禁自身漂移 |

## 具体规则文件

具体 SwiftLint 规则清单、阈值、analyzer 取舍、本地化自定义规则和项目自定义 gate 建议见 `concrete-rules.md`。需要写入或调整目标仓库规则配置时，先读取该文件，不要只依赖本总览。

## 第三层：触发时机建议

| 时机 | 适合检查 | 不适合检查 | 当前参考 |
| --- | --- | --- | --- |
| `pre-commit` | `git diff --cached --check`，空白和冲突标记 | 编译、测试、analyze | `.githooks/pre-commit` |
| `pre-push` | `check-ios-affected.swift` 受影响门禁：格式、SwiftLint、package 边界、本地化、依赖解析、受影响测试 target | 真机平台 analyze、全包测试、模拟器回归 | `.githooks/pre-push` 将 `remote_sha/local_sha` 传给 dispatcher |
| PR CI | 脚本自测、dispatcher 自测、Swift 格式、SwiftLint changed scope、依赖解析、本地化 | macOS 重型全包测试和 analyze | `.github/workflows/pr-quality-checks.yml` 的 `Quality Script Tests` |
| 合入 `main` 后 | macOS 全包测试、package boundary 全量、SwiftLint analyze | 秒级格式检查 | `.github/workflows/swift-package-gates.yml` |
| 定时 workflow | 模拟器、Maestro、截图或昂贵端到端回归 | 每个 PR 都必须阻塞的基础静态检查 | 当前以回归提示为主；如果自动化稳定，再移入定时或发版前 workflow |

基于 diff 的本地检查建议：

- `pre-push` 从 Git hook stdin 读取 `local_sha remote_sha`，已有远端分支只检查 `remote_sha..local_sha`，新分支回退到 `merge-base local_sha origin/main`。
- dispatcher 先按路径分类；改到门禁脚本、hook、`Package.swift`、`.swiftlint.yml` 等 sentinel 文件时退回全量。
- 生产源码用 `swift package describe --type json` 推导反向依赖闭包；不要手写 target 映射表。
- docs-only 或无法被可执行检查证明的散文文件可以本地跳过，但 PR required check 仍要稳定上报。

## 示例

共享脚本和 workflow 模板见 `../../references/invocation-examples.md`。iOS 侧可以按下面形态落地：

```sh
# 本地查看某次改动会派发什么
swift Tools/Quality/check-ios-affected.swift --print-tasks <path>...

# 本地跑当前分支受影响门禁
swift Tools/Quality/check-ios-affected.swift

# 强制跑全量门禁
IOS_QUALITY_SCOPE=all swift Tools/Quality/check-ios-affected.swift
```

```yaml
jobs:
  quality-scripts:
    name: Quality Script Tests
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: swift-actions/setup-swift@7ca6abe6b3b0e8b5421b88be48feee39cbf52c6a
        with:
          swift-version: "${{ env.SWIFT_TOOLCHAIN_VERSION }}"
      - run: swift Tools/Quality/check-ios-affected-tests.swift
      - run: Tools/Quality/check-swift-format.sh
      - run: Tools/Quality/check-swiftlint.sh
        env:
          SWIFTLINT_SCOPE: changed
          SWIFTLINT_BASE_REF: ${{ github.event.pull_request.base.sha }}
          SWIFTLINT_HEAD_REF: ${{ github.event.pull_request.head.sha }}
```
