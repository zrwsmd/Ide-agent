# Ide Agent

Ide Agent 是一个面向 IEC 61131-3 PLC 开发场景的 VS Code 插件实验项目。当前目标不是做通用聊天助手，而是围绕 ST 文本代码和 LD/FBD 图形编辑器，提供“下一步可能补什么”的辅助能力。

项目目前重点研究两类能力：

1. ST 文本补全：在 `.st` / Structured Text 文件中，根据当前光标上下文调用大模型，返回灰色行内补全文本。
2. LD/FBD 图结构建议：根据前端保存的 LD/FBD 图 JSON、当前选中节点/插入点、可选截图和 ST 代码，返回前端可以渲染的 `suggestions` JSON。

## 当前能力

### ST 文本补全

ST 文本补全走大模型链路。

触发方式：

- 用户在 ST 文件中输入、换行，VS Code 自动触发行内补全。
- 手动执行命令 `Ide Agent: Trigger ST Completion`。

主要流程：

```text
用户编辑 ST 文件
  -> VS Code 触发 Inline Completion
  -> STInlineCompletionProvider 收集光标上下文
  -> 构造 prompt
  -> 调用当前配置的大模型供应商
  -> 清洗模型返回内容
  -> 返回 vscode.InlineCompletionItem
  -> VS Code 显示灰色补全文本
```

ST 补全不会默认把整个文件都发给模型，而是按配置截取上下文：

- `ide-agent.completion.maxContextLines`：光标前最多发送多少行，默认 `140`。
- `ide-agent.completion.maxAfterLines`：光标后最多发送多少行，默认 `30`。
- `ide-agent.completion.maxCompletionLines`：最多接受模型返回多少行，默认 `16`。
- `ide-agent.completion.requestTimeoutMs`：请求超时时间，默认 `20000ms`。

相关代码：

- `src/completion/STInlineCompletionProvider.ts`
- `src/completion/STContext.ts`
- `src/extension.ts`

### LD/FBD 大模型图建议

LD/FBD 大模型图建议会调用远端模型。它适合需要结合 ST 语义、图拓扑和截图视觉焦点一起判断的场景。

触发方式：

- 侧边栏点击 `Graph Predict`
- 侧边栏点击 `Graph Predict + Image`
- 命令 `Ide Agent: Predict LD/FBD Graph Completion`
- 命令 `Ide Agent: Predict LD/FBD Graph Completion With Screenshot`

主要流程：

```text
用户触发 Graph Predict / Graph Predict + Image
  -> GraphCompletionService 读取当前 ST 文件
  -> 读取前端保存的图 JSON
  -> DiagramSummary 压缩图 JSON 为拓扑摘要
  -> 可选读取截图并转成模型可识别的 image input
  -> 构造 prompt
  -> 调用大模型
  -> 提取并规范化 suggestions JSON
  -> 过滤/修正不适合前端展示的内容
  -> 复制 JSON 到剪贴板
  -> 输出日志到 Output: Ide Agent
```

大模型图建议会做后处理，主要用于兜住模型不稳定返回：

- 不让 `edit-node-rect`、`start-node-line`、`end-node-line` 这类前端内部节点名出现在用户可见文案里。
- 把 `???` 或空变量名显示为 `未命名1`、`未命名2`。
- 按节点类型生成更准确的中文名称：
  - `contact` -> `常开触点`
  - `negatedContact` -> `常闭触点`
  - `risingContact` -> `上升沿`
  - `fallingContact` -> `下降沿`
  - `coil` -> `线圈`
  - `setCoil` -> `置位线圈`
  - `resetCoil` -> `复位线圈`
- 如果模型只识别出类似 `SR 功能块`，但没有返回 `matchedNodeId`，会尝试结合当前图 JSON 反查唯一匹配节点。
- 如果发现下游已经有输出节点，会过滤明显不合法的重复输出建议。

注意：`Graph Predict + Image` 需要当前模型/供应商支持视觉输入，否则可能响应慢、超时或识别不稳定。

相关代码：

- `src/graph/GraphCompletionService.ts`
- `src/graph/ScreenshotContext.ts`
- `src/diagram/DiagramSummary.ts`
- `src/extension.ts`

### LD/FBD 本地图建议

