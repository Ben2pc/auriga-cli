# 最近 30 天洞察执行路径

入口已确定模式、运行时、语言、私有工作目录与能力状态；共同证据和长期候选规则沿用入口。所有 `<skill-dir>` 均指技能根目录。

### 1. 建立会话清单与增量队列

```sh
node <skill-dir>/scripts/insights-pipeline.mjs prepare \
  --runtime <claude-code|codex> \
  --days 30 \
  > "$WORK_DIR/prepared.json"
```

默认缓存位于 `~/.cache/auriga-cli/session-compound/facets/<runtime>/`。目录权限为 `0700`，文件为 `0600`；缓存只保存短切面和失效元数据，不复制完整会话。缓存可随时删除，下次从原始日志重建。

命中要求 `runtime + session_id + content_fingerprint + facet_schema_version + analysis_prompt_version` 全部一致。单次默认最多排入 50 个未缓存会话；更多会话进入 `deferred`，报告必须披露，后续运行从未完成部分继续。

### 2. 提取并保存逐会话切面

仅处理 `analysis_queue`。把每个描述符单独写入 `$WORK_DIR/descriptor-<序号>.json`，再用对应分析器的 `--file` 生成证据，并在派遣前做确定性压缩：

```sh
node <skill-dir>/analyzers/<runtime>.mjs --file <descriptor.source_file> \
  > "$WORK_DIR/evidence-<序号>.json"
node <skill-dir>/scripts/insights-pipeline.mjs compact-evidence \
  --evidence "$WORK_DIR/evidence-<序号>.json" \
  --max-bytes 65536 \
  > "$WORK_DIR/compact-evidence-<序号>.json"
```

读取 `references/facet-dispatch.md`，用内置 Agent 分批生成严格的 `SessionFacet` JSON。每批最多 4 个压缩证据文件，输入总量最多 256 KiB；证据仍放不下时缩小批次，不把完整日志直接塞进提示。一个会话或一个批次失败不丢弃其他成功结果。无可用内置代理时不生成新切面，只使用有效缓存继续确定性汇总，保留实际覆盖与缺口。

每个有效切面通过确定性入口保存：

```sh
node <skill-dir>/scripts/insights-pipeline.mjs store \
  --descriptor <descriptor.json> \
  --facet <facet.json>
```

结构不合法的切面不进缓存。不要在本轮结束前重跑 `prepare`：原始 `$WORK_DIR/prepared.json` 保存本轮开始时的缓存命中、排队和延后事实，聚合时再显式加入本轮成功生成的切面。

### 3. 构建有界汇总输入

```sh
node <skill-dir>/scripts/insights-pipeline.mjs aggregate \
  --prepared "$WORK_DIR/prepared.json" \
  --facet "$WORK_DIR/facet-1.json" \
  --facet "$WORK_DIR/facet-2.json" \
  --max-facets 80 \
  --max-bytes 204800 \
  > "$WORK_DIR/aggregate.json"
```

全部有效切面参与机械计数；只有有界的代表性切面进入最终语义汇总。报告同时显示发现数、时间窗内数量、成功分析数、缓存命中、排除、延后和未纳入语义分析的数量。

### 4. 核对长期候选

主 Agent 从代表性切面中筛出可能满足长期门禁的反馈，执行「共同结果与长期候选核对」，并把每项核对状态、当前资产证据和会话证据加入最终归纳输入。发现初步候选却无法完成核对时，必须把它标为 `未知` 和证据限制；不能仅因为缺少核对结果就强制 `durable_candidates` 为空。

### 5. 生成近期洞察

读取 `references/insights-dispatch.md`，用无工具权限的内置 Agent 从汇总输入和当前资产核对结果生成严格的 `InsightReportData`。跨会话的“反复”结论至少引用两个独立会话；单次事实只能写成单次观察。Agent 侧阻碍、用户侧摩擦和环境问题分开陈述，同时保留有效模式。完整字段由报告渲染器确定性校验。

最终归纳代理不可用或失败时，由主代理按相同结构生成事实摘要与证据限制，使用确定性汇总的覆盖字段，不冒充独立分析。如果近期只有一个有效会话或覆盖不足，报告事实摘要和证据限制，不声称存在趋势。允许零条值得尝试和零条长期候选。

将结果写入 `$WORK_DIR/insights-data.json`，再运行：

```sh
node <skill-dir>/scripts/render-report.mjs \
  --mode insights \
  --template <skill-dir>/templates/recent-insights.html \
  --data "$WORK_DIR/insights-data.json" \
  --aggregate "$WORK_DIR/aggregate.json" \
  --output "$WORK_DIR/recent-insights.html"
```
