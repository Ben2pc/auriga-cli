# Python 后端质量门禁参考

## 已验证来源项目

`lingolens/backend` 提供了来源模式。已观察到的硬门禁入口是仓库根 `tools/quality/run_gates.sh`，受影响范围由 `tools/quality/planner.py` 规划，后端专属规则主要落在 `backend/pyproject.toml` 和 `backend/tools/quality/gate_*.py`。

GitHub 侧模式在 monorepo 中使用名为 `Backend Gates` 的拉取请求检查。workflow 总是对非 Draft 拉取请求上报，先用 `tools/quality/run_gates.sh backend --affected --print-targets` 做计划，再决定是否安装依赖和执行完整后端门禁。

## 第一层：工具选型和版本策略

| 工具 | 作用 | 版本选择建议 |
| --- | --- | --- |
| Python / `uv` workspace | 统一后端依赖、虚拟环境和多包工作区，`api`、`shared`、`worker` 三个成员包在同一环境检查 | Python 版本写在 `requires-python`，当前参考为 `>=3.12`；精确依赖解析由 `uv.lock` 固定 |
| `pyproject.toml` dependency groups | 区分运行时、测试、开发和类型 stub 依赖 | 质量工具用 `~=` 锁补丁线，例如 `ruff~=0.15.10`、`mypy~=1.20.0`、`import-linter~=2.11.0`、`pytest~=9.0.3`；minor 或 major 升级必须显式改配置并单独验证 |
| Ruff | 同时承载 lint 和格式检查，避免 Black、isort、flake8 多工具漂移 | 版本在 dev group 锁补丁线；`target-version = "py312"`、`line-length = 100` 和 `src` 一起版本化 |
| Mypy + Pydantic 插件 | 做渐进式类型检查，特别是 FastAPI / Pydantic 动态模型 | 版本锁补丁线；类型 stub 单独放 types group，stub 变化会改变检查结果，不能靠浮动依赖自动漂 |
| Import Linter | 把包间依赖方向机制化，例如 `api` 和 `worker` 双向独立、`shared` 零上游 | 规则写进 `pyproject.toml`，和代码同仓库演进；Import Linter 升级要跑完整边界门禁 |
| Pytest / pytest-asyncio / pytest-cov | 单元测试、异步测试、门禁脚本测试和部署检查测试 | 测试工具锁补丁线；默认门禁不应依赖外部网络，外部服务测试另分 marker 或独立 workflow |
| `gate_*.py` 项目门禁 | 执行部署模板、任务注册、环境出口、workspace 依赖等业务不变量 | 作为项目源码维护；每个 gate 都要有 Pytest 覆盖，避免脚本本身漂移 |
| `tools/quality/run_gates.sh` + `planner.py` | 给本地 hook 和 CI 提供单一入口；根据 diff 输出 `backend:full`、`backend:api`、`backend:worker`、`frontend` 等 token | shell 只做 Git、环境变量和流程编排；路径分类逻辑放在可测试的 Python planner；planner 失败时 fail-closed 回退全量 |
| GitHub Actions | 提供不可绕过的 `Backend Gates` required check | `actions/checkout`、`astral-sh/setup-uv` 等 action 用稳定主版本或提交 SHA；Python/uv 缓存 key 绑定 `backend/uv.lock` |

## 第二层：现有规则配置参考

| 配置或脚本 | 当前规则参考 |
| --- | --- |
| `backend/pyproject.toml` `[tool.ruff]` | 目标 Python 版本、行宽、源码根和 lint 显式严格集在同一配置中维护 |
| Ruff ignore | `E501` 交给 formatter；`RUF001-003` 放行中文标点；`B008` 放行 FastAPI `Depends()`；`S101` 放行 pytest 和内部断言 |
| Ruff per-file ignores | `api` 和 `shared` 不豁免；`worker/**` 记录存量债务；`tests/**`、`tools/**`、`scripts/**` 和 `__init__.py` 有明确场景豁免 |
| `backend/pyproject.toml` `[tool.mypy]` | 启用 `pydantic.mypy`，`mypy_path` 覆盖三个成员包，`python_version = "3.12"`；`api` 和 `shared` 保持较高基线，`worker` 的存量类型债务用 override 明确登记 |
| `backend/pyproject.toml` `[tool.importlinter]` | 后端成员包独立性、共享层零上游、路由层访问边界和 worker 内部分层规则用导入契约表达 |
| `backend/tools/quality/gate_*.py` | 覆盖导入契约、运行时边界、workspace 成员依赖、worker task 注册、pytest collection 边界、provider 出口、部署模板、部署 planner、shell lint 等 |
| `tools/quality/run_gates.sh` | 后端全量执行 `uv run ruff check . ../tools`、`uv run ruff format --check . ../tools`、`uv run mypy api/src shared/src worker/src ../tools`、`uv run pytest -q`；`api` 或 `worker` scope 会缩小测试集合但仍带上门禁测试 |
| `tools/quality/planner.py` | 路径映射到 `backend:full`、`backend:api`、`backend:worker`、`frontend`；门禁脚本、共享层或未知路径保守扩大范围 |
| `.githooks/pre-commit` | staged `.py` 只跑 Ruff check 和 Ruff format check；frontend 路径交给 `lint-staged`；通用空白检查用 `git diff --cached --check` |

