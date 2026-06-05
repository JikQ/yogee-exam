# 万能导入 V2 项目复核报告

## 1. 项目整体状态评估

评分：92 / 100。

核心亮点：
- 项目采用 Next.js App Router + TypeScript，API 路由集中在 `app/api/*`，可直接部署到 Vercel。
- 规则与运单均持久化到 Neon PostgreSQL，未使用 localStorage 保存核心业务数据。
- 规则引擎采用 DSL 驱动，支持 `table`、`matrix`、`card`、`textBlocks` 四类策略，没有按 demo 文件名分支解析。
- AI 只生成可编辑解析规则，不直接生成业务数据；前端允许保存前试解析和人工微调。
- 预览表格使用 `@tanstack/react-virtual` 虚拟滚动，适合 1000+ 行数据编辑。
- 已导入运单按外部编码聚合，支持外层运单分页和内层 SKU 明细分页。

已自动修复的问题：
- `lib/validation.ts`：收件人模式缺字段时改为精准标红姓名、电话、地址，而不是只标整行。
- `lib/ai.ts`：AI 规则生成增加 2 次短重试和退避，失败后仍自动回退本地结构识别规则。
- `components/DataPreviewTable.tsx`：类 Excel 预览表增加 Tab / Shift+Tab / Enter / Shift+Enter 键盘移动焦点能力。

仍需注意：
- 考试 HTML 的 V1 参考项提到重量、件数、温层，但正式 V2 字段定义只有外部编码、收货信息、SKU 编码/名称/数量/规格/备注。本项目未额外扩展重量、件数、温层字段，避免和官方 V2 数据结构不一致。
- 题面描述有 Word 和 9 类演示形态，但当前 `demos` 目录实际只有 6 个可测文件。Word/textBlocks 能力已在规则引擎中保留，但缺少本地 Word demo 可做实测。
- 进度条目前是阶段式进度，不是 EventStream/WebSocket 的逐条实时进度。对当前 demo 和考试核心功能没有阻塞。

## 2. 自动化修复与重构代码包

### components/DataPreviewTable.tsx 修复方案

存在的问题：
- 原预览表格支持单元格内联编辑和虚拟滚动，但键盘操作偏弱，不满足类 Excel 体验里的 Tab/Enter 切换单元格要求。

重构结果：
- 增加 `focusCell` 和 `moveCell`。
- 每个输入框增加 `data-row-index`、`data-field-index`。
- 支持 Tab 横向移动、Shift+Tab 反向移动、Enter 纵向下移、Shift+Enter 纵向上移。
- 目标单元格不在可视区域时先滚动到对应虚拟行再聚焦。

完整代码位置：
- `components/DataPreviewTable.tsx`

### lib/validation.ts 修复方案

存在的问题：
- 收货信息二选一校验原本能拦截空收货信息，但如果用户只填了姓名或只填了电话，错误提示不够精准。

重构结果：
- 门店模式：填写 `receiverStore` 即通过。
- 收件人模式：`recipientName + recipientPhone + recipientAddress` 必须同时填写。
- 收件人模式缺项时分别标红对应字段。
- 四个收货字段全空时只标红收货信息字段组。
- 重复检测仍按 `externalCode + skuCode` 明细级处理，允许同一外部编码下多 SKU。

完整代码位置：
- `lib/validation.ts`

### lib/ai.ts 修复方案

存在的问题：
- AI 调用有超时和降级，但缺少短重试。代理接口偶发超时会更容易退回本地推断。

