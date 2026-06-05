import {
  EMPTY_ORDER_VALUES,
  type CellValue,
  type CardRuleConfig,
  type FieldSelector,
  type FileSnapshot,
  type MatrixRuleConfig,
  type OrderField,
  type OrderRow,
  type ParseRuleConfig,
  type SheetSnapshot,
  type SkipRule,
  type TableRuleConfig,
  type TextRuleConfig
} from "@/lib/types";

type RowContext = {
  row: CellValue[];
  rowIndex: number;
  headers: string[];
  sheet: SheetSnapshot;
  sheetText: string;
  fileText: string;
  blockText?: string;
};

export function executeRule(snapshot: FileSnapshot, rule: ParseRuleConfig): OrderRow[] {
  switch (rule.strategy) {
    case "table":
      return executeTable(snapshot, rule.table);
    case "matrix":
      return executeMatrix(snapshot, rule.matrix);
    case "card":
      return executeCard(snapshot, rule.card);
    case "textBlocks":
      return executeTextBlocks(snapshot, rule.textBlocks);
    default:
      return [];
  }
}

function executeTable(snapshot: FileSnapshot, config: TableRuleConfig): OrderRow[] {
  const rows: OrderRow[] = [];
  const sheets = pickSheets(snapshot, config.sheetMode);

  for (const sheet of sheets) {
    const sheetText = sheetToText(sheet);
    const headerRowIndex = Math.max((config.headerRow ?? 1) - 1, 0);
    const dataStartIndex = Math.max((config.dataStartRow ?? headerRowIndex + 2) - 1, 0);
    const dataEndIndex = config.dataEndRow ? Math.min(config.dataEndRow, sheet.rows.length) : sheet.rows.length;
    const headers = (sheet.rows[headerRowIndex] ?? []).map(normalizeHeader);
    const tailValues = extractTailValues(config.tailExtractors ?? [], sheetText, snapshot.text);

    for (let index = dataStartIndex; index < dataEndIndex; index += 1) {
      const raw = sheet.rows[index] ?? [];
      const rowText = raw.map(cellToString).join(" ");
      if (config.stopOn && new RegExp(config.stopOn, "i").test(rowText)) {
        break;
      }
      if (shouldSkipRow(raw, rowText, config.skipRows ?? [{ when: "empty" }])) {
        continue;
      }
      const ctx: RowContext = {
        row: raw,
        rowIndex: index + 1,
        headers,
        sheet,
        sheetText,
        fileText: snapshot.text
      };
      const mapped = buildEmptyRow(snapshot.fileName, sheet.name, index + 1);
      applyMappings(mapped, config.mappings, ctx);
      for (const [field, value] of Object.entries(tailValues) as Array<[OrderField, string]>) {
        if (!mapped[field]) {
          mapped[field] = value;
        }
      }
      if (hasMeaningfulOrderData(mapped)) {
        rows.push(mapped);
      }
    }
  }

  return config.groupBy ? fillGroupFields(rows, config.groupBy) : rows;
}

function executeMatrix(snapshot: FileSnapshot, config: MatrixRuleConfig): OrderRow[] {
  const rows: OrderRow[] = [];
  const sheets = pickSheets(snapshot, config.sheetMode);

  for (const sheet of sheets) {
    const rawHeaders = (sheet.rows[Math.max(config.headerRow - 1, 0)] ?? []).map(cellToString);
    const headers = rawHeaders.map(normalizeHeader);
    const sheetText = sheetToText(sheet);
    const end = config.dynamicColumns.end ?? headers.length;

    for (let rowIndex = Math.max(config.dataStartRow - 1, 0); rowIndex < sheet.rows.length; rowIndex += 1) {
      const raw = sheet.rows[rowIndex] ?? [];
      const baseCtx: RowContext = {
        row: raw,
        rowIndex: rowIndex + 1,
        headers,
        sheet,
        sheetText,
        fileText: snapshot.text
      };
      for (let col = Math.max(config.dynamicColumns.start - 1, 0); col < end; col += 1) {
        const headerValue = cellToString(rawHeaders[col]);
        const cell = cellToString(raw[col]);
        if (!headerValue || !cell) {
          continue;
        }
        if (config.cellMode === "quantity") {
          if (config.skipZeroQuantity && Number(cell) <= 0) {
            continue;
          }
          const mapped = buildEmptyRow(snapshot.fileName, sheet.name, rowIndex + 1);
          applyMappings(mapped, config.fixedMappings, baseCtx);
          mapped[config.dynamicColumns.headerField] = headerValue;
          mapped.skuQuantity = cell;
          if (hasMeaningfulOrderData(mapped)) {
            rows.push(mapped);
          }
          continue;
        }

        splitLines(cell, config.lineSplitPattern).forEach((line) => {
          const item = matchNamed(line, config.itemPattern ?? "");
          const mapped = buildEmptyRow(snapshot.fileName, sheet.name, rowIndex + 1);
          applyMappings(mapped, config.fixedMappings, baseCtx);
          mapped[config.dynamicColumns.headerField] = headerValue;
          mapped.skuName = item.name ?? item.skuName ?? mapped.skuName;
          mapped.skuCode = item.code ?? item.skuCode ?? mapped.skuCode;
          mapped.skuQuantity = item.quantity ?? item.qty ?? mapped.skuQuantity;
          mapped.skuSpec = item.spec ?? mapped.skuSpec;
          mapped.remark = [mapped.remark, item.remark].filter(Boolean).join(" ");
          if (hasMeaningfulOrderData(mapped)) {
            rows.push(mapped);
          }
        });
      }
    }
  }

  return rows;
}

