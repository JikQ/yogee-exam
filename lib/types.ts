export type FileKind = "excel" | "pdf" | "docx" | "text" | "unknown";

export type CellValue = string | number | boolean | null;

export type SheetSnapshot = {
  name: string;
  rows: CellValue[][];
};

export type FileSnapshot = {
  fileName: string;
  fileKind: FileKind;
  byteSize: number;
  sheets: SheetSnapshot[];
  text: string;
  warnings: string[];
};

export type OrderField =
  | "externalCode"
  | "receiverStore"
  | "recipientName"
  | "recipientPhone"
  | "recipientAddress"
  | "skuCode"
  | "skuName"
  | "skuQuantity"
  | "skuSpec"
  | "remark";

export type OrderRow = Record<OrderField, string> & {
  id: string;
  sourceFile?: string;
  sourceSheet?: string;
  sourceRow?: number;
  parseNote?: string;
};

export type FieldSelector =
  | { source: "header"; header: string; fallbackHeaders?: string[] }
  | { source: "index"; index: number }
  | { source: "static"; value: string }
  | { source: "sheetName" }
  | { source: "cell"; row: number; col: number }
  | { source: "regex"; pattern: string; group?: number | string; scope?: "row" | "sheet" | "file" | "block" }
  | { source: "compose"; parts: FieldSelector[]; joinWith?: string };

export type SkipRule = {
  when: "empty" | "contains" | "regex";
  value?: string;
};

export type TailExtractor = {
  field: OrderField;
  pattern: string;
  group?: number | string;
  scope?: "sheet" | "file";
};

export type TableRuleConfig = {
  sheetMode?: "first" | "all";
  headerRow?: number;
  dataStartRow?: number;
  dataEndRow?: number;
  stopOn?: string;
  mappings: Partial<Record<OrderField, FieldSelector>>;
  tailExtractors?: TailExtractor[];
  skipRows?: SkipRule[];
  groupBy?: OrderField;
};

export type MatrixRuleConfig = {
  sheetMode?: "first" | "all";
  headerRow: number;
  dataStartRow: number;
  dynamicColumns: {
    start: number;
    end?: number;
    headerField: "receiverStore" | "remark" | "externalCode";
  };
  fixedMappings: Partial<Record<OrderField, FieldSelector>>;
  cellMode: "quantity" | "compositeLines";
  lineSplitPattern?: string;
  itemPattern?: string;
  skipZeroQuantity?: boolean;
};

export type CardRuleConfig = {
  sheetMode?: "first" | "all";
  blockStartPattern: string;
  fieldExtractors: Partial<Record<OrderField, FieldSelector>>;
  itemPattern?: string;
  tableHeaderPattern?: string;
  tableMappings?: Partial<Record<OrderField, FieldSelector>>;
};

export type TextRuleConfig = {
  blockSplitPattern: string;
  fieldExtractors: Partial<Record<OrderField, FieldSelector>>;
  itemPattern: string;
};

export type ParseRuleConfig =
  | {
      version: 2;
      strategy: "table";
      table: TableRuleConfig;
      matrix?: never;
      card?: never;
      textBlocks?: never;
    }
  | {
      version: 2;
      strategy: "matrix";
      matrix: MatrixRuleConfig;
      table?: never;
      card?: never;
      textBlocks?: never;
    }
  | {
      version: 2;
      strategy: "card";
      card: CardRuleConfig;
      table?: never;
      matrix?: never;
      textBlocks?: never;
    }
  | {
      version: 2;
      strategy: "textBlocks";
      textBlocks: TextRuleConfig;
      table?: never;
      matrix?: never;
      card?: never;
    };

export type RuleRecord = {
  id: string;
  name: string;
  description: string;
  config: ParseRuleConfig;
  aiNotes?: string;
  createdAt: string;
  updatedAt: string;
};

export type AiRuleResponse = {
  name: string;
  description: string;
  config: ParseRuleConfig;
  aiNotes: string;
  inferredMappings: Array<{
    field: OrderField;
    confidence: "high" | "medium" | "low";
    reason: string;
  }>;
};

export type ValidationError = {
  rowId: string;
  rowNumber: number;
  field: OrderField | "row";
  reason: string;
};

export type DuplicateInfo = {
  rowId: string;
  field: "externalCode" | "skuCode";
  reason: string;
};

export const ORDER_FIELDS: Array<{ key: OrderField; label: string; width: number }> = [
  { key: "externalCode", label: "外部编码", width: 170 },
  { key: "receiverStore", label: "收货门店", width: 190 },
  { key: "recipientName", label: "收件人姓名", width: 140 },
  { key: "recipientPhone", label: "收件人电话", width: 150 },
  { key: "recipientAddress", label: "收件人地址", width: 260 },
  { key: "skuCode", label: "SKU物品编码", width: 150 },
  { key: "skuName", label: "SKU物品名称", width: 210 },
  { key: "skuQuantity", label: "SKU发货数量", width: 120 },
  { key: "skuSpec", label: "SKU规格型号", width: 150 },
  { key: "remark", label: "备注", width: 220 }
];

export const EMPTY_ORDER_VALUES: Record<OrderField, string> = {
  externalCode: "",
  receiverStore: "",
  recipientName: "",
  recipientPhone: "",
  recipientAddress: "",
  skuCode: "",
  skuName: "",
  skuQuantity: "",
  skuSpec: "",
  remark: ""
};
