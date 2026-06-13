# Python 后端具体规则参考

本文件只放 Python 后端的具体规则。使用技能时，先用 `platform-quality-gates.md` 判断工具和触发时机；需要写入 `pyproject.toml`、门禁脚本或项目 gate 时，再加载本文件。

## 官方文档入口

需要更多规则、确认最新规则名、确认配置字段或升级版本时，先查官方文档，不要只凭模型记忆补规则。

- uv 依赖管理文档：https://docs.astral.sh/uv/concepts/projects/dependencies/
- Ruff 文档入口：https://docs.astral.sh/ruff/
- Ruff 规则目录：https://docs.astral.sh/ruff/rules/
- Mypy 文档入口：https://mypy.readthedocs.io/
- Mypy 配置文件文档：https://mypy.readthedocs.io/en/stable/config_file.html
- Pydantic Mypy plugin：https://pydantic.dev/docs/validation/latest/integrations/dev-tools/mypy/
- Import Linter 文档：https://import-linter.readthedocs.io/
- Pytest 文档入口：https://docs.pytest.org/en/stable/contents.html
- Pytest markers 文档：https://docs.pytest.org/en/stable/how-to/mark.html
- FastAPI dependencies 文档：https://fastapi.tiangolo.com/tutorial/dependencies/
- GitHub Actions workflow 语法：https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions
- GitHub ruleset 可用规则：https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets

## 依赖和版本规则

建议把质量工具放在依赖组里，并用补丁线约束：

- `ruff~=0.15.10`
- `mypy~=1.20.0`
- `import-linter~=2.11.0`
- `pytest~=9.0.3`
- `pytest-asyncio~=1.3.0`
- `pytest-cov~=7.1.0`
- `pyyaml~=6.0.3`
- `types-pyyaml~=6.0.12`
- `types-requests~=2.33.0`

精确解析交给锁文件；minor 或 major 升级必须显式改配置并跑完整门禁。类型 stub 也会改变 Mypy 结果，不能无上界漂移。

## Ruff 规则清单

Ruff 建议统一承载 lint、import 排序和 format，不和 Black、isort、flake8 并存。

```toml
[tool.ruff]
target-version = "py312"
line-length = 100
src = ["api/src", "shared/src", "worker/src"]
extend-exclude = ["tools/ops/scripts/archive"]

[tool.ruff.lint]
select = [
  "E", "W", "F", "I", "N", "UP", "B", "A", "C4", "SIM", "PTH",
  "TID", "ARG", "RUF", "PLE", "PLW", "ASYNC", "S",
]
ignore = ["E501", "RUF001", "RUF002", "RUF003", "B008", "S101"]
```

这组规则摘要可写入文档：`E/W/F/I/N/UP/B/A/C4/SIM/PTH/TID/ARG/RUF/PLE/PLW/ASYNC/S`。

规则含义：

- `E/W`：基础 pycodestyle 错误和警告。
- `F`：未定义名、未用 import 等高信号问题。
- `I`：import 排序。
- `N`：命名规范。
- `UP`：语法现代化。
- `B`：bugbear 易错模式。
- `A`：内建名遮蔽。
- `C4`、`SIM`：推导式和控制流简化。
- `PTH`：推动 `pathlib`。
- `TID`：符号级黑名单；模块级边界交给 Import Linter。
- `ARG`：未用参数。
- `RUF`：Ruff 原生规则。
- `PLE/PLW`：Pylint 错误和警告子集，不开重构噪音。
- `ASYNC`：异步函数内阻塞调用等陷阱。
- `S`：Bandit 安全规则。

ignore 原因：

- `E501`：行长交给 formatter。
- `RUF001/002/003`：中文注释和中文文案里的标点是预期。
- `B008`：FastAPI `Depends()` 在默认参数中是框架惯用法。
- `S101`：pytest 断言和内部不变量检查是预期。

per-file ignore 建议：

- `api/**` 和 `shared/**` 不豁免，作为对外契约和共享层保持高基线。
- `worker/**` 可临时登记存量债务，例如异步阻塞、未用参数、SQL 字符串、`pathlib` 迁移、global 状态、类属性标注。
- `**/tests/**` 放宽 `ARG`、`S`、`N`、`PLW`。
- `tools/**`、`../tools/**` 和 `**/scripts/**` 放宽工具脚本安全和参数规则。
- `**/__init__.py` 放宽 re-export 的 `F401`。