function executeCard(snapshot: FileSnapshot, config: CardRuleConfig): OrderRow[] {
  const rows: OrderRow[] = [];
  const sheets = pickSheets(snapshot, config.sheetMode);

  for (const sheet of sheets) {
    const sheetText = sheetToText(sheet);
    const blocks = splitByPattern(sheetText, config.blockStartPattern);
    for (const [blockIndex, blockText] of blocks.entries()) {
      const blockContext: RowContext = {
        row: [],
        rowIndex: blockIndex + 1,
        headers: [],
        sheet,
        sheetText,
        fileText: snapshot.text,
        blockText
      };
      const base = buildEmptyRow(snapshot.fileName, sheet.name, blockIndex + 1);
      applyMappings(base, config.fieldExtractors, blockContext);

      if (config.itemPattern) {
        const matches = matchAllNamed(blockText, config.itemPattern);
        matches.forEach((match, itemIndex) => {
          const mapped = { ...base, id: cryptoRandomId(), sourceRow: itemIndex + 1 };
          mapped.skuCode = match.code ?? match.skuCode ?? mapped.skuCode;
          mapped.skuName = match.name ?? match.skuName ?? mapped.skuName;
          mapped.skuQuantity = match.quantity ?? match.qty ?? mapped.skuQuantity;
          mapped.skuSpec = match.spec ?? mapped.skuSpec;
          mapped.remark = [mapped.remark, match.remark].filter(Boolean).join(" ");
          if (hasMeaningfulOrderData(mapped)) {
            rows.push(mapped);
          }
        });
        continue;
      }

      if (hasMeaningfulOrderData(base)) {
        rows.push(base);
      }
    }
  }

  return rows;
}

function executeTextBlocks(snapshot: FileSnapshot, config: TextRuleConfig): OrderRow[] {
  const blocks = splitByPattern(snapshot.text, config.blockSplitPattern);
  const rows: OrderRow[] = [];

  for (const [blockIndex, blockText] of blocks.entries()) {
    const ctx: RowContext = {
      row: [],
      rowIndex: blockIndex + 1,
      headers: [],
      sheet: { name: "文本", rows: [] },
      sheetText: blockText,
      fileText: snapshot.text,
      blockText
    };
    const base = buildEmptyRow(snapshot.fileName, "文本", blockIndex + 1);
    applyMappings(base, config.fieldExtractors, ctx);
    const matches = matchAllNamed(blockText, config.itemPattern);
    matches.forEach((match, itemIndex) => {
      const mapped = { ...base, id: cryptoRandomId(), sourceRow: itemIndex + 1 };
      mapped.skuCode = match.code ?? match.skuCode ?? mapped.skuCode;
      mapped.skuName = match.name ?? match.skuName ?? mapped.skuName;
      mapped.skuQuantity = match.quantity ?? match.qty ?? mapped.skuQuantity;
      mapped.skuSpec = match.spec ?? mapped.skuSpec;
      mapped.remark = [mapped.remark, match.remark].filter(Boolean).join(" ");
      if (hasMeaningfulOrderData(mapped)) {
        rows.push(mapped);
      }
    });
  }

  return rows;
}

function applyMappings(row: OrderRow, mappings: Partial<Record<OrderField, FieldSelector>>, ctx: RowContext) {
  for (const [field, selector] of Object.entries(mappings) as Array<[OrderField, FieldSelector]>) {
    if (!selector) {
      continue;
    }
    row[field] = selectValue(selector, ctx);
  }
}

function selectValue(selector: FieldSelector, ctx: RowContext): string {
  switch (selector.source) {
    case "header": {
      const wanted = [selector.header, ...(selector.fallbackHeaders ?? [])].map(normalizeHeader);
      const index = ctx.headers.findIndex((header) => wanted.includes(header));
      return index >= 0 ? cellToString(ctx.row[index]) : "";
    }
    case "index":
      return cellToString(ctx.row[Math.max(selector.index - 1, 0)]);
    case "static":
      return selector.value;
    case "sheetName":
      return ctx.sheet.name;
    case "cell": {
      return cellToString(ctx.sheet.rows[Math.max(selector.row - 1, 0)]?.[Math.max(selector.col - 1, 0)]);
    }
    case "regex": {
      const scope = selector.scope ?? "row";
      const source =
        scope === "file" ? ctx.fileText : scope === "sheet" ? ctx.sheetText : scope === "block" ? ctx.blockText ?? "" : ctx.row.map(cellToString).join(" ");
      return captureByRegex(source, selector.pattern, selector.group);
    }
    case "compose": {
      const parts = selector.parts.map((part) => selectValue(part, ctx)).filter(Boolean);
      return parts.join(selector.joinWith ?? " ");
    }
    default:
      return "";
  }
}

