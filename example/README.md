# Example: startNodes / endNodes 位置说明

本目录用于说明 LD/FBD 图形 suggest 返回里 `startNodes` 和 `endNodes` 的含义。

示例图见：[example.png](./example.png)

## 基本原则

`startNodes` 和 `endNodes` 不是简单的“选中节点左边一个、右边一个”，而是表示前端真正要修改的拓扑边界：

- `startNodes`：新增图元左侧直接连接的一组节点 id。
- `endNodes`：新增图元右侧直接连接的一组节点 id。
- 如果插入位置只在一条支路内部，`startNodes` / `endNodes` 通常各只有一个节点。
- 如果插入位置在并联结构整体前面或整体后面，就要把相关分支边界节点全部放进数组。
- 数组里只放节点 id，多个节点用数组多项表达。

## 示例图关键节点

下面是 `example.png` 对应图里的部分关键节点：

| 图上名称 | 类型 | id |
| --- | --- | --- |
| a | 常开触点 | `contact-78822130-1781572020158` |
| MC_Reset b | 功能块 | `FBD-compartment-MC_Reset-40551913-1781572029521` |
| AND | 函数 | `FUN-compartment-AND-69734531-1781572074720` |
| l | 上升沿触点 | `contact-62142719-1781572099182` |
| p | 常开触点 | `contact-34471905-1781572119790` |
| q | 常闭触点 | `contact-85677538-1781572050942` |
| XOR | 函数 | `FUN-compartment-XOR-83819973-1781572082160` |
| RTC aa | 功能块 | `FBD-compartment-RTC-13466056-1781572090567` |
| ff | 常开触点 | `contact-42216147-1781572048846` |
| SMC_TV gg | 功能块 | `FBD-compartment-SMC_TV-55383038-1781572040168` |
| hh | 线圈 | `coil-40875514-1781572046607` |

## 位置示例

### 1. 在 a 后面、整个并联结构前面串联触点

这是“插在分叉点前”的情况。新增触点左侧只接 `a`，右侧要接后续并联结构的每条分支入口。

```json
{
  "startNodes": [
    "contact-78822130-1781572020158"
  ],
  "endNodes": [
    "FBD-compartment-MC_Reset-40551913-1781572029521",
    "FUN-compartment-AND-69734531-1781572074720",
    "contact-62142719-1781572099182",
    "contact-34471905-1781572119790"
  ],
  "position": "behind",
  "serialOrParallel": "serial",
  "text": "在a 常开触点(contact-78822130-1781572020158)和后续并联结构之间串联一个常开触点"
}
```

注意：这里不能只写 `endNodes = [MC_Reset]`。只写一个分支入口会变成“只在 a 和 MC_Reset 这一条上支之间插入”，不是插在整个并联结构前面。

### 2. 只在 a 和 MC_Reset b 这一条上支之间串联触点

这是“只改某一条分支内部”的情况。

```json
{
  "startNodes": [
    "contact-78822130-1781572020158"
  ],
  "endNodes": [
    "FBD-compartment-MC_Reset-40551913-1781572029521"
  ],
  "position": "front",
  "serialOrParallel": "serial",
  "text": "在a 常开触点(contact-78822130-1781572020158)和MC_Reset b 功能块(FBD-compartment-MC_Reset-40551913-1781572029521)之间串联一个常开触点"
}
```

### 3. 在 MC_Reset b 和 SMC_TV gg 之间串联触点

这是上支经过 `MC_Reset b` 后，继续到 `SMC_TV gg` 前的位置。

```json
{
  "startNodes": [
    "FBD-compartment-MC_Reset-40551913-1781572029521"
  ],
  "endNodes": [
    "FBD-compartment-SMC_TV-55383038-1781572040168"
  ],
  "position": "behind",
  "serialOrParallel": "serial",
  "text": "在MC_Reset b 功能块(FBD-compartment-MC_Reset-40551913-1781572029521)和SMC_TV gg 功能块(FBD-compartment-SMC_TV-55383038-1781572040168)之间串联一个常开触点"
}
```

### 4. 在 q 前面、下方并联结构整体后面串联触点

这里 `q` 前面有多条分支汇合：`AND`、`XOR`、`p`。如果新增触点要放在整个汇合结构后面、`q` 前面，就要把这些分支末端都作为 `startNodes`。

```json
{
  "startNodes": [
    "FUN-compartment-AND-69734531-1781572074720",
    "FUN-compartment-XOR-83819973-1781572082160",
    "contact-34471905-1781572119790"
  ],
  "endNodes": [
    "contact-85677538-1781572050942"
  ],
  "position": "front",
  "serialOrParallel": "serial",
  "text": "在下方并联结构和q 常闭触点(contact-85677538-1781572050942)之间串联一个常开触点"
}
```

### 5. 在 q 和 RTC aa 之间串联触点

这是已经过了下方并联汇合点之后的一条普通串联位置。

```json
{
  "startNodes": [
    "contact-85677538-1781572050942"
  ],
  "endNodes": [
    "FBD-compartment-RTC-13466056-1781572090567"
  ],
  "position": "behind",
  "serialOrParallel": "serial",
  "text": "在q 常闭触点(contact-85677538-1781572050942)和RTC aa 功能块(FBD-compartment-RTC-13466056-1781572090567)之间串联一个常开触点"
}
```

### 6. 在 SMC_TV gg 前面、两路输入汇合后串联触点

`SMC_TV gg` 前面有两路来源：上支 `MC_Reset b`，下支 `ff`。如果新增触点放在 `SMC_TV gg` 之前，并且是两路汇合后的整体位置，`startNodes` 要包含两个来源。

```json
{
  "startNodes": [
    "FBD-compartment-MC_Reset-40551913-1781572029521",
    "contact-42216147-1781572048846"
  ],
  "endNodes": [
    "FBD-compartment-SMC_TV-55383038-1781572040168"
  ],
  "position": "front",
  "serialOrParallel": "serial",
  "text": "在MC_Reset b 功能块(FBD-compartment-MC_Reset-40551913-1781572029521) / ff 常开触点(contact-42216147-1781572048846) 和SMC_TV gg 功能块(FBD-compartment-SMC_TV-55383038-1781572040168)之间串联一个常开触点"
}
```

### 7. 与某个节点并联触点

如果是和 `a` 并联一个触点，`startNodes` / `endNodes` 应该表达这条并联分支的起点和终点，而不是只表达文案。

```json
{
  "startNodes": [
    "start-node-line"
  ],
  "endNodes": [
    "FBD-compartment-MC_Reset-40551913-1781572029521",
    "FUN-compartment-AND-69734531-1781572074720",
    "contact-62142719-1781572099182",
    "contact-34471905-1781572119790"
  ],
  "position": "parallel",
  "serialOrParallel": "parallel",
  "text": "与a 常开触点(contact-78822130-1781572020158)并联一个常开触点"
}
```

## 前端落图建议

前端接到 suggestion 后，可以按下面方式理解：

1. 找到 `startNodes` 中所有节点的右侧连接边界。
2. 找到 `endNodes` 中所有节点的左侧连接边界。
3. 根据 `serialOrParallel` 判断是串联插入还是并联插入。
4. 根据 suggestion 里动态 key 对应的新节点对象创建图元。
5. 删除或重连原有 `startNodes -> endNodes` 的连接。
6. 新建 `startNodes -> 新节点 -> endNodes` 的连接。

这样即使遇到并联结构，也能区分“只改某条分支”还是“改整个并联结构前/后的整体位置”。
