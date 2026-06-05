import type { FileSnapshot, ParseRuleConfig } from "@/lib/types";
import { inferRuleFromSnapshot } from "@/lib/rule-inference";

export function createStarterRule(snapshot?: FileSnapshot): ParseRuleConfig {
  if (snapshot) {
    return inferRuleFromSnapshot(snapshot, "已根据当前文件生成初始规则。").config;
  }
  const headerRow = 1;
  return {
    version: 2,
    strategy: "table",
    table: {
      sheetMode: "first",
      headerRow,
      dataStartRow: headerRow + 1,
      mappings: {
        externalCode: { source: "header", header: "请填写外部编码列名" },
        receiverStore: { source: "header", header: "请填写收货门店列名" },
        recipientName: { source: "header", header: "请填写收件人姓名列名" },
        recipientPhone: { source: "header", header: "请填写收件人电话列名" },
        recipientAddress: { source: "header", header: "请填写收件人地址列名" },
        skuCode: { source: "header", header: "请填写SKU编码列名" },
        skuName: { source: "header", header: "请填写SKU名称列名" },
        skuQuantity: { source: "header", header: "请填写数量列名" },
        skuSpec: { source: "header", header: "请填写规格列名" },
        remark: { source: "header", header: "请填写备注列名" }
      },
      skipRows: [{ when: "empty" }]
    }
  };
}

export function detectDenseRow(rows: unknown[][]): number | null {
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

export function safeParseRuleJson(text: string): ParseRuleConfig {
  const parsed = JSON.parse(text) as ParseRuleConfig;
  if (!parsed || parsed.version !== 2 || !parsed.strategy) {
    throw new Error("规则 JSON 缺少 version 或 strategy");
  }
  if (parsed.strategy === "table" && !parsed.table) {
    throw new Error("table 策略缺少 table 配置");
  }
  if (parsed.strategy === "matrix" && !parsed.matrix) {
    throw new Error("matrix 策略缺少 matrix 配置");
  }
  if (parsed.strategy === "card" && !parsed.card) {
    throw new Error("card 策略缺少 card 配置");
  }
  if (parsed.strategy === "textBlocks" && !parsed.textBlocks) {
    throw new Error("textBlocks 策略缺少 textBlocks 配置");
  }
  return parsed;
}

export function stringifyRule(config: ParseRuleConfig): string {
  return JSON.stringify(config, null, 2);
}

export function trimSnapshotForAi(snapshot: FileSnapshot) {
  return {
    fileName: snapshot.fileName,
    fileKind: snapshot.fileKind,
    byteSize: snapshot.byteSize,
    sheets: snapshot.sheets.slice(0, 6).map((sheet) => ({
      name: sheet.name,
      rowCount: sheet.rows.length,
      colCount: Math.max(0, ...sheet.rows.map((row) => row.length)),
      sampleRows: sheet.rows.slice(0, 28)
    })),
    textSample: snapshot.text.slice(0, 12000),
    warnings: snapshot.warnings
  };
}
