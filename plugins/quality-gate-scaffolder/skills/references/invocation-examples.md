# 调用时机骨架

这个文件只放跨技术栈通用的调用骨架。平台工具选型和触发时机写到各平台的 `references/platform-quality-gates.md`；具体 lint 规则、自定义规则和项目 gate 清单写到各平台的 `references/concrete-rules.md`。

## 本地 hook 边界

- `pre-commit` 只做 staged 秒级检查：空白、冲突标记、可安全自动修复的文件级检查。
- `pre-push` 做基于 diff 的受影响门禁：单元测试、静态检查、类型检查、项目自有规则。
- 本地 hook 是便利层，不是权威层；必须阻止合并的规则要进入 PR required check。

```sh
#!/bin/sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

git diff --cached --check -- . ':(exclude)*.md'

changed="$(git -c core.quotepath=false diff --cached --name-only --diff-filter=ACMR)"
if [ -n "$changed" ]; then
  tools/quality/check-staged.sh
fi
```

```sh
#!/bin/sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

is_zero_sha() {
  case "$1" in
    0000000000000000000000000000000000000000) return 0 ;;
    0000000000000000000000000000000000000000000000000000000000000000) return 0 ;;
    *) return 1 ;;
  esac
}

while read -r _local_ref local_sha _remote_ref remote_sha; do
  if is_zero_sha "$local_sha"; then
    continue
  fi

  if is_zero_sha "$remote_sha"; then
    GATES_HEAD_REF="$local_sha" tools/quality/run_gates.sh all --affected
  else
    GATES_BASE_REF="$remote_sha" GATES_HEAD_REF="$local_sha" tools/quality/run_gates.sh all --affected
  fi
done
```

## 受影响 planner 边界

- shell 只负责 Git、环境变量、临时文件和进程调用。
- 路径到目标的映射放到可测试的 planner 里。
- planner 输出机器可读目标，例如 `client`、`server`、`shared`、`full`。
- 命中门禁脚本、锁文件、共享模块或未知路径时，保守扩大范围。
- planner 崩溃或基准 ref 解析失败时 fail-closed，不静默跳过。

## PR workflow 骨架

```yaml
name: Quality Checks

on:
  pull_request:
    types: [opened, ready_for_review, reopened, synchronize]

permissions:
  contents: read

jobs:
  gates:
    name: Quality Gates
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - name: Plan affected gates
        id: plan
        env:
          GATES_BASE_REF: ${{ github.event.pull_request.base.sha }}
          GATES_HEAD_REF: ${{ github.event.pull_request.head.sha }}
        run: |
          targets="$(tools/quality/run_gates.sh all --affected --print-targets)"
          if [[ -n "$targets" ]]; then echo "run=true" >> "$GITHUB_OUTPUT"; else echo "run=false" >> "$GITHUB_OUTPUT"; fi
      - name: Run gates
        if: steps.plan.outputs.run == 'true'
        run: tools/quality/run_gates.sh all
```

## 合入后和定时 workflow 边界

- 合入 `main` 后跑昂贵但需要尽快发现的问题：全量构建、发布 dry run、平台专属深度分析。
- 定时 workflow 跑重型回归和环境型检查：截图、设备、外部服务巡检、依赖扫描。
- 这些 workflow 可以上传 artifact 或创建 issue，但不要替代 PR required check。
