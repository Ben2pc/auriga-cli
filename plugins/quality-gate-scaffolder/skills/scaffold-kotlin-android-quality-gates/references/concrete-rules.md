# Kotlin Android 具体规则参考

本文件只放 Kotlin Android 的具体规则。使用技能时，先用 `platform-quality-gates.md` 判断工具和触发时机；需要写入 Detekt、Spotless、Gradle 或项目 gate 时，再加载本文件。

## 官方文档入口

需要更多规则、确认最新规则名、确认配置字段或升级版本时，先查官方文档，不要只凭模型记忆补规则。

- Gradle 用户手册：https://docs.gradle.org/
- Gradle version catalog：https://docs.gradle.org/current/userguide/version_catalogs.html
- Android Gradle Plugin API：https://developer.android.com/reference/tools/gradle-api
- Android Gradle Plugin release notes：https://developer.android.com/build/releases/gradle-plugin
- Android Lint 使用文档：https://developer.android.com/studio/write/lint
- Android Lint issue 文档：https://googlesamples.github.io/android-custom-lint-rules/checks/index.md.html
- Detekt 文档入口：https://detekt.dev/docs/intro/
- Detekt 规则文档：https://detekt.dev/docs/rules/complexity/
- Detekt 扩展文档：https://detekt.dev/docs/introduction/extensions/
- Spotless 仓库：https://github.com/diffplug/spotless
- Spotless Gradle plugin 文档：https://github.com/diffplug/spotless/blob/main/plugin-gradle/README.md
- ktlint 文档：https://pinterest.github.io/ktlint/
- Compose rules 文档：https://mrmans0n.github.io/compose-rules/
- Compose rules 仓库：https://github.com/twitter/compose-rules
- GitHub Actions workflow 语法：https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions
- GitHub ruleset 可用规则：https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets

## Gradle 和 Spotless 规则

基础门禁建议：

- 固定使用 Gradle wrapper，不依赖系统 Gradle。
- Kotlin 和 Java 编译 warning 全部按 error 处理。
- Spotless 管辖 `**/*.kt`、`*.gradle.kts`、`**/*.gradle.kts`。
- Spotless 排除 `**/build/**`、`**/.gradle/**`、`**/generated/**`。
- Spotless 插件版本和 `ktlint` 版本都放在 version catalog。
- Detekt `toolVersion` 从 version catalog 读取，配置文件固定在 `config/detekt/detekt.yml`。

版本 catalog 建议至少集中这些工具：AGP、Kotlin、KSP、Spotless、ktlint、Detekt、Compose Detekt rules、截图插件。升级 AGP 或 Kotlin 至少跑质量门禁和 `assembleDebug`。

## Detekt 规则清单

基础配置：

```yaml
build:
  maxIssues: 0
config:
  validation: true
  warningsAsErrors: true
```

复杂度规则：

- `CyclomaticComplexMethod`：`threshold: 12`。
- `LongMethod`：`threshold: 80`。
- `LongParameterList`：函数阈值 8，构造器阈值 10。
- `NestedBlockDepth`：`threshold: 4`。
- `ComplexCondition`：`threshold: 4`。
- `ComplexInterface`：`threshold: 8`，不统计 static/private，忽略 overloaded。
- `LargeClass`：`threshold: 400`。
- `NestedScopeFunctions`：阈值 1，限制 `apply`、`run`、`with`、`let`、`also` 嵌套。
- `NamedArguments`：超过 3 个参数时调用处必须写参数名。
- `TooManyFunctions`：Compose 文件小组件较多，通常先关闭。

协程规则：

- `GlobalCoroutineUsage`：禁止全局协程入口。
- `InjectDispatcher`：禁止直接使用 `Dispatchers.IO`、`Dispatchers.Default`、`Dispatchers.Unconfined`，调度器从外部注入。
- `RedundantSuspendModifier`：无挂起调用的函数不声明 `suspend`。
- `SleepInsteadOfDelay`：协程中不用 `Thread.sleep`。
- `SuspendFunWithFlowReturnType`：返回 `Flow` 的函数通常不再声明 `suspend`。
- `SuspendFunSwallowedCancellation`：防止 `runCatching` 等吞掉取消异常。
- `SuspendFunWithCoroutineScopeReceiver`：避免 suspend 上下文和 scope receiver 混用。

文档规则：

- `UndocumentedPublicClass`、`UndocumentedPublicFunction`、`UndocumentedPublicProperty` 只对跨模块公共契约启用。
- 推荐 includes：`**/feature/*/api/src/main/**` 和 `**/core/**/src/main/**`。
- protected 成员默认不强制，避免内部扩展点噪音。

空块规则：

- 打开 `EmptyCatchBlock`、`EmptyClassBlock`、`EmptyDefaultConstructor`、`EmptyDoWhileBlock`、`EmptyElseBlock`、`EmptyFinallyBlock`、`EmptyForBlock`、`EmptyFunctionBlock`、`EmptyIfBlock`、`EmptyInitBlock`、`EmptyKtFile`、`EmptySecondaryConstructor`、`EmptyTryBlock`、`EmptyWhenBlock`、`EmptyWhileBlock`。
- `EmptyCatchBlock.allowedExceptionNameRegex` 建议允许 `_`、`ignore...`、`expected...`。

异常规则：