重构结果：
- 继续使用服务端环境变量 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`。
- 请求地址由 `OPENAI_BASE_URL` 去尾斜杠后拼接 `/chat/completions`。
- 增加 `AI_MAX_ATTEMPTS = 2` 和短退避。
- AI 失败、超时、JSON 不合法、规则试解析质量差时，自动回退 `inferRuleFromSnapshot`。

完整代码位置：
- `lib/ai.ts`

## 3. 测试用例解析规则可行性论证

当前实际可测 demo：

| 文件 | 策略 | 结果 |
| --- | --- | --- |
| 12.25海口龙湖天街-配送发货单PS2512220005001(1).xlsx | table | 2 行，通过 |
| 多门店分Sheet出库单.xlsx | table | 21 行，通过 |
| 欢乐牧场模板0430.xlsx | matrix | 15 行，通过 |
| 湖南仓.xlsx | table | 167 行，通过 |
| 门店调拨单-卡片式.xlsx | card | 9 行，通过 |
| 黔寨寨贵州烙锅（鞍山店）常温.pdf | textBlocks | 41 行，通过 |

9 类格式的规则 JSON 范例：

```json
{
  "黎明屯配送发货单": {
    "version": 2,
    "strategy": "table",
    "table": {
      "sheetMode": "first",
      "headerRow": 4,
      "dataStartRow": 5,
      "stopOn": "^(合计|总计)",
      "groupBy": "externalCode",
      "mappings": {
        "externalCode": { "source": "header", "header": "配送单号" },
        "skuCode": { "source": "header", "header": "SKU编码" },
        "skuName": { "source": "header", "header": "SKU名称" },
        "skuQuantity": { "source": "header", "header": "数量" },
        "skuSpec": { "source": "header", "header": "规格" }
      },
      "tailExtractors": [
        { "field": "recipientName", "pattern": "收货人[:：]\\s*(?<v>[^\\n]+)", "group": "v" },
        { "field": "recipientPhone", "pattern": "电话[:：]\\s*(?<v>1\\d{10}|\\d{6,})", "group": "v" },
        { "field": "recipientAddress", "pattern": "地址[:：]\\s*(?<v>[^\\n]+)", "group": "v" }
      ],
      "skipRows": [{ "when": "empty" }, { "when": "regex", "value": "^(合计|总计|小计)" }]
    }
  },
  "湖南仓发货明细": {
    "version": 2,
    "strategy": "table",
    "table": {
      "sheetMode": "first",
      "headerRow": 2,
      "dataStartRow": 3,
      "groupBy": "externalCode",
      "mappings": {
        "externalCode": { "source": "header", "header": "配送单号" },
        "receiverStore": { "source": "header", "header": "收货门店" },
        "recipientName": { "source": "header", "header": "收货人" },
        "recipientPhone": { "source": "header", "header": "联系电话" },
        "recipientAddress": { "source": "header", "header": "地址" },
        "skuCode": { "source": "header", "header": "商品编码" },
        "skuName": { "source": "header", "header": "商品名称" },
        "skuQuantity": { "source": "header", "header": "数量" },
        "skuSpec": { "source": "header", "header": "规格" }
      },
      "skipRows": [{ "when": "empty" }, { "when": "regex", "value": "^(说明|合计|总计)" }]
    }
  },
  "欢乐牧场SKU门店矩阵": {
    "version": 2,
    "strategy": "matrix",
    "matrix": {
      "sheetMode": "first",
      "headerRow": 2,
      "dataStartRow": 3,
      "dynamicColumns": { "start": 8, "end": 19, "headerField": "receiverStore" },
      "fixedMappings": {
        "skuCode": { "source": "header", "header": "SKU编码" },
        "skuName": { "source": "header", "header": "SKU名称" },
        "skuSpec": { "source": "header", "header": "规格" }
      },
      "cellMode": "quantity",
      "skipZeroQuantity": true
    }
  },
  "黔寨寨配送单PDF": {
    "version": 2,
    "strategy": "textBlocks",
    "textBlocks": {
      "blockSplitPattern": "__NO_SPLIT__",
      "fieldExtractors": {
        "externalCode": { "source": "regex", "scope": "block", "pattern": "单据编号[:：]\\s*(?<v>[A-Z0-9-]+)", "group": "v" },
        "receiverStore": { "source": "regex", "scope": "block", "pattern": "收货机构[:：]\\s*(?<v>.+?)(?:订货机构|\\n)", "group": "v" },
        "recipientName": { "source": "regex", "scope": "block", "pattern": "收货人[:：]\\s*(?<v>.+?)(?:收货电话|\\n)", "group": "v" },
        "recipientPhone": { "source": "regex", "scope": "block", "pattern": "收货电话[:：]\\s*(?<v>1\\d{10}|\\d{6,})", "group": "v" },
        "recipientAddress": { "source": "regex", "scope": "block", "pattern": "收货地址[:：]\\s*(?<v>.+?)(?:备注|打印次数|$)", "group": "v" }
      },
      "itemPattern": "(?:^|\\n)\\s*\\d+\\s*(?<code>[A-Z]{2,}[A-Z0-9-]*\\d{2,})(?<name>[\\s\\S]+?)\\s*(?<quantity>\\d+(?:\\.\\d+)?)\\s*(?=\\n\\s*\\d+|\\n合计|$)"
    }
  },
  "多门店分Sheet出库单": {
    "version": 2,
    "strategy": "table",
    "table": {
      "sheetMode": "all",
      "headerRow": 2,
      "dataStartRow": 3,
      "mappings": {
        "receiverStore": { "source": "sheetName" },
        "skuCode": { "source": "header", "header": "SKU编码" },
        "skuName": { "source": "header", "header": "SKU名称" },
        "skuQuantity": { "source": "header", "header": "数量" },
        "skuSpec": { "source": "header", "header": "规格" }
      },
      "tailExtractors": [
        { "field": "recipientName", "pattern": "收货人[:：]\\s*(?<v>[^\\n|]+)", "group": "v" },
        { "field": "recipientPhone", "pattern": "电话[:：]\\s*(?<v>1\\d{10}|\\d{6,})", "group": "v" },
        { "field": "recipientAddress", "pattern": "地址[:：]\\s*(?<v>[^\\n]+)", "group": "v" }
      ]
    }
  },
  "门店调拨单卡片式": {
    "version": 2,
    "strategy": "card",
    "card": {
      "sheetMode": "all",
      "blockStartPattern": "^\\s*▶?\\s*调拨记录\\s*#\\d+",
      "fieldExtractors": {
        "externalCode": { "source": "regex", "scope": "block", "pattern": "调拨记录\\s*#\\s*(?<v>\\d+)", "group": "v" },
        "receiverStore": { "source": "regex", "scope": "block", "pattern": "调入门店\\s*\\|\\s*(?<v>[^|\\n]+)", "group": "v" }
      },
      "itemPattern": "^\\s*(?<code>[A-Z0-9-]{4,})\\s*\\|\\s*(?<name>[^|\\n]+)\\s*\\|\\s*(?<spec>[^|\\n]*)\\s*\\|\\s*(?<quantity>\\d+(?:\\.\\d+)?)"
    }
  },
  "Word纯文本段落": {
    "version": 2,
    "strategy": "textBlocks",
    "textBlocks": {
      "blockSplitPattern": "^━{3,}|^-{3,}",
      "fieldExtractors": {
        "externalCode": { "source": "regex", "scope": "block", "pattern": "外部编码[:：]\\s*(?<v>[^\\n]+)", "group": "v" },
        "receiverStore": { "source": "regex", "scope": "block", "pattern": "收货门店[:：]\\s*(?<v>[^\\n]+)", "group": "v" }
      },
      "itemPattern": "(?:SKU|物品)[:：]\\s*(?<code>[^,，\\s]+)\\s+名称[:：]\\s*(?<name>[^,，\\n]+).*?数量[:：]\\s*(?<quantity>\\d+(?:\\.\\d+)?)"
    }
  },
  "周配送计划复合矩阵": {
    "version": 2,
    "strategy": "matrix",
    "matrix": {
      "sheetMode": "first",
      "headerRow": 1,
      "dataStartRow": 2,
      "dynamicColumns": { "start": 3, "headerField": "remark" },
      "fixedMappings": { "receiverStore": { "source": "header", "header": "门店" } },
      "cellMode": "compositeLines",
      "lineSplitPattern": "\\n|；|;",
      "itemPattern": "(?<name>[^x×*]+)[x×*](?<quantity>\\d+(?:\\.\\d+)?)"
    }
  },
  "多单PDF签收单": {
    "version": 2,
    "strategy": "textBlocks",
    "textBlocks": {
      "blockSplitPattern": "^(?:第\\s*\\d+\\s*页|签收单|配送签收单)",
      "fieldExtractors": {
        "externalCode": { "source": "regex", "scope": "block", "pattern": "单号[:：]\\s*(?<v>[A-Z0-9-]+)", "group": "v" },
        "recipientName": { "source": "regex", "scope": "block", "pattern": "收货人[:：]\\s*(?<v>[^\\n]+)", "group": "v" },
        "recipientPhone": { "source": "regex", "scope": "block", "pattern": "电话[:：]\\s*(?<v>1\\d{10}|\\d{6,})", "group": "v" },
        "recipientAddress": { "source": "regex", "scope": "block", "pattern": "地址[:：]\\s*(?<v>[^\\n]+)", "group": "v" }
      },
      "itemPattern": "(?:^|\\n)\\s*(?<code>[A-Z0-9-]{4,})\\s+(?<name>[^\\n]+?)\\s+(?<quantity>\\d+(?:\\.\\d+)?)\\s*(?<spec>[^\\n]*)"
    }
  }
}
```

## 4. 性能评估与虚拟化优化

已实现：
- 预览表格使用 `@tanstack/react-virtual`，只渲染可视区域和少量 overscan 行。
- 规则引擎在服务端执行，避免前端大文件解析阻塞 UI。
- 历史运单外层分页，SKU 明细展开后单独分页查询，避免一次拉取大量明细。
- 解析 demo 中最大文件 `湖南仓.xlsx` 解析 167 行，demo 自测通过。

风险：
- `npm run test:demos` 包含 AI 接口调用/降级耗时，不能代表纯规则解析耗时。纯规则执行由 `/api/parse` 完成，应作为性能指标主要口径。
- 若后续单文件超过 1000 行，建议增加独立性能脚本，记录 `/api/files/snapshot` 和 `/api/parse` 的耗时。

## 5. 反思题回答

1. 规则应该描述到什么粒度？

规则应描述到“结构变换和字段选择”粒度，例如表头行、起始行、跳过行、尾部元信息提取、矩阵动态列、卡片边界、文本分块、字段正则。太粗会让规则无法复现细节，最后只能让 AI 直接猜数据；太细会变成另一种硬编码，维护成本高，也会让用户难以编辑。本项目选择 DSL 粒度，是为了让用户能读懂并微调，同时让解析结果可复现。

2. AI 生成解析规则和 AI 直接解析数据，各有什么优劣？

AI 生成规则的优点是可复用、可审计、可手动微调，适合批量导入和长期使用；缺点是首次生成后仍需试解析确认。AI 直接解析数据速度快、适合一次性临时文件，但结果不可复现，容易受提示词和模型波动影响，也不利于定位错误。本项目选择“AI 生成规则 + 规则引擎执行”，因为物流下单需要稳定、可追溯和可重复导入。

3. 纯人工编码完成需要多久？

如果不借助 AI，完成一个可部署的基础版本约 5 到 7 个工作日；若要覆盖所有复杂 Excel、Word、PDF 和高质量 UI，约 10 到 15 个工作日。原因是文件结构差异大，需要逐类分析格式、写解析器、做规则管理、数据库持久化、校验、虚拟表格、历史查询和大量回归测试。AI 能明显缩短规则初稿和结构识别时间，但核心工程质量仍依赖规则引擎和测试。

## 6. 本次验证记录

已执行：
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test:demos`

最新 demo 结果：
- 6 个本地 demo 文件全部 pass。
- PDF demo `黔寨寨贵州烙锅（鞍山店）常温.pdf` pass，解析 41 行，策略 `textBlocks`。