LD/FBD 本地图建议不请求大模型，直接根据图 JSON 和当前焦点节点生成建议。它适合需要毫秒级响应的前端交互，例如用户选中某个触点、功能块、线圈或插入点时，立即给出附近可以添加什么图元。

触发方式：

- 侧边栏点击 `Local Graph Suggest`
- 命令 `Ide Agent: Local LD/FBD Suggestions`
- 外部插件/前端集成调用命令 `ide-agent.getLocalGraphSuggestions`

当前没有和真实前端事件完全打通时，会弹出输入框，让测试者输入：

- 选中节点 id，例如 `contact-xxx`
- 插入点 id，例如 `edit-node-rect`
- 变量名，例如 `j`

前端或其他 VS Code 插件正式接入时，不需要弹框输入，直接通过命令参数调用：

```ts
const result = await vscode.commands.executeCommand(
  "ide-agent.getLocalGraphSuggestions",
  {
    diagramPath: "C:\\Users\\Administrator\\.vscode\\extensions\\ytak.devuni-ide-vscode-1.0.21\\tool\\iec-runtime-gen-run\\.depworkspace\\transLd.txt",
    selectedNodeId: "contact-47078324-1782348633397"
  }
);
```

如果当前选中的是插入点，则传：

```ts
const result = await vscode.commands.executeCommand(
  "ide-agent.getLocalGraphSuggestions",
  {
    diagramPath: "C:\\Users\\Administrator\\.vscode\\extensions\\ytak.devuni-ide-vscode-1.0.21\\tool\\iec-runtime-gen-run\\.depworkspace\\transLd.txt",
    selectedInsertionPointId: "edit-node-rect"
  }
);
```

返回结果里主要看：

- `result.payload`：结构化 suggestions 对象。
- `result.jsonText`：格式化后的 JSON 字符串，方便日志或调试展示。
- `result.diagramPath`：本次读取的图 JSON 路径。

这个命令不会弹输入框、不会复制剪贴板、不会请求大模型，只根据传入的 `diagramPath` 和当前选中 id 返回本地规则建议。

主要流程：

```text
用户触发 Local Graph Suggest
  -> LocalGraphSuggestionService 读取图 JSON
  -> 根据 selectedNodeId / selectedInsertionPointId / selectedVar 定位焦点
  -> 分析当前节点左右邻居、上下游输出节点、半成品图状态
  -> 按本地 IEC 61131-3 基础规则生成 suggestions
  -> 复制 JSON 到剪贴板
  -> 输出日志到 Output: Ide Agent
```

当前本地规则覆盖：

- 选中触点：前串触点、后串触点、后插功能块、并联触点、并联功能块、无下游输出时添加线圈。
- 选中功能块：EN 前串触点、输出端后串触点、无下游输出时添加线圈。
- 选中线圈：线圈前串触点、并联线圈、改成置位线圈、线圈前插功能块。
- 选中插入点：根据 `sourceIds / targetIds` 判断是在两个节点之间、在线圈前、在功能块前，还是在末尾。
- 半成品图：如果有逻辑节点但没有输出节点，会优先给出补输出节点的建议。
- 未命名节点：不原样显示 `???`，而是按图内顺序显示为 `未命名1`、`未命名2`。

本地图建议不识图、不读截图，也不依赖 ST 文件。后续前端真正接入时，建议前端直接传当前选中节点或插入点。

相关代码：

- `src/graph/LocalGraphSuggestionService.ts`
- `src/diagram/DiagramSummary.ts`
- `src/extension.ts`

## 图 JSON 路径

当前图 JSON 读取路径在代码中定义：

```text
src/diagram/DiagramSummary.ts
```

当前默认值：

```text
C:\Users\Administrator\.vscode\extensions\ytak.devuni-ide-vscode-1.0.21\tool\iec-runtime-gen-run\.depworkspace\transLd2.txt
```

这个路径目前还是临时写死的，后续建议改成 VS Code 配置项，或者由前端/宿主环境调用命令时传入。

## LLM 供应商

当前支持两个供应商：

- `SiliconFlow`
- `Anthropic Compatible`

API Key 存在 VS Code Secret Storage 中，不写入配置文件。

相关代码：

