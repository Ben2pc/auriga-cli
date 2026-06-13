# Swift iOS 具体规则参考

本文件只放 Swift iOS 的具体规则。使用技能时，先用 `platform-quality-gates.md` 判断工具和触发时机；需要写入 `.swiftlint.yml`、脚本或项目 gate 时，再加载本文件。

## 官方文档入口

需要更多规则、确认最新规则名、确认配置字段或升级版本时，先查官方文档，不要只凭模型记忆补规则。

- SwiftLint 仓库：https://github.com/realm/SwiftLint
- SwiftLint 规则目录：https://realm.github.io/SwiftLint/rule-directory.html
- SwiftLint 规则源码说明：https://github.com/realm/SwiftLint/blob/main/Rules.md
- swift-format 仓库：https://github.com/swiftlang/swift-format
- swift-format 配置文档：https://github.com/swiftlang/swift-format/blob/main/Documentation/Configuration.md
- swift-format 规则文档：https://github.com/swiftlang/swift-format/blob/main/Documentation/RuleDocumentation.md
- Swift Package Manager 文档：https://docs.swift.org/swiftpm/documentation/packagemanagerdocs/
- Xcode 构建系统文档：https://developer.apple.com/documentation/xcode/build-system
- GitHub Actions workflow 语法：https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions
- GitHub ruleset 可用规则：https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets

## SwiftLint 规则清单

建议使用 `only_rules` 显式列白名单，不依赖 SwiftLint 默认规则集。规则按“为什么开”分组，升级 SwiftLint 时逐组 review。

运行时安全：

- `block_based_kvo`：避免旧式 KVO block 生命周期问题。
- `class_delegate_protocol`：delegate 协议应限制 class，以支持弱引用。
- `discarded_notification_center_observer`：防观察者 token 被丢弃。
- `discouraged_direct_init`：拦截不应直接初始化的 Foundation 类型。
- `dynamic_inline`：避免 `dynamic` 和 `@inline(__always)` 组合破坏语义。
- `fatal_error_message`：崩溃点必须带可定位 message。
- `force_cast`、`force_try`、`force_unwrapping`：阻断高风险逃生口；`force_unwrapping` 建议 `severity: error`。
- `implicitly_unwrapped_optional`：阻断隐式解包可选，建议 `severity: error`。
- `ns_number_init_as_function_reference`、`nsobject_prefer_isequal`：拦截 Objective-C 桥接老坑。
- `unowned_variable_capture`：避免闭包捕获释放后的对象。
- `weak_delegate`：delegate 默认弱引用。

明显错误：

- `compiler_protocol_init`、`duplicate_conditions`、`duplicated_key_in_dictionary_literal`、`identical_operands`。
- `lower_acl_than_parent`：避免父级可见但成员不可达。
- `non_optional_string_data_conversion`、`optional_data_string_conversion`：拦截 Data/String 转换误用。
- `raw_value_for_camel_cased_codable_enum`、`redundant_string_enum_value`：枚举序列化值要明确。
- `return_value_from_void_function`、`self_in_property_initialization`。
- `unavailable_condition`、`unavailable_function`。
- `no_empty_block`、`unneeded_break_in_switch`、`unneeded_escaping`、`unneeded_override`、`unneeded_throws_rethrows`。
- `unused_closure_parameter`、`unused_control_flow_label`、`unused_enumerated`、`unused_parameter`、`unused_setter_value`。

Swift 并发：

- `async_without_await`：`async` 函数内部没有挂起点时通常不该是异步 API。
- `redundant_sendable`：去掉冗余 `Sendable` 标注。
- `unhandled_throwing_task`：阻断未处理错误的 throwing task。

Swift 惯用法和性能：

- `static_over_final_class`：类型级成员用 `static`，避免历史写法回流。
- `contains_over_filter_count`、`contains_over_filter_is_empty`、`contains_over_first_not_nil`：避免为了判断存在性做多余遍历。
- `empty_count`、`empty_string`：使用更直接的空判断。
- `first_where`、`last_where`：使用标准库表达意图。
- `flatmap_over_map_reduce`、`reduce_into`、`sorted_first_last`：减少不必要中间集合和排序成本。

遗留 API 和治理：

- `legacy_hashing`、`legacy_random`：防旧 API 回流。
- `blanket_disable_command`：禁止宽泛 disable。
- `expiring_todo`：带日期 TODO 到期后阻断；日期格式建议 `yyyy-MM-dd`。
- `inclusive_language`：拦截排他性术语。
- `invalid_swiftlint_command`、`superfluous_disable_command`：防 disable 注释失效或冗余。

SwiftUI 和可访问性：

