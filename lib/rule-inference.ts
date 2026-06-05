import type { AiRuleResponse, FieldSelector, FileSnapshot, OrderField, ParseRuleConfig, SheetSnapshot } from "@/lib/types";

type LabelHit = {
  row: number;
  col: number;
  valueCol: number;
};

const FIELD_LABELS: Record<OrderField, string[]> = {
  externalCode: ["配送单号", "配送汇总单号", "单据号", "订单号", "调拨单号", "出库单号", "外部编码"],
  receiverStore: ["收货机构", "收货门店", "门店名称", "调入门店", "订货机构"],
  recipientName: ["收件人姓名", "收货人", "联系人", "收件人"],
  recipientPhone: ["收件人电话", "收货电话", "联系电话", "电话", "手机"],
  recipientAddress: ["收件人地址", "收货地址", "地址"],
  skuCode: ["SKU物品编码", "物品编码", "SKU编码", "外部商品编码", "SKU条码", "商品编码"],
  skuName: ["SKU物品名称", "物品名称", "SKU名称", "商品名称", "品名"],
  skuQuantity: ["SKU发货数量", "发货数量", "出库数量", "数量", "应发数量", "订货数量"],
  skuSpec: ["SKU规格型号", "规格型号", "规格"],
  remark: ["备注", "说明"]
};

const REQUIRED_FIELDS: OrderField[] = ["skuCode", "skuName", "skuQuantity"];

export function inferRuleFromSnapshot(snapshot: FileSnapshot, reason = "已根据文件结构生成启发式规则。"): AiRuleResponse {
  const config = inferConfig(snapshot);
  return {
    name: `${snapshot.fileName.replace(/\.[^.]+$/, "") || "文件"} 推荐规则`,
    description: describeConfig(config),
    config,
    aiNotes: `${reason} 请在保存前点击“试解析”核对低置信度映射，尤其是规格、备注和尾部收货信息。`,
    inferredMappings: buildInferenceNotes(config)
  };
}

function inferConfig(snapshot: FileSnapshot): ParseRuleConfig {
  if (snapshot.fileKind === "pdf" || snapshot.fileKind === "docx" || (!snapshot.sheets.length && snapshot.text)) {
    return inferTextRule();
  }

  const sheets = snapshot.sheets;
  const first = sheets[0];
  if (!first) {
    return inferTextRule();
  }

  const wholeText = snapshot.text;
  if (/▶\s*调拨记录|调拨记录\s*#\d+/.test(wholeText)) {
    return inferCardRule();
  }

  const matrix = inferMatrixRule(first);
  if (matrix) {
    return matrix;
  }

  return inferTableRule(sheets);
}

function inferTableRule(sheets: SheetSnapshot[]): ParseRuleConfig {
  const first = sheets[0];
  const headerRow = detectHeaderRow(first) ?? detectDenseRow(first.rows) ?? 1;
  const mappings = buildHeaderMappings(first, headerRow);
  const tailMappings = buildCellMappings(first, headerRow);

  const mergedMappings = {
    ...mappings,
    ...tailMappings,
    ...requiredHeaderFallbacks(mappings)
  };

  return {
    version: 2,
    strategy: "table",
    table: {
      sheetMode: sheets.length > 1 ? "all" : "first",
      headerRow,
      dataStartRow: headerRow + 1,
      stopOn: "^(合计|总计|单据号|制单人|审核人|签字|收货人|联系人|联系电话|收货地址|备注)",
      mappings: mergedMappings,
      skipRows: [
        { when: "empty" },
        { when: "regex", value: "^(合计|总计|小计)" }
      ],
      groupBy: mappings.externalCode ? "externalCode" : undefined
    }
  };
}