- `src/llm/LLMFactory.ts`
- `src/llm/OpenAICompatibleAdapter.ts`
- `src/llm/SiliconFlowAdapter.ts`
- `src/llm/AnthropicCompatibleAdapter.ts`
- `src/llm/types.ts`

## 插件命令

package.json 中注册的主要命令：

```text
Ide Agent: Open Panel
Ide Agent: Trigger ST Completion
Ide Agent: Local LD/FBD Suggestions
Ide Agent: Predict LD/FBD Graph Completion
Ide Agent: Predict LD/FBD Graph Completion With Screenshot
Ide Agent: Show Logs
```

## 重要配置

```json
{
  "ide-agent.llm.provider": "siliconflow",
  "ide-agent.llm.siliconflowModel": "Qwen/Qwen3-Coder-30B-A3B-Instruct",
  "ide-agent.llm.siliconflowBaseUrl": "",
  "ide-agent.llm.anthropicCompatibleModel": "MiniMax-M1",
  "ide-agent.llm.anthropicCompatibleBaseUrl": "",
  "ide-agent.completion.enabled": true,
  "ide-agent.completion.automatic": true,
  "ide-agent.completion.debug": true,
  "ide-agent.completion.maxContextLines": 140,
  "ide-agent.completion.maxAfterLines": 30,
  "ide-agent.completion.maxCompletionLines": 16,
  "ide-agent.completion.requestTimeoutMs": 20000
}
```

## 开发运行

安装依赖：

```powershell
npm install
```

编译：

```powershell
npm run compile
```

开发调试：

```text
用 VS Code 打开 E:\bbb\Ide-agent，按 F5 启动 Extension Development Host。
```

打包：

```powershell
npm run package
```

`npm run package` 会自动执行 `vscode:prepublish`：

```text
npm run compile -> npm run obfuscate -> vsce package
```

其中 `npm run obfuscate` 会压缩混淆 `dist/**/*.js`，并清理 `dist/**/*.map`。打出的 VSIX 不包含 `src/**`、`scripts/**`、`.ts`、`.map` 等开发源码文件。

生成的插件包路径：

```text
E:\bbb\Ide-agent\ide-agent-0.0.1.vsix
```

本地安装 / 升级 VSIX：

```powershell
code --install-extension E:\bbb\Ide-agent\ide-agent-0.0.1.vsix --force
```

也可以在 VS Code 里手动安装：

```text
Extensions -> ... -> Install from VSIX... -> 选择 ide-agent-0.0.1.vsix
```

安装或升级后，建议执行：

```text
Developer: Reload Window
```

检查 VSIX 是否包含源码或 source map：

```powershell
$vsix='E:\bbb\Ide-agent\ide-agent-0.0.1.vsix'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[System.IO.Compression.ZipFile]::OpenRead($vsix)
try {
  $zip.Entries |
    Where-Object { $_.FullName -match '(^|/)extension/src/|(^|/)extension/scripts/|\.map$|\.ts$' } |
    Select-Object -ExpandProperty FullName
} finally {
  $zip.Dispose()
}
```

如果没有输出，说明当前包里没有 `src/**`、`scripts/**`、`.map` 或 `.ts` 文件。

查看日志：

```text
Output -> Ide Agent
```

## 本地规则测试脚本

下面这些脚本用于离线验证 LD/FBD 本地 suggest 规则，不会请求大模型，也不需要启动 VS Code 插件。它们都根据传入的图 JSON / `transLd.txt` 文件进行判断。

先进入项目目录：

```powershell
cd E:\bbb\Ide-agent
```

测试功能块规则，第二个参数可以传功能块实例名或完整 nodeId。下面示例选中图里的 `CTU n` 功能块：

```powershell
node scripts/test-function-block-suggestions.js "C:\Users\Administrator\.vscode\extensions\ytak.devuni-ide-vscode-1.0.21\tool\iec-runtime-gen-run\.depworkspace\transLd.txt" n
```

测试触点规则，默认测试当前图里的 `e` 常开触点：

```powershell
node scripts/test-contact-suggestions.js "C:\Users\Administrator\.vscode\extensions\ytak.devuni-ide-vscode-1.0.21\tool\iec-runtime-gen-run\.depworkspace\transLd.txt"
```

也可以指定其他触点变量名或完整 nodeId，例如：