- 打开 `ExceptionRaisedInUnexpectedLocation`，禁止在 `equals`、`hashCode`、`toString` 等基础方法主动抛异常。
- 打开 `InstanceOfCheckForException`，生产代码不通过类型分支判断异常。
- 打开 `NotImplementedDeclaration`，禁止 `TODO()` 和 `NotImplementedError` 进入生产代码。
- 打开 `ObjectExtendsThrowable`、`PrintStackTrace`、`RethrowCaughtException`、`ReturnFromFinally`、`SwallowedException`、`ThrowingExceptionFromFinally`、`ThrowingExceptionsWithoutMessageOrCause`、`ThrowingNewInstanceOfSameException`、`TooGenericExceptionCaught`、`TooGenericExceptionThrown`。
- 测试、仪器化测试、截图测试可以对过宽异常和无 message 异常做豁免。

命名规则：

- `FunctionNaming` 打开，但 `ignoreAnnotated: [Composable]`，允许内容型 Composable 大写开头。

## Compose 规则清单

Compose Detekt rules 建议打开：

- `ComposableAnnotationNaming`：自定义 Composable 注解带后缀。
- `ComposableNaming`：内容型 Composable 大写，返回值型 Composable 小写。
- `ComposableParamOrder`：统一 required 参数、modifier、optional 参数、trailing lambda 顺序。
- `CompositionLocalAllowlist`：限制隐式全局依赖扩散。
- `CompositionLocalNaming`：CompositionLocal 使用 `Local` 前缀。
- `ContentEmitterReturningValues`：发射 UI 内容的 Composable 不返回业务值。
- `ContentTrailingLambda`、`ContentSlotReused`：内容槽位置和复用规则。
- `DefaultsVisibility`：公开默认参数不依赖更窄可见性实现细节。
- `LambdaParameterEventTrailing`、`LambdaParameterInRestartableEffect`。
- `ModifierClickableOrder`、`ModifierComposed`、`ModifierMissing`、`ModifierNaming`、`ModifierNotUsedAtRoot`、`ModifierReused`、`ModifierWithoutDefault`。
- `MultipleEmitters`：默认只发射一个顶层内容节点。
- `MutableParams`、`MutableStateAutoboxing`、`MutableStateParam`。
- `ParameterNaming`：事件回调用现在时，例如 `onClick`。
- `PreviewAnnotationNaming`、`PreviewPublic`；截图测试入口可豁免 `PreviewPublic`。
- `RememberMissing`、`RememberContentMissing`。
- `UnstableCollections`：Composable 参数不直接暴露普通 `List` / `Set` / `Map`。
- `ViewModelForwarding`、`ViewModelInjection`：ViewModel 只在 Route 或屏幕边界注入。

可以关闭或暂缓：

- `Material2`：如果项目以 Material3 为主，Material2 禁用可先不检查。
- `PreviewNaming`：若已有截图入口命名约定，先避免纯命名迁移噪音。

## 性能、潜在错误和风格规则

性能：

- `ArrayPrimitive`、`ForEachOnRange`、`SpreadOperator`、`UnnecessaryTemporaryInstantiation`。
- `ForEachOnRange` 和 `SpreadOperator` 可对 test、androidTest、screenshotTest 豁免。

潜在错误：

- `CastNullableToNonNullableType`、`CastToNullableType`。
- `ElseCaseInsteadOfExhaustiveWhen`：enum、sealed、Boolean 可穷尽时不要用 else 吃掉新增分支。
- `LateinitUsage`：生产代码禁用，测试可豁免。
- `NullableToStringCall`、`UnsafeCallOnNullableType`、`UnconditionalJumpStatementInLoop`、`UnreachableCode`。

风格：

- `DestructuringDeclarationWithTooManyEntries`：最多 3 项。
- `EqualsNullCall`、`ExplicitItLambdaParameter`。
- `DataClassShouldBeImmutable`：数据载体不用 `var`。
- `ForbiddenComment`：拦截 TODO / FIXME。
- `ForbiddenImport`：禁止 `android.util.Log`、`java.util.ArrayList`、`java.util.HashMap`、`java.util.HashSet`、`java.util.LinkedHashMap`、`java.util.LinkedHashSet`、`java.util.LinkedList`、`java.util.Vector`。
- `ForbiddenMethodCall`：禁止 `kotlin.io.print`、`kotlin.io.println`。
- `ForbiddenSuppress`：禁止 `all` 这类宽泛 suppress。
- `ForbiddenVoid`、`FunctionOnlyReturningConstant`、`LoopWithTooManyJumpStatements`、`MayBeConst`、`ModifierOrder`、`NoTabs`、`OptionalAbstractKeyword`、`OptionalUnit`、`RedundantVisibilityModifierRule`、`UnusedPrivateMember`、`UnnecessaryAbstractClass`、`UnnecessaryAnnotationUseSiteTarget`、`UnnecessaryApply`、`UnusedImports`、`UseCheckOrError`、`UseRequire`、`UseRequireNotNull`、`VarCouldBeVal`、`WildcardImport`。
- `MagicNumber` 可先关闭，Compose 尺寸和动画数字噪音通常较高。
- `MaxLineLength` 交给 ktlint / Spotless。
- `ReturnCount` 和 `ThrowsCount` 可以暂缓，先保持清晰控制流优先。

## 项目自定义 Gradle gate

这些规则建议放在 build logic 或 `tools/quality` 脚本里，并配单元测试：

- `checkModuleBoundaries`：守 Android 多模块依赖方向。
- `checkAndroidLocalization`：守字符串资源、语言目录和本地化完整性。
- `checkScreenshotPreviewContract`：守 screenshot preview 注解和目标语言 preview 契约。
- `check-ci-paths-ignore-tests.sh`：阻止 required workflow 加回 `paths-ignore`。
- affected planner：从 diff 推导 Gradle task，输出机器协议；命中 Gradle、version catalog、门禁脚本或未知路径时回退全量。
