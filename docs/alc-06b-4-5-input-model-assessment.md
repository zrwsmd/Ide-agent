# ALC-06B-4 / ALC-06B-5 输入模型评估

版本：1.0  
日期：2026-08-13  
范围：同类设备选择与轮换、共享资源请求仲裁  
性质：输入模型评估，不是已启用的业务补全规则

## 1. 结论

| 任务 | 评估状态 | 功能实现状态 | 结论 |
|---|---|---|---|
| ALC-06B-4 同类设备选择与轮换 | `assessed` | `blocked` | 当前数据能识别单台设备的部分命令、就绪、运行和故障信号，但不能可靠表达设备集合、轮换策略、累计量语义和故障跳过策略。不得只凭 `Pump1/Pump2` 等名称启用轮换规则。 |
| ALC-06B-5 共享资源请求仲裁 | `assessed` | `blocked` | 当前数据能识别局部请求、许可、占位和超时含义，但不能可靠表达共享资源、请求方、所有权、释放条件和仲裁策略。不得只凭 `LineA_Request/LineB_Request` 等名称生成优先级或互斥逻辑。 |

两项评估已经完成，但两项业务能力都没有实现。本阶段不修改 `businessRules.json`、`LocalGraphSuggestionCore.ts` 或运行时 suggestion schema，也不新增活动规则。

## 2. 当前输入基线

当前 `DiagramVariableSummary` 能读取：

```text
name / type / scope
deviceId / groupId
label / note / comment
```

图摘要还能提供：

- POU、区段、节点及静态连接关系。
- 功能块实例和真实端口绑定，包括输入、输出、数据类型和 `VAR_IN_OUT` 表达。
- 已有角色证据，例如 `commandSignal`、`readySignal`、`runFeedback`、`faultSignal`、`completionSignal`、`selectionSignal` 和 `presetDuration`。
- `deviceId/groupId`、稳定名称词干和功能块实例端口形成的关联证据。

这些信息适合回答“当前局部动作缺少哪个许可、反馈或故障联锁”，但不能直接回答“多台设备应选择哪一台”或“多个请求方谁先占用资源”。

### 2.1 现有字段不能被扩大解释

- `deviceId` 表示单台设备归属，不表示该设备属于哪个轮换集合。
- `groupId` 表示变量参与的局部业务/动作分组，不等同于设备集合、共享资源或调度策略。
- `selectionSignal` 只说明变量可能用于选择，不说明选择对象、取值编码或选择算法。
- `readySignal` 和 `faultSignal` 是局部状态证据，不足以证明设备总体可用；检修、手动锁定、通信异常等状态可能仍未表达。
- `presetDuration` 只说明时间参数，不区分轮换周期、最小运行时间、请求超时或释放超时。
- 静态图只能看到状态变量的绑定，不能知道变量当前运行值，也不能证明实时所有权。

## 3. 统一证据等级

| 等级 | 条件 | 允许用途 |
|---|---|---|
| `strong` | 存在显式结构化模型；所引用的设备、请求方和变量都能解析；类型、基数及策略校验通过 | 后续实现可以建立调度上下文，并在限定范围内生成单节点建议。 |
| `supporting` | 只有 `deviceId/groupId`、端口绑定、角色、标签或注释，能说明局部状态，但集合/资源/策略不完整 | 只用于解释和诊断；继续使用现有局部规则，不启用轮换或仲裁建议。 |
| `weak` | 仅靠 `Pump1/Pump2`、`Lead/Lag`、`LineA/LineB`、`Priority` 等变量名猜测 | 不参与轮换或仲裁判断，不生成业务 suggestion。 |
| `invalid` | 引用不存在、类型错误、成员重复、一个请求映射到多个互斥资源，或策略参数不完整 | 忽略该模型并记录诊断；运行行为退回现有规则。 |

名称、标签和注释可以帮助 PLC 工程师发现配置问题，但不能把 `weak` 证据提升为可执行调度事实。

## 4. ALC-06B-4 同类设备选择与轮换

### 4.1 当前已经具备的局部证据