```powershell
node scripts/test-contact-suggestions.js "C:\Users\Administrator\.vscode\extensions\ytak.devuni-ide-vscode-1.0.21\tool\iec-runtime-gen-run\.depworkspace\transLd.txt" d
```

测试线圈规则，默认测试当前图里的 `t` 线圈：

```powershell
node scripts/test-coil-suggestions.js "C:\Users\Administrator\.vscode\extensions\ytak.devuni-ide-vscode-1.0.21\tool\iec-runtime-gen-run\.depworkspace\transLd.txt"
```

也可以指定其他线圈变量名或完整 nodeId，例如：

```powershell
node scripts/test-coil-suggestions.js "C:\Users\Administrator\.vscode\extensions\ytak.devuni-ide-vscode-1.0.21\tool\iec-runtime-gen-run\.depworkspace\transLd.txt" t
```

脚本输出内容包括：

- 当前选中的节点信息。
- 从 JSON 拓扑中识别到的左邻 / 右邻节点。
- 当前规则解释。
- 最终生成的 suggestions JSON。

## 目录结构

```text
src/extension.ts
  插件激活入口，注册命令、侧边栏、ST 行内补全、图建议服务。

src/ui/ConfigPanelProvider.ts
  Ide Agent 侧边栏界面，负责供应商配置、API Key 保存、触发按钮。

src/completion/STContext.ts
  ST 文件上下文提取、符号分析、代码区域判断。

src/completion/STInlineCompletionProvider.ts
  ST 行内补全核心逻辑，负责触发判断、prompt 构造、模型调用、结果清洗。

src/diagram/DiagramSummary.ts
  读取前端图 JSON，并压缩成图拓扑摘要。

src/graph/GraphCompletionService.ts
  LD/FBD 大模型图建议逻辑，支持 ST + 图 JSON + 可选截图。

src/graph/LocalGraphSuggestionService.ts
  LD/FBD 本地图建议逻辑，不请求大模型。

src/graph/ScreenshotContext.ts
  截图选择、读取和 base64 data URL 转换。

src/llm/*
  大模型供应商适配层。
```

## suggestions 输出形态

LD/FBD 图建议统一返回 `ide-agent.graph-completion.v1` 结构：

```json
{
  "schemaVersion": "ide-agent.graph-completion.v1",
  "action": "suggestGraphCompletions",
  "segmentId": "segment-2",
  "confidence": 1,
  "recognizedFocus": {
    "visualElement": "SR f 功能块",
    "matchedNodeId": "FBD-compartment-SR-xxx",
    "matchedNodeType": "FBDCompartment",
    "matchedVar": "f",
    "confidence": 0.9
  },
  "suggestions": [
    {
      "id": "option-1",
      "mode": "seriesAfter",
      "confidence": 0.9,
      "placement": {
        "relationToFocus": "afterSelected",
        "anchorNodeId": "FBD-compartment-SR-xxx",
        "anchorNodeVar": "f",
        "insertAfterNodeId": "FBD-compartment-SR-xxx",
        "insertBeforeNodeId": "coil-xxx",
        "parallelToNodeId": "",
        "branchFromNodeId": "",
        "branchToNodeId": "",
        "portName": "",
        "text": "在 SR f 功能块和 j 线圈之间串联一个常开触点"
      },
      "addElement": {
        "nodeType": "contact",
        "displayLabel": "常开触点",
        "variableSource": "userInput",
        "variableName": "",
        "dataType": "BOOL",
        "userInputRequired": true,
        "blockType": "",
        "instanceSource": "",
        "instanceName": ""
      }
    }
  ]
}
```

前端主要看：

- `recognizedFocus`：当前识别到的选中节点。
- `suggestions[].placement`：建议插入位置。
- `suggestions[].addElement`：建议新增的图元类型。

## 当前限制和 TODO

- 图 JSON 路径目前写死，建议改成配置项或命令参数。
- `Graph Predict + Image` 依赖视觉模型，非视觉模型或较慢供应商可能超时。
- 大模型图建议的稳定性依赖 ST、图 JSON、截图三者是否对应同一张图。
- 本地图建议目前需要手动输入节点 id / 插入点 id，后续应由前端直接传入当前选中焦点。
- 当前没有专门的单元测试，后续建议给 `DiagramSummary`、本地图规则、AI 返回后处理补测试。