function inferMatrixRule(sheet: SheetSnapshot): ParseRuleConfig | null {
  const headerRow = detectHeaderRow(sheet) ?? 1;
  const header = sheet.rows[headerRow - 1] ?? [];
  const skuNameIndex = findHeaderIndex(header, FIELD_LABELS.skuName);
  const skuCodeIndex = findHeaderIndex(header, [...FIELD_LABELS.skuCode, "商品条码"]);
  if (skuNameIndex < 0 || header.length < 12) {
    return null;
  }

  const candidates: number[] = [];
  for (let col = Math.max(skuNameIndex, skuCodeIndex, 0) + 1; col < header.length; col += 1) {
    const label = cellText(header[col]);
    if (!label || /数量|库存|分配|冻结|待移|单位|状态|规格|编码|条码|名称|货主|仓库|单价|金额|折扣|成本|重量|体积|结余|合计|备注/.test(label)) {
      continue;
    }
    const values = sheet.rows.slice(headerRow).map((row) => cellText(row[col])).filter(Boolean);
    const numeric = values.filter((value) => /^-?\d+(\.\d+)?$/.test(value)).length;
    const density = values.length / Math.max(sheet.rows.length - headerRow, 1);
    if (values.length > 0 && numeric / values.length >= 0.85 && density <= 0.65) {
      candidates.push(col);
    }
  }

  if (!candidates.length) {
    return null;
  }

  const start = Math.min(...candidates) + 1;
  const end = Math.max(...candidates) + 1;

  return {
    version: 2,
    strategy: "matrix",
    matrix: {
      sheetMode: "first",
      headerRow,
      dataStartRow: headerRow + 1,
      dynamicColumns: {
        start,
        end,
        headerField: "receiverStore"
      },
      fixedMappings: {
        skuCode: selectorForHeader(header, ["外部商品编码", "SKU条码", ...FIELD_LABELS.skuCode]),
        skuName: selectorForHeader(header, FIELD_LABELS.skuName),
        skuSpec: selectorForHeader(header, FIELD_LABELS.skuSpec),
        remark: selectorForHeader(header, ["货主名称", "仓库名称"])
      },
      cellMode: "quantity",
      skipZeroQuantity: true
    }
  };
}

function inferCardRule(): ParseRuleConfig {
  return {
    version: 2,
    strategy: "card",
    card: {
      sheetMode: "all",
      blockStartPattern: "^\\s*▶?\\s*调拨记录\\s*#\\d+",
      fieldExtractors: {
        externalCode: { source: "regex", scope: "block", pattern: "调拨记录\\s*#\\s*(?<externalCode>\\d+)", group: "externalCode" },
        receiverStore: { source: "regex", scope: "block", pattern: "调入门店\\s*\\|\\s*(?<receiverStore>[^|\\n]+)", group: "receiverStore" },
        recipientName: { source: "regex", scope: "block", pattern: "收货人\\s*\\|\\s*(?<recipientName>[^|\\n]+)", group: "recipientName" },
        recipientPhone: { source: "regex", scope: "block", pattern: "电话\\s*\\|\\s*(?<recipientPhone>1\\d{10}|0\\d[\\d-]+|\\d{6,})", group: "recipientPhone" },
        recipientAddress: { source: "regex", scope: "block", pattern: "收货地址\\s*\\|\\s*(?<recipientAddress>[^|\\n]+)", group: "recipientAddress" }
      },
      itemPattern:
        "^\\s*(?<code>[A-Z0-9-]{4,})\\s*\\|\\s*(?<name>[^|\\n]+)\\s*\\|\\s*(?<spec>[^|\\n]*)\\s*\\|\\s*(?<quantity>\\d+(?:\\.\\d+)?)"
    }
  };
}

function inferTextRule(): ParseRuleConfig {
  return {
    version: 2,
    strategy: "textBlocks",
    textBlocks: {
      blockSplitPattern: "__NO_SPLIT__",
      fieldExtractors: {
        externalCode: { source: "regex", scope: "block", pattern: "单据编号[:：]\\s*(?<externalCode>[A-Z0-9-]+)", group: "externalCode" },
        receiverStore: { source: "regex", scope: "block", pattern: "收货机构[:：]\\s*(?<receiverStore>.+?)(?:订货机构|供货机构|\\n)", group: "receiverStore" },
        recipientName: { source: "regex", scope: "block", pattern: "收货人[:：]\\s*(?<recipientName>.+?)(?:收货电话|\\n|$)", group: "recipientName" },
        recipientPhone: { source: "regex", scope: "block", pattern: "收货电话[:：]\\s*(?<recipientPhone>1\\d{10}|0\\d[\\d-]+|\\d{6,})", group: "recipientPhone" },
        recipientAddress: { source: "regex", scope: "block", pattern: "收货地址[:：]\\s*(?<recipientAddress>.+?)(?:打印次数|备注|物品类别|第\\d+页|$)", group: "recipientAddress" }
      },
      itemPattern:
        "(?:^|\\n)\\s*\\d+\\s*[\\u4e00-\\u9fa5A-Za-z（）()]*?(?<code>[A-Z]{2,}[A-Z0-9-]*\\d{2,})(?<name>[\\s\\S]+?)(?:件|瓶|包|桶|盒|箱|套|顶)\\s*(?<quantity>\\d+(?:\\.\\d+)?)\\s*(?=\\n\\s*\\d+[\\u4e00-\\u9fa5A-Za-z（）()]*?[A-Z]{2,}[A-Z0-9-]*\\d{2,}|\\n合\\s*\\n?计|\\n制单日期|$)"
    }
  };
}