## Mypy 规则清单

建议先建立能长期收紧的类型基线：

```toml
[tool.mypy]
plugins = ["pydantic.mypy"]
mypy_path = ["api/src", "shared/src", "worker/src"]
explicit_package_bases = true
python_version = "3.12"
ignore_missing_imports = true
```

策略：

- FastAPI / Pydantic 项目优先启用 `pydantic.mypy`。
- `api` 和 `shared` 作为移动端消费和后端共享契约，优先清零类型错误。
- `worker` 存量类型债务用 `[[tool.mypy.overrides]]` 精确列模块，不用全局 `ignore_errors`。
- 每偿还一个模块，就从 override 删除对应行。
- 新模块不应默认进入债务清单。

## Import Linter 规则清单

后端多包架构建议用 Import Linter 写边界契约：

```toml
[tool.importlinter]
root_packages = ["lingolens_api", "lingolens_shared", "lingolens_worker"]

[[tool.importlinter.contracts]]
name = "api ⊥ worker(双向独立)"
type = "independence"
modules = ["lingolens_api", "lingolens_worker"]

[[tool.importlinter.contracts]]
name = "shared 零上游(不得 import api / worker)"
type = "forbidden"
source_modules = ["lingolens_shared"]
forbidden_modules = ["lingolens_api", "lingolens_worker"]

[[tool.importlinter.contracts]]
name = "api routers 不直连 db engine(数据访问经 repository 层)"
type = "forbidden"
source_modules = ["lingolens_api.routers"]
forbidden_modules = ["lingolens_shared.infrastructure.db"]
allow_indirect_imports = "true"

[[tool.importlinter.contracts]]
name = "worker: services → providers 单向"
type = "layers"
layers = ["lingolens_worker.services", "lingolens_worker.providers"]
```

原则：

- 静态导入契约负责“代码层看得见”的依赖方向。
- 动态 import、`__init__` 副作用和子进程启动边界需要项目自定义 gate 兜底。
- 如果已有反向边，必须用 `ignore_imports` 精确列出，并挂技术债务。

## 测试和默认无网络规则

建议将常规测试设计成默认无网络：

- 单元测试默认禁止真实外部请求。
- 访问数据库、队列、对象存储、模型服务的测试使用 fixture、stub 或单独 marker。
- 需要真实外部服务的测试不进 PR required check，放定时、手工或发布前 workflow。
- Pytest collection 边界要有 gate，防止 API 测试误收 worker 依赖或反过来。

## 项目自定义 gate

来源项目可参考的 gate 清单：

- `gate_import_contracts`：包装 Import Linter，统一输出和失败信息。
- `gate_api_worker_boundary`：用运行时子进程验证 API 和 worker 不互相触发副作用。
- `gate_workspace_member_dependencies`：确保 workspace 成员依赖诚实声明，不靠根包重复声明掩盖漏依赖。
- `gate_worker_task_registration`：检查后台任务注册、命名和 composition root。
- `gate_pytest_collection_boundaries`：检查测试收集范围不会跨边界。
- `gate_provider_egress_guard`：确保 provider 外部出口通过统一防线。
- `gate_deploy_templates`：检查部署模板语法、服务名、volume、环境变量形状。
- `gate_deploy_planner`：检查部署规划脚本的路径和目标解析。
- `gate_shell_lint`：检查 shell 脚本的安全写法和可执行入口。

## run_gates 规则

建议让本地 pre-push 和 CI 共用一个入口：

```sh
tools/quality/run_gates.sh backend
tools/quality/run_gates.sh backend --affected --print-targets
tools/quality/run_gates.sh all --affected
```

后端全量目标建议固定顺序：

1. `ruff check`
2. `ruff format --check`
3. `mypy`
4. `pytest`

粒度目标可以分为 `backend:full`、`backend:api`、`backend:worker`。命中共享层、门禁脚本、锁文件或未知路径时回退 full。
