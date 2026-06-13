# Kotlin Android 质量门禁参考

## 已验证来源项目

CurioSea-Android 提供了来源模式。已观察到的硬门禁入口是 `tools/quality/check-affected-android-quality.sh`，背后有 `AffectedQuality.kt` 这类 Kotlin 规划代码。该门禁组合了 Spotless、Detekt、Android Lint、Gradle tests、模块边界检查、本地化检查，以及 preview 或截图契约。

GitHub 侧模式是在默认分支启用 active 状态的 ruleset、拉取请求要求、required conversation resolution、code owner review，以及名为 `Quality Gates` 的 required check。

## 第一层：工具选型和版本策略

| 工具 | 作用 | 版本选择建议 |
| --- | --- | --- |
| Gradle wrapper | 所有 Android 构建和测试入口 | 固定使用仓库 wrapper；不要依赖系统 Gradle |
| version catalog | 构建插件、质量工具和运行时依赖的单一版本来源 | 把 AGP、Kotlin、KSP、Spotless、ktlint、Detekt、Compose rules 等放在 `gradle/libs.versions.toml`；升级工具链至少跑 `assembleDebug` 和质量门禁 |
| Spotless + ktlint | Kotlin 和 Gradle Kotlin DSL 格式化 | Spotless 插件版本和 ktlint 版本都走 version catalog；格式化行为升级要单独 review |
| Detekt + compose rules | Kotlin 静态分析、Compose 规则、复杂度和协程风险 | Detekt 版本来自 version catalog；规则配置在 `config/detekt/detekt.yml`，`maxIssues: 0` |
| Android Lint | Android 资源、manifest、API 使用、模块配置问题 | 跟随 AGP 版本；AGP 升级视为构建工具链升级 |
| `AffectedQualityPlanner` | 根据 diff 推导 Gradle task 和回归提示 | 作为 Kotlin 模块维护，必须有单元测试；shell 只负责 Git 和早期跳过 |
| Screenshot / preview gate | 校验截图 preview 注解和截图回归 | 截图插件版本放 version catalog；重型截图验证放定时或专门回归，不阻塞每个 PR |
| GitHub Actions runner | 提供不可绕过的 `Quality Gates` required check | JDK、Android SDK、Gradle setup 在 workflow 中显式声明；`compileSdkMinor` 需要的 SDK 包必须安装 |

## 第二层：现有规则配置参考

| 配置或脚本 | 当前规则参考 |
| --- | --- |
| 根 `build.gradle.kts` | Kotlin 和 Java 编译 warning 全部按 error 处理；Spotless 管辖 `*.kt` 和 `*.gradle.kts`，排除 `build/`、`.gradle/`、`generated/` |
| `config/detekt/detekt.yml` | `build.maxIssues: 0`；配置校验开启且 warnings as errors；复杂度、协程、文档、空块、异常等规则显式配置 |
| Detekt 文档规则 | `feature/*/api` 和 `core/**` 的公开类、函数、属性需要 KDoc，防跨模块公共契约无说明 |
| 协程规则 | 禁止 `GlobalScope`、直接使用 `Dispatchers.IO/Default/Unconfined`、无意义 `suspend`、`Thread.sleep`、吞取消等 |
| `checkModuleBoundaries` | 守 Android 多模块依赖方向 |
| `checkAndroidLocalization` | 守本地化资源完整性 |
| `checkScreenshotPreviewContract` | 守 screenshot preview 注解和中文 `zh-rCN` 预览契约 |
| `check-ci-paths-ignore-tests.sh` | 守 required workflow 不得加回 `paths-ignore`，防 required check 卡在 Expected |

## 具体规则文件

具体 Detekt 规则清单、Spotless/Gradle 编译规则、Compose 规则、协程规则、风格规则和项目自定义 Gradle gate 建议见 `references/concrete-rules.md`。需要写入或调整目标仓库规则配置时，先读取该文件，不要只依赖本总览。

## 第三层：触发时机建议

| 时机 | 适合检查 | 不适合检查 | 当前参考 |
| --- | --- | --- | --- |
| `pre-commit` | `git diff --cached --check` | Gradle 全量配置、Android Lint、截图回归 | `.githooks/pre-commit` |
| `pre-push` | shell 快速分类后调用 `check-affected-android-quality.sh`，只跑受影响 Gradle task | APK 打包、截图验证、模拟器 | `.githooks/pre-push` |
| PR CI | `Quality Gates` required check：脚本自测、planner 自测、Spotless、Detekt、Android Lint、模块边界、单元测试 | 重型截图和设备回归 | `.github/workflows/pr-quality-checks.yml` |
| 合入 `main` 后 | 如果需要尽快发现打包或发布配置问题，可跑 `assembleDebug`、关键模块集成检查 | 每次 PR 已覆盖的快速 lint | 当前主要放在定时回归；目标仓库可按发布风险加 main push workflow |
| 定时 workflow | 截图回归、`assembleDebug`、测试 APK 打包、模拟器烟囱测试、失败自动分析 | 基础格式和静态检查 | `.github/workflows/weekday-android-regression.yml` |

基于 diff 的本地检查建议：

- shell 先用 `classify-android-quality-paths.sh` 过滤 docs / Agent 配置，避免启动 Gradle。
- 有 Android 相关路径时，把文件列表写入 `mktemp`，由 Kotlin planner 推导 Gradle task。
- planner 输出 `TASK`、`NOTE`、`SKIP` 机器协议；未知输出直接失败。
- PR 的 required check 不要用 workflow 级 `paths-ignore`。CurioSea-Android 曾明确保留“所有非 Draft PR 都触发”，否则纯文档 PR 会因为 required check 不上报而卡死。

## 示例

共享脚本和 workflow 模板见 `../references/invocation-examples.md`。Android 侧可以按下面形态落地：

```sh
# 查看受影响 Gradle task
tools/quality/check-affected-android-quality.sh --print-tasks

# PR 阻塞门禁
ANDROID_QUALITY_SCOPE=blocking tools/quality/check-affected-android-quality.sh

# 定时重型门禁
ANDROID_QUALITY_SCOPE=scheduled tools/quality/check-affected-android-quality.sh
```

```yaml
jobs:
  quality:
    name: Quality Gates
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-java@v5
        with:
          distribution: temurin
          java-version: "17"
      - uses: android-actions/setup-android@v4
      - run: sdkmanager "platforms;android-36.1" "build-tools;36.0.0"
      - uses: gradle/actions/setup-gradle@v6
      - run: bash tools/quality/check-affected-android-quality-tests.sh
      - run: tools/quality/check-android-quality.sh
```
