# Ide Agent Core Integration

本文档说明 `Ide-agent` VS Code 插件和独立 `@ide-agent/core` 包的关系，以及外部项目该如何调用本地 LD/FBD suggestions 能力。

## 两个项目的职责

`zrwsmd/Ide-agent`

- VS Code 插件项目。
- 提供 ST 文本补全、配置界面、日志、命令注册、VSIX 打包。
- 保留命令调用方式：`ide-agent.getLocalGraphSuggestions`。
- 插件内部也复用同一套 core 规则。

`zrwsmd/ide-agent-core`

- 独立 npm 包项目，包名是 `@ide-agent/core`。
- 不依赖 VS Code API。
- 不请求大模型。
- 只负责读取前端生成的 LD/FBD 图 JSON/TXT，定位当前选中节点或插入点，生成本地规则 suggestions。

## 什么时候用哪种方式

如果调用方是另一个 VS Code 插件，推荐使用 VS Code 命令：

```ts
const result = await vscode.commands.executeCommand(
  "ide-agent.getLocalGraphSuggestions",
  {
    diagramPath,
    segmentId,
    selectedNodeId
  }
);
```

这种方式要求用户已安装 `Ide Agent` VS Code 插件。

如果调用方是普通 Node/TypeScript 项目，推荐安装 core 包后直接 import：

```bash
npm install github:zrwsmd/ide-agent-core
```

```ts
import { getLocalGraphSuggestions } from "@ide-agent/core";

const result = await getLocalGraphSuggestions({
  diagramPath,
  segmentId,
  selectedNodeId
});
```

这种方式不要求安装 VS Code 插件。

## Core 调用参数

```ts
await getLocalGraphSuggestions({
  diagramPath,
  segmentId,
  selectedNodeId,
  selectedInsertionPointId
});
```

字段说明：

- `diagramPath`：必填，前端生成的图 JSON/TXT 文件路径，例如 `transLd.txt`。
- `segmentId`：推荐传入，用来限定当前区段。多区段文件里必须尽量传，否则会在所有区段里查找节点。
- `selectedNodeId`：当前选中的真实节点 id，例如触点、线圈、功能块、函数节点。
- `selectedInsertionPointId`：当前选中的插入点 id。和 `selectedNodeId` 二选一即可。

常见调用：

```ts
const result = await getLocalGraphSuggestions({
  diagramPath: "C:\\Users\\Administrator\\.vscode\\extensions\\ytak.devuni-ide-vscode-1.0.21\\tool\\iec-runtime-gen-run\\.depworkspace\\transLd.txt",
  segmentId: "segment-2",
  selectedNodeId: "contact-xxx"
});
```

插入点调用：

```ts
const result = await getLocalGraphSuggestions({
  diagramPath,
  segmentId: "segment-2",
  selectedInsertionPointId: "edit-node-rect"
});
```

## 返回结构

返回值主体如下：

```ts
{
  diagramPath: string;
  payload: {
    schemaVersion: "ide-agent.graph-completion.v1";
    action: "suggestGraphCompletions" | "noSuggestion";
    source: "local-rules";
    segmentId: string;
    anchorNodeId: string;
    anchorNodeVar: string;
    confidence: number;
    recognizedFocus: Record<string, unknown>;
    suggestions: LocalSuggestion[];
  };
  summary: {
    sourcePath: string;
    pouName: string;
    pouType: string;
    variableCount: number;
    suggestionOverview: Array<{
      index: number;
      add: string;
      title: string;
      text: string;
    }>;
  };
}
```

前端主要使用：

- `payload.anchorNodeId`：本次建议围绕的选中节点。
- `payload.anchorNodeVar`：选中节点变量或实例名。
- `payload.suggestions`：真正用于渲染和落地的建议数组。
- `summary.suggestionOverview`：适合列表展示的轻量概览。

## Suggestion 结构

每条 suggestion 大致如下：

```ts
{
  id: "local-1",
  startNodes: ["contact-a"],
  endNodes: ["coil-b"],
  position: "behind",
  serialOrParallel: "serial",
  text: "在 a 常开触点(contact-a) 和 b 线圈(coil-b) 之间串联一个常开触点",
  addNode: {
    "contact-local-1": {
      id: "contact-local-1",
      type: "contact",
      varName: {
        name: "",
        value: "???",
        type: "BOOL",
        scope: "VAR"
      }
    }
  }
}
```

字段说明：

- `startNodes`：新增节点左侧连接的节点 id 数组。
- `endNodes`：新增节点右侧连接的节点 id 数组。
- `position`：相对位置，例如 `front`、`behind`、`outsideFront`、`outsideBehind`、`parallel`、`replace`。
- `serialOrParallel`：新增方式，当前主要是 `serial`、`parallel`、`replace`。
- `text`：给人看的完整说明。
- `addNode`：要新增的节点 map，key 是新增节点 id，value 是接近 `transLd.txt` 节点格式的对象，不包含 `sourceIds` / `targetIds`。

功能块端口规则：

- `EN` / `ENO` 的 `value` 为空字符串。
- 其他输入/输出端口默认 `value` 为 `???`，等待前端或用户补变量。

## 安装验证

在任意临时目录执行：

```bash
npm init -y
npm install github:zrwsmd/ide-agent-core
```

然后测试：

```js
const { getLocalGraphSuggestions } = require("@ide-agent/core");

console.log(typeof getLocalGraphSuggestions);
```

应输出：

```text
function
```

如果要真正返回 suggestions：

```js
const { getLocalGraphSuggestions } = require("@ide-agent/core");

(async () => {
  const result = await getLocalGraphSuggestions({
    diagramPath: "C:\\Users\\Administrator\\.vscode\\extensions\\ytak.devuni-ide-vscode-1.0.21\\tool\\iec-runtime-gen-run\\.depworkspace\\transLd.txt",
    segmentId: "segment-2",
    selectedNodeId: "contact-xxx"
  });

  console.log(JSON.stringify(result, null, 2));
})();
```

## 开发和同步流程

当前阶段，主插件仓库里仍保留 `packages/core`，用于插件本地开发和 VSIX 打包。

如果修改本地规则，需要注意同步两个地方：

1. 在 `Ide-agent/packages/core` 修改和自测。
2. 将变更同步到独立仓库 `E:\bbb\ide-agent-core`。
3. 在 `E:\bbb\ide-agent-core` 运行：

```bash
npm install
npm run compile
git status
git add .
git commit -m "..."
git push
```

主插件打包时会执行：

```bash
npm run compile
```

该命令会：

1. 编译 `packages/core`。
2. 编译 VS Code 插件。
3. 将 core 运行时代码复制到 `dist/node_modules/@ide-agent/core`，保证 VSIX 安装后命令仍可正常运行。

## 注意事项

- `@ide-agent/core` 是本地规则建议，不依赖大模型。
- ST 文本补全仍在 VS Code 插件里，由插件请求大模型。
- GitHub 安装方式依赖 GitHub 网络和仓库权限。
- 如果后续发布到 npm，可以把安装命令改成 `npm install @ide-agent/core`。