- `deviceId` 可以把命令、运行反馈、就绪和故障变量关联到一台设备。
- `groupId` 可以区分同一设备内的启动、停止、复位等动作组。
- 现有角色可以识别部分可用、运行、故障、选择和时间信号。
- 现有 DL、TON/TOF、故障响应和复位规则仍可补全单台设备的许可、超时、报警和复位。

这些能力可以继续工作，但不代表系统已经支持主备轮换、运行时间均衡或故障补位。

### 4.2 当前缺少的决定性信息

1. 哪些 `deviceId` 属于同一个可选择集合。
2. 集合成员是否同类、是否允许互相替代，以及最少/最多同时投入数量。
3. 每台设备完整的可用状态：就绪、故障、检修、手动锁定、通信有效和被禁用。
4. `Runtime` 是累计运行时间、本次运行时间还是剩余维护时间，以及其单位和复位规则。
5. 当前首选设备和“下一次首选设备”的区别，以及选择变量的编码。
6. 策略是固定主备、每次交替、最少运行时间、最少启动次数还是外部调度器决定。
7. 轮换发生时机、故障跳过、无可用设备、最小运行/停机和手自动切换行为。

### 4.3 建议的结构化输入

不建议继续向单个变量堆叠零散字段。多设备关系更适合放在 POU 或项目级可选元数据中，例如：

```json
{
  "businessMetadata": {
    "equipmentSets": [
      {
        "equipmentSetId": "Water_Pump_Group_01",
        "equipmentType": "pump",
        "memberDeviceIds": ["Pump_01", "Pump_02"],
        "selectionPolicy": "leastRuntime",
        "preferredMemberVariable": "Water_Lead_Pump",
        "rotationTriggerVariable": "Water_Rotation_Request",
        "minimumActiveMembers": 1,
        "maximumActiveMembers": 1,
        "members": [
          {
            "deviceId": "Pump_01",
            "commandVariable": "Pump01_Start_Command",
            "runningVariable": "Pump01_Run_Feedback",
            "readyVariable": "Pump01_Ready",
            "faultVariable": "Pump01_Fault",
            "maintenanceVariable": "Pump01_Maintenance",
            "manualLockVariable": "Pump01_Manual_Lock",
            "runtimeVariable": "Pump01_Runtime_Hours",
            "startCountVariable": "Pump01_Start_Count"
          }
        ],
        "constraints": {
          "minimumRunTimeVariable": "Water_Min_Run_Time",
          "minimumStopTimeVariable": "Water_Min_Stop_Time",
          "skipUnavailableMembers": true
        }
      }
    ]
  }
}
```

字段含义：

- `equipmentSetId`：可轮换设备集合的稳定 ID，不能用 `groupId` 代替。
- `memberDeviceIds`：集合成员；每个成员必须能对应已有 `deviceId`。
- `selectionPolicy`：建议限定枚举，如 `fixedLead`、`alternating`、`leastRuntime`、`leastStarts`、`external`。
- `preferredMemberVariable`：当前或下一首选设备的显式变量；还需要另行定义编码方式。
- `rotationTriggerVariable`：允许轮换发生的明确事件，不把任意定时器当作轮换触发。
- `members`：逐台设备引用真实命令和状态变量。
- `constraints`：投入数量、最小运行/停机和故障跳过约束。

上述字段是评估建议，不是当前已经支持的 JSON schema。

### 4.4 最小可实现输入门槛

未来若只做“渐进式单节点补全”，至少必须同时满足：

1. `equipmentSetId` 唯一且至少有两个有效 `memberDeviceIds`。
2. 每个成员都有唯一 `deviceId`、命令变量和可用/故障证据。
3. `selectionPolicy` 明确；策略所需数据齐全，例如 `leastRuntime` 必须为每个成员提供同单位累计运行量。
4. 选择结果或首选成员具有明确变量和编码。
5. 最小运行/停机等约束若被声明，其变量必须存在且为 `TIME`。
6. 安全相关停机、消防、急停和专用设备保护不进入普通轮换规则。

即使满足以上门槛，第一版也只适合补一个已声明的选择/可用许可节点，不能一次生成完整轮换调度器。

### 4.5 正反例草案

正例草案：