function extractTailValues(extractors: Array<{ field: OrderField; pattern: string; group?: number | string; scope?: "sheet" | "file" }>, sheetText: string, fileText: string) {
  const values: Partial<Record<OrderField, string>> = {};
  extractors.forEach((extractor) => {
    const source = extractor.scope === "file" ? fileText : sheetText;
    const value = captureByRegex(source, extractor.pattern, extractor.group);
    if (value) {
      values[extractor.field] = value;
    }
  });
  return values;
}

function shouldSkipRow(row: CellValue[], rowText: string, rules: SkipRule[]) {
  return rules.some((rule) => {
    if (rule.when === "empty") {
      return row.every((cell) => !cellToString(cell));
    }
    if (rule.when === "contains") {
      return Boolean(rule.value && rowText.includes(rule.value));
    }
    if (rule.when === "regex") {
      return Boolean(rule.value && new RegExp(rule.value, "i").test(rowText));
    }
    return false;
  });
}

function fillGroupFields(rows: OrderRow[], groupBy: OrderField) {
  const sharedFields: OrderField[] = ["receiverStore", "recipientName", "recipientPhone", "recipientAddress", "remark"];
  const groups = new Map<string, OrderRow[]>();
  rows.forEach((row) => {
    const key = row[groupBy] || row.externalCode || row.receiverStore || row.recipientPhone || row.id;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)?.push(row);
  });
  groups.forEach((group) => {
    sharedFields.forEach((field) => {
      const value = group.find((row) => row[field])?.[field] ?? "";
      if (value) {
        group.forEach((row) => {
          if (!row[field]) {
            row[field] = value;
          }
        });
      }
    });
  });
  return rows;
}

function pickSheets(snapshot: FileSnapshot, mode: "first" | "all" = "first") {
  if (!snapshot.sheets.length) {
    return [{ name: snapshot.fileKind === "pdf" ? "PDF" : "文本", rows: textToRows(snapshot.text) }];
  }
  return mode === "all" ? snapshot.sheets : snapshot.sheets.slice(0, 1);
}

function textToRows(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/\s{2,}|\t|,|，/).map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
}

function sheetToText(sheet: SheetSnapshot) {
  return sheet.rows.map((row) => row.map(cellToString).filter(Boolean).join(" | ")).join("\n");
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return String(value).trim();
}

function normalizeHeader(value: unknown): string {
  return cellToString(value).replace(/\s+/g, "").replace(/[：:]/g, "").toLowerCase();
}

function buildEmptyRow(sourceFile: string, sourceSheet: string, sourceRow: number): OrderRow {
  return {
    id: cryptoRandomId(),
    ...EMPTY_ORDER_VALUES,
    sourceFile,
    sourceSheet,
    sourceRow
  };
}

function hasMeaningfulOrderData(row: OrderRow) {
  return Boolean(row.skuCode || row.skuName || row.skuQuantity || row.receiverStore || row.recipientName || row.externalCode);
}

function captureByRegex(source: string, pattern: string, group?: number | string) {
  if (!pattern) {
    return "";
  }
  const regex = new RegExp(pattern, "ims");
  const match = source.match(regex);
  if (!match) {
    return "";
  }
  if (typeof group === "string") {
    return match.groups?.[group]?.trim() ?? "";
  }
  return (match[group ?? 1] ?? "").trim();
}

function splitByPattern(source: string, pattern: string) {
  if (!pattern) {
    return [source].filter((block) => block.trim());
  }
  if (pattern === "__NO_SPLIT__") {
    return [source].filter((block) => block.trim());
  }
  const regex = new RegExp(pattern, "im");
  const lines = source.split(/\r?\n/);
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (regex.test(line) && current.length) {
      blocks.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) {
    blocks.push(current.join("\n"));
  }
  return blocks.filter((block) => block.trim());
}

function splitLines(value: string, pattern?: string) {
  return value
    .split(pattern ? new RegExp(pattern) : /\r?\n|;|；/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function matchNamed(value: string, pattern: string) {
  if (!pattern) {
    return {} as Record<string, string>;
  }
  const regex = new RegExp(pattern, "ims");
  const match = value.match(regex);
  return normalizeGroups(match?.groups ?? {});
}

function matchAllNamed(value: string, pattern: string) {
  if (!pattern) {
    return [];
  }
  const regex = new RegExp(pattern, "gims");
  const matches: Array<Record<string, string>> = [];
  for (const match of value.matchAll(regex)) {
    matches.push(normalizeGroups(match.groups ?? {}));
  }
  return matches;
}

function normalizeGroups(groups: Record<string, string | undefined>) {
  const normalized: Record<string, string> = {};
  Object.entries(groups).forEach(([key, value]) => {
    normalized[key] = String(value ?? "")
      .replace(/\s+/g, " ")
      .replace(/\s*\/\s*/g, "/")
      .trim();
  });
  return normalized;
}

function cryptoRandomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
