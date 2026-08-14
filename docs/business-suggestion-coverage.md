# 业务补全覆盖率评估

该工具只调用现有 `getLocalGraphSuggestions()` 接口读取建议，不修改业务规则、图文件或线上补全行为。

## 使用方法

默认分析 `src/test/fixtures` 下的所有 JSON 图：

```bash
npm run analyze:business-coverage
```

同时分析仓库中某个明确存在的图文件：

```bash
npm run analyze:business-coverage -- "example/business-label-note-compare/1785898854769.txt"
```

只分析该文件，不扫描其他 fixtures：

```bash
npm run analyze:business-coverage -- --no-fixtures "example/business-label-note-compare/1785898854769.txt"
```

外部时间戳 `.txt` 文件不是项目依赖，也不会写死在源码或文档命令中。需要分析时，将自己机器上实际存在的文件路径作为最后一个参数传入即可；没有该文件时，直接使用默认命令分析项目 fixtures。

默认报告写入 `tmp/business-suggestion-coverage.json`。`tmp` 已被 Git 和 VS Code 插件打包忽略。可以使用 `--output` 指定其他位置。

## 统计口径

- `focusCount`：可被用户选中的真实触点、线圈、沿或功能块数量。默认不统计 `editRect/branchRect`。
- `businessFocusCoveragePercent`：至少返回一条业务 `title/text` 的焦点占比。
- `businessSuggestionPercent`：全部建议中使用业务文案的建议占比。
- `evidenceFocusCoveragePercent`：至少有一条建议携带业务诊断证据的焦点占比。
- `evidenceSuggestionPercent`：全部建议中携带业务诊断证据的建议占比。
- `structuralOnlyFocuses`：有建议，但全部使用“前串联/后串联”等结构文案的焦点数量。
- `duplicateSuggestionCount`：同一焦点中拓扑位置和新增元素完全相同的重复建议数量。
- `libraryValidationIssueCount`：建议中的功能块不存在于真实库，或端口名称、方向、类型与库不一致的数量。

业务文案与业务证据是两个不同指标。某条建议可能因为极性或排序规则而具有业务证据，但标题仍是“并联 常闭触点”；这种建议计入证据覆盖率，不计入业务文案覆盖率。

## 报告用途

报告按文件和节点保存建议标题、规则 ID、签名 ID、评分、结构回退和库校验结果，可以用于定位现有规则的真实缺口。覆盖率只表示规则是否给出了业务文案，不等同于建议业务正确率；新增规则仍需正反例回归确认。