- 两台泵明确属于同一 `equipmentSetId`，策略为 `leastRuntime`，两台泵的累计小时、可用、故障和启动命令均已绑定；选择链缺少已声明首选变量的许可触点。
- 固定主备策略中，主泵故障且配置明确允许跳过不可用成员；备用泵命令链缺少已有选择结果变量的许可触点。

反例草案：

- 只有 `Pump1/Pump2` 名称，没有设备集合 ID。
- 两台泵有运行小时，但单位不同或其中一台缺失。
- 只有 `Lead_Pump` 变量，未说明其表示当前主泵还是下一次首选泵。
- 两台设备 `deviceId` 不同且没有共同 `equipmentSetId`。
- 策略为 `alternating`，但没有轮换触发/状态保存变量。
- 场景包含急停、消防或安全保护，普通规则不得生成轮换逻辑。

### 4.6 降级方式

模型缺失或不完整时：

- 不生成“切换主泵”“投入备用泵”“运行时间最少优先”等建议。
- 继续允许现有规则为单台设备推荐就绪、故障联锁、反馈超时、报警和复位。
- title/text 不声称已识别轮换策略。
- 后续若增加诊断能力，可以提示缺少设备集合或策略元数据，但诊断不能变成业务 suggestion。

## 5. ALC-06B-5 共享资源请求仲裁

### 5.1 当前已经具备的局部证据

- `commandSignal`、`permitSignal`、`presenceSignal`、`inhibitSignal` 和 `presetDuration` 可以表达单条请求链的一部分。
- `deviceId/groupId` 可以关联一个请求方内部的变量。
- 当前拓扑可以判断某条局部路径是否已经使用某个许可或阻断变量。
- 现有 DL、TON 和故障规则仍可补请求许可、堵塞/占位阻断、超时和报警。

这些证据不能证明多个请求方竞争的是同一个资源，也不能决定谁获得授权。

### 5.2 当前缺少的决定性信息

1. 共享资源的稳定 ID，以及哪些请求方竞争该资源。
2. 每个请求方的请求、取消、授权、进入、完成和释放变量。
3. 当前所有权变量的编码、空闲状态和所有权保持方式。
4. 资源是否允许抢占，以及进入关键区后何时禁止切换所有者。
5. 固定优先、交替优先、先到先服务或外部调度等明确策略。
6. 请求超时、授权超时、异常释放和所有者故障后的处理。
7. 策略所需的持久状态，例如交替位、到达顺序或排队序号。

### 5.3 建议的结构化输入

```json
{
  "businessMetadata": {
    "sharedResources": [
      {
        "resourceId": "Merge_Zone_01",
        "resourceType": "conveyorMerge",
        "arbitrationPolicy": "alternating",
        "ownerVariable": "Merge_Zone_Owner",
        "freeVariable": "Merge_Zone_Free",
        "occupiedVariable": "Merge_Zone_Occupied",
        "releaseCompleteVariable": "Merge_Zone_Released",
        "preemptible": false,
        "requesters": [
          {
            "requesterId": "Line_A",
            "deviceId": "Conveyor_Line_A",
            "requestVariable": "LineA_Merge_Request",
            "cancelVariable": "LineA_Merge_Cancel",
            "grantVariable": "LineA_Merge_Grant",
            "enterVariable": "LineA_Entered_Merge",
            "releaseVariable": "LineA_Release_Merge",
            "priority": 10
          },
          {
            "requesterId": "Line_B",
            "deviceId": "Conveyor_Line_B",
            "requestVariable": "LineB_Merge_Request",
            "cancelVariable": "LineB_Merge_Cancel",
            "grantVariable": "LineB_Merge_Grant",
            "enterVariable": "LineB_Entered_Merge",
            "releaseVariable": "LineB_Release_Merge",
            "priority": 10
          }
        ],
        "timeouts": {
          "grantTimeoutVariable": "Merge_Grant_Timeout",
          "releaseTimeoutVariable": "Merge_Release_Timeout"
        }
      }
    ]
  }
}
```

字段含义：