- `accessibility_label_for_image`：图片需要可访问性标签或明确隐藏。
- `accessibility_trait_for_button`：按钮语义要正确。
- `private_swiftui_state`：`@State` 不应暴露为外部 API。

## 阈值规则

建议给复杂度和长度规则同时设置 warning 和 error，避免规则只有提示没有阻断。

| 规则 | warning | error | 说明 |
| --- | --- | --- | --- |
| `cyclomatic_complexity` | 12 | 20 | 单函数分支路径数量 |
| `function_body_length` | 80 | 140 | 单函数体行数 |
| `closure_body_length` | 40 | 80 | 单闭包体行数 |
| `file_length` | 600 | 700 | 文件总长度；建议 `ignore_comment_only_lines: true` |
| `type_body_length` | 400 | 500 | 单类型体行数 |
| `nesting.type_level` | 3 | 3 | 类型嵌套层级 |
| `nesting.function_level` | 4 | 6 | 函数内部嵌套层级 |

## Analyzer 规则

`swiftlint analyze` 依赖真实编译日志，只放文件局部规则：

- `capture_variable`：防闭包捕获变量导致并发或生命周期问题。
- `unused_import`：删除死 import，但必须集中维护误报白名单。

不要默认开启需要全程序视野的 analyzer 规则。Swift Testing 测试文件在宏展开时可能无法稳定进入 analyze，真正引用大量在测试中的代码会被误报为未使用。

`unused_import.always_keep_imports` 建议只放已验证误报的模块：

- `OSLog`：结构化日志插值可能让 analyzer 看不到使用。
- `AVFoundation`：CoreMedia 符号经模块透传时可能被误判。

## 自定义本地化规则

本地化是用户可见质量门禁，适合写成 SwiftLint `custom_rules`。建议只纳入生产源码，排除测试和 Debug 专用 UI。

```yaml
custom_rules:
  localized_swiftui_literal:
    included:
      - "CurioSeaPackage/Sources/.*\\.swift"
      - "CurioSea/.*\\.swift"
    excluded:
      - "CurioSeaPackage/Tests/.*\\.swift"
      - "CurioSeaPackage/Sources/AppComposition/CurioSeaAppFeature/Debug/.*\\.swift"
    regex: '\b(?:Text|Label|Button|Picker)\s*\(\s*"[^"]+"'
    message: "User-visible SwiftUI strings must use String(localized:defaultValue:table:bundle:)."
    severity: error

  localized_view_modifier_literal:
    included:
      - "CurioSeaPackage/Sources/.*\\.swift"
      - "CurioSea/.*\\.swift"
    excluded:
      - "CurioSeaPackage/Tests/.*\\.swift"
      - "CurioSeaPackage/Sources/AppComposition/CurioSeaAppFeature/Debug/.*\\.swift"
    regex: '\.(?:navigationTitle|accessibilityLabel|accessibilityHint|alert)\s*\(\s*"[^"]+"'
    message: "User-visible modifier strings must be localized."
    severity: error

  localized_display_model_literal:
    included:
      - "CurioSeaPackage/Sources/.*\\.swift"
      - "CurioSea/.*\\.swift"
    excluded:
      - "CurioSeaPackage/Tests/.*\\.swift"
      - "CurioSeaPackage/Sources/AppComposition/CurioSeaAppFeature/Debug/.*\\.swift"
    regex: '\b(?:title|subtitle|message|description|displayName|statusText|progressText|greeting)\s*(?::[^=\n]+)?=\s*"[^"]+"'
    message: "Display model strings must be localized."
    severity: error

  localized_display_argument_literal:
    included:
      - "CurioSeaPackage/Sources/.*\\.swift"
      - "CurioSea/.*\\.swift"
    excluded:
      - "CurioSeaPackage/Tests/.*\\.swift"
      - "CurioSeaPackage/Sources/AppComposition/CurioSeaAppFeature/Debug/.*\\.swift"
    regex: '\b(?:title|subtitle|message|description|displayName|statusText|progressText|greeting)\s*:\s*"[^"]+"'
    message: "Display argument strings must be localized."
    severity: error
```

## 项目自定义 gate

这些规则不适合只靠 SwiftLint 表达，建议写成 `Tools/Quality/*.swift` 并配脚本自测：

- package 边界：从 `Package.swift` 或 `swift package describe --type json` 推导 target 和依赖方向，禁止手写 target 映射表。
- 依赖解析：检查 Swift Package 依赖解析和锁文件漂移。
- 本地化完整性：校验源码引用、`.xcstrings` key、默认值和表名一致。
- 设计 token：禁止生产 UI 直接使用散落颜色、字体、间距常量。
- affected dispatcher：根据 diff 输出需要跑的格式、lint、package、测试 target；命中门禁脚本或配置时回退全量。
