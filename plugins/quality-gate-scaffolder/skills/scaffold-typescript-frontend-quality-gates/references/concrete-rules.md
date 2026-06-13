# TypeScript 前端具体规则参考

本文件只放 TypeScript 前端的具体规则。使用技能时，先用 `platform-quality-gates.md` 判断工具和触发时机；需要写入 Biome、ESLint、TypeScript、测试或配置漂移规则时，再加载本文件。

## 官方文档入口

需要更多规则、确认最新规则名、确认配置字段或升级版本时，先查官方文档，不要只凭模型记忆补规则。

- Biome 文档入口：https://biomejs.dev/
- Biome linter 文档：https://biomejs.dev/linter/
- ESLint 文档入口：https://eslint.org/docs/latest/
- ESLint rules reference：https://eslint.org/docs/latest/rules/
- ESLint flat config 规则配置：https://eslint.org/docs/latest/use/configure/rules
- typescript-eslint 文档入口：https://typescript-eslint.io/
- typescript-eslint rules：https://typescript-eslint.io/rules/
- TypeScript TSConfig reference：https://www.typescriptlang.org/tsconfig/
- Vitest 文档入口：https://vitest.dev/
- Vitest 配置文档：https://vitest.dev/config/
- React Hooks ESLint plugin：https://react.dev/reference/eslint-plugin-react-hooks
- lint-staged 仓库：https://github.com/lint-staged/lint-staged
- GitHub Actions workflow 语法：https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions
- GitHub ruleset 可用规则：https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets

## package scripts 规则

建议先让 `package.json` 脚本成为稳定门禁入口：

```json
{
  "scripts": {
    "lint": "biome check --error-on-warnings . && eslint src --max-warnings 0",
    "format:check": "biome format .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

`--error-on-warnings` 和 `--max-warnings 0` 必须保留。否则 warning 会在 CI 中长期堆积，配置漂移测试也应锁住这些参数。

`lint-staged` 建议只处理 staged TypeScript 文件：

```json
{
  "lint-staged": {
    "*.{ts,tsx}": [
      "biome check --write --no-errors-on-unmatched",
      "eslint --fix --max-warnings 0 --no-warn-ignored"
    ]
  }
}
```

## Biome 规则清单

Biome 负责格式化和基础 lint，不负责类型感知规则。

```jsonc
{
  "files": {
    "includes": ["src/**", "*.ts", "*.js"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "asNeeded",
      "trailingCommas": "es5"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "useExhaustiveDependencies": "off",
        "noUnusedVariables": "off"
      },
      "style": {
        "noNonNullAssertion": "off"
      },
      "suspicious": {
        "noExplicitAny": "off",
        "noUnknownAtRules": "off"
      },
      "a11y": "off"
    }
  },
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "off"
      }
    }
  }
}
```

规则所有权：

- `useExhaustiveDependencies` 交给 ESLint React hooks 插件。
- `noUnusedVariables` 交给 `@typescript-eslint/no-unused-vars`，以支持 `_` 前缀豁免。
- `noExplicitAny` 交给 `@typescript-eslint/no-explicit-any`。
- `noUnknownAtRules` 对 Tailwind 指令关闭。
- `a11y` 整组关闭只适合内部后台预览工具；面向消费者时必须重新评估。
- `organizeImports` 关闭，避免和项目已有 import 组织策略冲突。

## ESLint 规则清单

ESLint 只承载 Biome 做不了的类型感知和 React 规则：

```js
export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', '*.config.js', '*.config.ts'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat['recommended-latest'],
    ],
    plugins: {
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'axios',
              message: '不要直接 import axios;统一走 services/apiClient。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/services/apiClient.ts'],
    rules: { 'no-restricted-imports': 'off' },
  }
)
```

渐进债务可以显式关闭，但要写清楚原因和清理方向：

- `@typescript-eslint/no-unsafe-assignment`
- `@typescript-eslint/no-unsafe-return`
- `@typescript-eslint/no-unsafe-member-access`
- `@typescript-eslint/no-unsafe-argument`
- `@typescript-eslint/no-unsafe-call`
- `@typescript-eslint/no-floating-promises`
- `@typescript-eslint/require-await`
- `@typescript-eslint/unbound-method`
- `react-hooks/set-state-in-effect`
- `react-hooks/refs`
- `react-hooks/static-components`
- `react-hooks/immutability`

分层规则至少要有一个可执行例子：页面和组件禁止直接 import 网络库，统一走 API client。目标仓库也可以用同一机制禁止跨层 import，例如页面不得直接 import 数据层、组件不得 import 路由层。

## TypeScript 规则清单

`tsconfig.json` 建议保留：

- `strict: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noFallthroughCasesInSwitch: true`
- `noEmit: true`
- `isolatedModules: true`
- `moduleResolution: "bundler"`

如果项目用 Vite 或现代 bundler，类型检查只负责类型，不负责输出。构建检查可以放 PR、合入后或定时 workflow，视耗时决定。

## Vitest 和配置漂移测试

`Vitest` 不只跑业务测试，也应保护门禁配置。建议新增或维护 `gateLintConfig.test.ts`，检查这些点：

- `package.json` 的 `lint` 必须包含 `biome check --error-on-warnings .`。
- `package.json` 的 `lint` 必须包含 `eslint src --max-warnings 0`。
- `format:check` 只检查格式，不写文件。
- `typecheck` 使用 `tsc --noEmit`。
- `lint-staged` 只处理 `*.{ts,tsx}`，且保留 Biome 和 ESLint 严格参数。
- Biome 的类型感知规则所有权不和 ESLint 重叠。
- `no-restricted-imports` 保持网络出口限制。
- API client 例外文件只有一个。
- React hooks recommended 规则仍启用。
- 无障碍规则如果关闭，测试里要写明这是内部后台工具的产品取舍。

## 版本规则

质量工具建议用补丁线约束并由锁文件固定精确版本：

- `@biomejs/biome ~2.4.16`
- `eslint ~9.39.4`
- `typescript-eslint ~8.61.0`
- `eslint-plugin-react-hooks ~7.1.1`
- `eslint-plugin-react-refresh ~0.5.2`
- `typescript ~5.9.3`
- `vitest ~3.2.6`
- `lint-staged ~17.0.7`

CI 用 `npm ci`，缓存 key 绑定 `package-lock.json`。升级 Biome、ESLint、TypeScript 或 Vitest 时，要跑配置漂移测试和完整前端门禁。
