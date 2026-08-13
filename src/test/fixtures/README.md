# 本地建议回归测试数据

本目录保存本地 LD/FBD 建议功能使用的图 JSON 测试数据。每个 fixture 都表示一个或多个示例 POU，由测试脚本选中指定节点，验证系统返回的 suggestion 是否符合业务规则和拓扑约束。

这些文件只用于回归测试，不是运行时业务规则。实际规则位于 `packages/core/src/graph/businessRules.json`。

## Fixture 索引

| 文件 | 对应能力 | 主要正例 | 主要反例和边界 |
| --- | --- | --- | --- |
| `local-business-suggestion-fixture.json` | 通用业务规则综合回归 | TON/计数/锁存/限幅/字符串函数、MC_Stop/MC_Halt、故障联锁、触点极性以及业务 title/text | 普通复位不得误推 MC_Reset；已有功能块不得重复推荐；安全语义不得生成不可靠业务文案；相邻或跨区段信息不得误触发无关规则 |
| `loop-signature-business-suggestion-fixture.json` | 变量角色、回路签名和通用缺块判断 | 根据变量名、注释、类型及 `deviceId/groupId` 识别 PV、SP、MV 等角色；同组条件完整且缺 PID/TON 时推荐对应功能块 | 缺少必要角色、类型错误、角色跨组、已有同组功能块时不推荐；一个回路已有 PID 不得阻止另一回路补 PID |
| `motion-axis-context-fixture.json` | 同轴运动命令组合与触发模型 | 根据真实 `AXIS_REF` 和库端口绑定识别 MC_Power 的持续 Enable、执行类 MC 块的 Execute 周期，以及同轴完成/活动/忙/故障信号；为 MC_Home/MC_Stop 提供业务上下文说明 | 不同轴命令不得混入；Axis 未绑定时不得猜测同轴关系；不同请求的同轴命令仍可提示；同轴同块同 Enable/Execute 请求不得重复推荐 |
| `device-loop-completion-fixture.json` | ALC-02：动作命令缺许可、就绪或故障联锁 | 水泵、风机、阀门、输送段和工位动作缺少同设备许可/就绪时推荐常开触点，缺少故障/阻断条件时推荐常闭触点 | 运行反馈不得作为启动前置；已有条件不得重复推荐；跨设备、跨动作组变量不得混用；可使用明确注释识别非语义变量名 |
| `fault-response-completion-fixture.json` | ALC-03：故障或超时缺报警/锁存输出 | 设备故障、BOOL 超时信号或 TON 超时输出出现后，推荐同设备同动作的报警线圈或故障置位线圈 | 已有输出不得重复推荐；其他设备或其他动作的报警不得混入；普通规则不得补全安全故障逻辑 |
| `fault-reset-completion-fixture.json` | ALC-04：故障锁存缺独立复位路径 | 独立复位条件存在，且同设备同动作已有故障置位线圈时，推荐绑定同一变量的复位线圈 | 已有复位、只有变量但没有真实置位线圈、跨设备、跨动作组和安全场景均不推荐；无显式 ID 时验证稳定名称词干回退 |
| `action-lifecycle-completion-fixture.json` | ALC-05：启停缺自保持或释放逻辑 | 启动触点驱动普通动作输出时推荐并联自保持触点和前串联停止常闭触点；独立停止条件对应置位动作时推荐同变量复位线圈 | 已有自保持或复位不得重复推荐；没有真实动作输出时不得凭按钮猜测完整回路；跨设备、跨动作和安全场景不得补全 |
| `counter-completion-lifecycle-fixture.json` | ALC-06B-1：真实计数器完成后缺批次完成输出 | CTU/CTD/CTUD 的唯一已绑定 BOOL 完成端口存在同组批次完成变量时推荐普通线圈；明确锁存变量时推荐置位线圈；无显式 ID 时验证稳定名称词干回退 | 已有输出不得重复推荐；跨设备/批次、没有真实计数器、完成端口未绑定和安全场景不得补全 |
| `opposite-action-interlock-fixture.json` | ALC-06B-2：同设备相反动作缺互锁 | 开/关使用显式 `deviceId` 归属，正/反使用稳定名称词干回退，缺少互锁时绑定相反命令生成常闭触点 | 已有互锁不得重复推荐；到位反馈不得作为命令互锁；跨设备、同设备非相反动作和安全场景不得补全 |
| `edit-rect-boundaries.json` | 图拓扑和插入边界回归 | 验证 `edit-node-rect`、前/后串联、并联及并联汇合点外侧插入所使用的 `startNodes/endNodes` | `startNodes` 与 `endNodes` 不得相同；并联分支中间节点不得得到外侧后串联；外侧插入不得破坏既有分支和线圈连接 |

## ALC 路线对应关系

| 阶段 | Fixture | 目标 |
| --- | --- | --- |
| ALC-01 | `loop-signature-business-suggestion-fixture.json`、`device-loop-completion-fixture.json` | 命令、反馈和时间参数齐全但缺少 TON 时补充定时器 |
| ALC-02 | `device-loop-completion-fixture.json` | 动作命令缺少许可、就绪或故障联锁时补充条件触点 |
| ALC-03 | `fault-response-completion-fixture.json` | 故障或超时之后缺少报警/锁存输出时补充输出节点 |
| ALC-04 | `fault-reset-completion-fixture.json` | 故障锁存已有置位路径但缺少独立复位路径时补充复位线圈 |
| ALC-05 | `action-lifecycle-completion-fixture.json` | 启停动作缺少自保持、停止释放或置位动作复位时补充对应节点 |
| ALC-06B-1 | `counter-completion-lifecycle-fixture.json` | 真实计数器完成端口已绑定、但同设备/批次完成状态尚未输出时补充普通或置位线圈 |
| ALC-06B-2 | `opposite-action-interlock-fixture.json` | 同设备开/关、伸/缩、正/反或加热/冷却命令缺少互斥条件时补充绑定相反命令的常闭触点 |
| ALC-06B-3 | `motion-axis-context-fixture.json` | 按真实 AXIS_REF 汇总同轴运动命令和状态端口，区分 MC_Power.Enable 保持型与 Execute 上升沿命令，并改善现有 MC 建议说明和精确去重 |

完整阶段定义和实现状态参见 `docs/action-lifecycle-completion-roadmap.md`。

## 维护要求

新增或修改 fixture 时，应同时满足以下要求：

1. 一个 POU 应只表达一个清晰的正例或反例，`pouName`、区段 `label/note` 应说明测试意图。
2. 正例必须验证具体候选类型、绑定变量及必要的 `startNodes/endNodes`，不能只验证“返回了建议”。
3. 业务补全必须包含对应反例，例如已有节点、缺少必要证据、跨设备、跨动作或安全排除。
4. 功能块和函数必须真实存在于 `st-library-info-data.json`，端口名称、方向、类型及 `VAR_IN_OUT` 表达必须与库数据一致。
5. 设备或动作归属优先使用显式 `deviceId/groupId`；测试名称/注释回退能力时，应单独建立没有显式 ID 的用例。
6. Fixture 不得成为运行时依赖，也不得在产品代码中写死测试 POU、区段或节点 ID。
7. 新增 fixture 后，应在本索引中登记，并接入相应测试脚本。

## 验证命令

```powershell
npm run test:business-rules
npm run test:edit-rect-suggestions
```