## 具体规则文件

具体 Ruff 规则集、Mypy 基线、Import Linter 契约、测试边界和项目自定义 gate 清单见 `concrete-rules.md`。需要写入或调整目标仓库规则配置时，先读取该文件，不要只依赖本总览。

## 第三层：触发时机建议

| 时机 | 适合检查 | 不适合检查 | 当前参考 |
| --- | --- | --- | --- |
| `pre-commit` | staged 空白检查、staged Python 文件 Ruff check / format check | 全量 Mypy、全量 Pytest、依赖安装、Docker 或外部服务 | `lingolens/.githooks/pre-commit` |
| `pre-push` | `run_gates.sh all --affected`，按 diff 跑后端或前端受影响门禁；后端可落到 `backend:api` 或 `backend:worker` | 需要云凭证、外部服务或长时间端到端测试 | `lingolens/.githooks/pre-push` |
| PR CI | `Backend Gates`：计划受影响范围、安装 uv 环境、Ruff、Mypy、Pytest、门禁脚本测试和导入边界 | workflow 级 `paths-ignore`；会导致 required check 在纯文档 PR 上不汇报 | `lingolens/.github/workflows/backend-quality-checks.yml` |
| 合入 `main` 后 | 部署模板验证、构建镜像、迁移脚本 dry run、生产发布前更重的集成检查 | PR 已经跑过的秒级格式检查 | 来源项目当前主要把部署 gate 放进后端门禁；目标仓库若有发布链路，可拆出 main push workflow |
| 定时 workflow | 依赖外部服务、长耗时数据库/队列集成、过期依赖扫描、真实部署环境巡检 | 必须阻止合并的基础静态检查 | 来源项目未观察到独立后端定时 workflow；新仓库可按成本和误报率添加 |

基于 diff 的本地检查建议：

- `pre-push` 读取 Git hook stdin 的 `local_sha remote_sha`；已有远端分支检查 `remote_sha..local_sha`，新分支回退到 `merge-base HEAD origin/main`。
- `git diff --name-only` 必须加 `-c core.quotepath=false`，否则中文或非 ASCII 路径会被转义，planner 容易误判。
- shell 不直接维护路径映射；把 changed files 管道传给 `planner.py`，由 planner 输出机器 token。
- planner 崩溃、无法解析基准、命中门禁脚本或共享层时，都要保守回退到 `backend:full` 或两端全量。
- PR CI 可以先 plan 后跳过安装依赖，但 workflow 本身仍要触发并绿色结束，避免 required check 卡在 Expected。

## 示例

共享 hook 和 workflow 模板见 `../../references/invocation-examples.md`。Python 后端侧可以按下面形态落地：

```sh
# 查看当前分支会触发哪些后端目标
tools/quality/run_gates.sh backend --affected --print-targets

# 本地跑受影响门禁
tools/quality/run_gates.sh all --affected

# CI 或发布前跑后端全量门禁
tools/quality/run_gates.sh backend
```

```yaml
jobs:
  backend:
    name: Backend Gates
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-24.04
    timeout-minutes: 15
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
          targets="$(tools/quality/run_gates.sh backend --affected --print-targets)"
          echo "targets<<EOF" >> "$GITHUB_OUTPUT"
          echo "$targets" >> "$GITHUB_OUTPUT"
          echo "EOF" >> "$GITHUB_OUTPUT"
          if [[ -n "$targets" ]]; then echo "run=true" >> "$GITHUB_OUTPUT"; else echo "run=false" >> "$GITHUB_OUTPUT"; fi
      - uses: astral-sh/setup-uv@v5
        if: steps.plan.outputs.run == 'true'
        with:
          enable-cache: true
          cache-dependency-glob: backend/uv.lock
      - name: Install backend dependencies
        if: steps.plan.outputs.run == 'true'
        run: cd backend && uv sync --all-groups
      - name: Run backend gates
        if: steps.plan.outputs.run == 'true'
        run: tools/quality/run_gates.sh backend
```