function detectHeaderRow(sheet: SheetSnapshot): number | null {
  let best = { row: 0, score: 0 };
  sheet.rows.slice(0, 20).forEach((row, index) => {
    const text = row.map(cellText).join(" ");
    const score = REQUIRED_FIELDS.reduce((sum, field) => sum + (FIELD_LABELS[field].some((label) => text.includes(label)) ? 3 : 0), 0) + row.filter((cell) => cellText(cell)).length * 0.05;
    if (score > best.score) {
      best = { row: index + 1, score };
    }
  });
  return best.score >= 4 ? best.row : null;
}

function buildHeaderMappings(sheet: SheetSnapshot, headerRow: number) {
  const header = sheet.rows[headerRow - 1] ?? [];
  const mappings: Partial<Record<OrderField, FieldSelector>> = {};
  (Object.keys(FIELD_LABELS) as OrderField[]).forEach((field) => {
    const selector = selectorForHeader(header, FIELD_LABELS[field]);
    if (selector) {
      mappings[field] = selector;
    }
  });
  return mappings;
}

function buildCellMappings(sheet: SheetSnapshot, headerRow: number) {
  const mappings: Partial<Record<OrderField, FieldSelector>> = {};
  const rows = sheet.rows;
  (["externalCode", "receiverStore", "recipientName", "recipientPhone", "recipientAddress"] as OrderField[]).forEach((field) => {
    const hit = findLabelHit(rows, field, FIELD_LABELS[field], headerRow);
    if (hit) {
      mappings[field] = { source: "cell", row: hit.row, col: hit.valueCol };
    }
  });
  return mappings;
}

function requiredHeaderFallbacks(existing: Partial<Record<OrderField, FieldSelector>>) {
  const fallback: Partial<Record<OrderField, FieldSelector>> = {};
  REQUIRED_FIELDS.forEach((field) => {
    if (!existing[field]) {
      fallback[field] = { source: "header", header: FIELD_LABELS[field][0], fallbackHeaders: FIELD_LABELS[field].slice(1) };
    }
  });
  return fallback;
}

function selectorForHeader(header: unknown[], labels: string[]): FieldSelector | undefined {
  const index = findHeaderIndex(header, labels);
  if (index < 0) {
    return undefined;
  }
  return {
    source: "header",
    header: cellText(header[index]),
    fallbackHeaders: labels
  };
}

function findHeaderIndex(header: unknown[], labels: string[]) {
  const normalizedLabels = labels.map(normalize);
  let best = { index: -1, score: 0 };
  header.forEach((cell, index) => {
    const value = normalize(cellText(cell));
    if (!value) {
      return;
    }
    normalizedLabels.forEach((label) => {
      let score = 0;
      if (value === label) {
        score = 100 + label.length;
      } else if (value.includes(label)) {
        score = 70 + label.length;
      } else if (label.includes(value) && value.length >= 2) {
        score = 40 + value.length;
      }
      if (score > best.score) {
        best = { index, score };
      }
    });
  });
  return best.index;
}

function findLabelHit(rows: unknown[][], field: OrderField, labels: string[], headerRow: number): LabelHit | null {
  const normalizedLabels = labels.map(normalize);
  let best: (LabelHit & { score: number }) | null = null;
  for (let r = 0; r < rows.length; r += 1) {
    if (r + 1 === headerRow) {
      continue;
    }
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c += 1) {
      const value = normalize(cellText(row[c]));
      if (!value) {
        continue;
      }
      const labelScore = scoreLabel(value, normalizedLabels);
      if (labelScore > 0) {
        const valueCol = findNextValueColumn(row, c, field);
        if (valueCol >= 0) {
          const candidate = cellText(row[valueCol]);
          const candidateScore = scoreCandidate(field, candidate);
          if (candidateScore > 0) {
            const hit = {
              row: r + 1,
              col: c + 1,
              valueCol: valueCol + 1,
              score: labelScore + candidateScore + r * 0.01
            };
            if (!best || hit.score > best.score) {
              best = hit;
            }
          }
        }
      }
    }
  }
  return best ? { row: best.row, col: best.col, valueCol: best.valueCol } : null;
}