- `resourceId`：共享资源的稳定 ID，不能从区段名或 `groupId` 猜测。
- `requesterId`：资源语境中的请求方 ID；可关联 `deviceId`，但两者职责不同。
- `requestVariable/grantVariable/releaseVariable`：请求、授权和释放必须分别表达，不能把一个 `Permit` 变量同时当请求和授权。
- `ownerVariable`：持久化当前所有者；需要定义空闲值和请求方编码。
- `arbitrationPolicy`：建议限定为 `fixedPriority`、`alternating`、`firstComeFirstServed` 或 `external`。
- `preemptible`：明确资源被占用后是否允许切换所有者。
- `timeouts`：只引用已有时间/超时变量，不由引擎自行设计超时值。

上述字段同样只是评估建议。

### 5.4 最小可实现输入门槛

1. `resourceId` 唯一且至少有两个有效请求方。
2. 每个请求方都有唯一 `requesterId`、请求变量和授权变量。
3. 所有权/空闲/释放状态至少有一种无歧义的显式表达。
4. `arbitrationPolicy` 明确，策略依赖的优先级、交替位或顺序状态齐全。
5. `preemptible` 和不可抢占边界明确。
6. 被引用变量存在且类型正确；请求、授权、释放通常为 `BOOL`，所有者变量使用明确枚举或整数编码。
7. 安全资源、人员防护和需要风险评估的互锁不进入普通仲裁规则。

满足门槛后，第一版也只适合在某个请求方动作链中补一个已声明的 `grantVariable` 许可触点，不能由本地建议自动实现完整仲裁器。

### 5.5 正反例草案

正例草案：

- 两条输送线通过同一 `resourceId` 竞争合流区，策略、所有权、授权和释放变量齐全；Line A 动作链缺少 `LineA_Merge_Grant` 常开许可触点。
- 固定优先级资源中，每个请求方优先级明确，当前链已包含请求但缺少对应已声明授权变量。

反例草案：

- 只有 `LineA_Request/LineB_Request`，没有 `resourceId`。
- 两个请求方实际指向不同资源。
- 有占位信号但没有所有者或释放语义。
- 写了 `Priority`，但未定义固定优先还是交替优先。
- 交替策略没有交替状态变量，先到先服务没有顺序/时间来源。
- 资源已经进入不可抢占阶段，但模型没有 `preemptible` 或进入状态。
- AGV 充电、人员通道等场景包含安全或功率约束，普通规则不得生成仲裁逻辑。

### 5.6 降级方式

模型缺失或不完整时：

- 不生成“Line A 优先”“轮到 Line B”“抢占资源”“异常释放”等建议。
- 继续允许现有规则补局部许可、占位/堵塞阻断、反馈超时和报警。
- 不把 `Occupied` 自动当作完整所有权，也不把 `Request` 自动当作 `Grant`。
- 后续诊断可以说明缺少资源 ID、所有权或策略，但不能替用户设计仲裁算法。

## 6. 后续实现边界

如果未来输入模型由前端或设备模型稳定提供，建议另立实现任务，并按以下顺序推进：

1. 先扩展图摘要 schema 和严格校验，仅解析元数据，不生成建议。
2. 在 `recognizedFocus` 中输出设备集合/共享资源上下文，验证关联和降级是否正确。
3. 只实现绑定已有选择结果或授权变量的单节点建议，并复用现有触点拓扑、极性和去重。
4. 完整轮换状态迁移、运行小时调度、排队、抢占和异常恢复仍交给状态机、设备 FB 或专用调度器。

以下内容不应通过增加关键词规则绕过：

- 从设备编号推断轮换集合。
- 从变量名中的 `Lead/Lag/Priority` 推断策略。
- 从静态 BOOL 绑定推断当前运行值或资源所有者。
- 自动生成跨区段的完整轮换或仲裁程序。
- 自动设计安全相关保护和恢复路径。

## 7. 本阶段验收结果

- 已列出当前字段来源和可复用角色证据。
- 已区分单设备/动作分组、设备集合和共享资源三种不同关系。
- 已给出两类输入模型、字段语义、证据等级和最低门槛。
- 已给出缺失输入时的降级行为和正反例草案。
- 已确认当前输入不足以启用活动规则，两项功能实现均为 `blocked`。
- 本阶段没有修改代码、规则文件或运行时测试夹具。