function findNextValueColumn(row: unknown[], labelCol: number, field: OrderField) {
  for (let c = labelCol + 1; c < row.length; c += 1) {
    const value = cellText(row[c]);
    if (value && scoreCandidate(field, value) > 0) {
      return c;
    }
  }
  return -1;
}

function scoreLabel(value: string, labels: string[]) {
  let best = 0;
  labels.forEach((label) => {
    if (value === label) {
      best = Math.max(best, 100 + label.length);
    } else if (value.includes(label) && !/快递|自主|备用|签字|备注|手机号/.test(value)) {
      best = Math.max(best, 45 + label.length);
    }
  });
  return best;
}

function scoreCandidate(field: OrderField, value: string) {
  const text = value.trim();
  const normalized = normalize(text);
  if (!text || /快递|自主|备注|签字|备用|物流公司|车牌|司机|运输状态|收货机构备注/.test(text)) {
    return 0;
  }
  if (field === "recipientPhone") {
    return /^(\+?\d{1,4}[- ]?)?1[3-9]\d{9}$|^0\d{2,3}[- ]?\d{7,8}$|^\d{6,}$/.test(text.replace(/\s+/g, "")) ? 120 : 0;
  }
  if (field === "recipientAddress") {
    const looksLikeAddress = text.length >= 8 && /省|市|区|县|街|道|路|号|镇|乡|村|大道|天街|百货|商场|楼|层/.test(text);
    return looksLikeAddress ? 110 + Math.min(text.length, 40) : 0;
  }
  if (field === "recipientName") {
    if (/\d|电话|手机|地址|机构|门店|公司|仓|配送|备注|联系人备注/.test(text)) {
      return 0;
    }
    return text.length >= 2 && text.length <= 12 ? 100 - text.length : 0;
  }
  if (field === "receiverStore") {
    if (/电话|手机|地址|备注|单号|日期|金额|数量/.test(text)) {
      return 0;
    }
    return text.length >= 2 ? 70 + Math.min(text.length, 30) : 0;
  }
  if (field === "externalCode") {
    return /[A-Z]{1,}\d{4,}|[A-Z0-9-]{6,}/i.test(normalized) ? 90 : 0;
  }
  return 20;
}

function buildInferenceNotes(config: ParseRuleConfig): AiRuleResponse["inferredMappings"] {
  const fields: OrderField[] =
    config.strategy === "table"
      ? (Object.keys(config.table.mappings) as OrderField[])
      : config.strategy === "matrix"
        ? (Object.keys(config.matrix.fixedMappings).concat(config.matrix.dynamicColumns.headerField) as OrderField[])
        : config.strategy === "card"
          ? (Object.keys(config.card.fieldExtractors) as OrderField[])
          : (Object.keys(config.textBlocks.fieldExtractors) as OrderField[]);

  return Array.from(new Set(fields)).map((field) => ({
    field,
    confidence: REQUIRED_FIELDS.includes(field) ? "high" : "medium",
    reason: "根据表头、标签位置或文本模式推断，保存前建议试解析确认。"
  }));
}

function describeConfig(config: ParseRuleConfig) {
  if (config.strategy === "matrix") {
    return "识别为横向门店/日期矩阵，按动态列转置为运单行。";
  }
  if (config.strategy === "card") {
    return "识别为卡片式记录，按记录边界拆分后提取物品明细。";
  }
  if (config.strategy === "textBlocks") {
    return "识别为文本/PDF结构，按正则提取收货信息和物品明细。";
  }
  return "识别为标准或尾部信息表格，按表头映射并跳过合计区。";
}

function cellText(value: unknown) {
  return String(value ?? "").trim();
}

function normalize(value: string) {
  return value.replace(/[\s:*＊#＃：:【】\[\]（）()]/g, "").toLowerCase();
}

function detectDenseRow(rows: unknown[][]): number | null {
  let bestIndex = -1;
  let bestScore = 0;
  rows.slice(0, 12).forEach((row, index) => {
    const filled = row.filter((cell) => String(cell ?? "").trim()).length;
    const score = filled + Math.min(row.length, 20) * 0.02;
    if (score > bestScore && filled >= 2) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex >= 0 ? bestIndex + 1 : null;
}
