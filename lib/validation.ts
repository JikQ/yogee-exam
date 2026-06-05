import { type DuplicateInfo, type OrderRow, type ValidationError } from "@/lib/types";

const PHONE_RE = /^(\+?\d{1,4}[- ]?)?1[3-9]\d{9}$|^0\d{2,3}[- ]?\d{7,8}$|^\d{6,}$/;
const RECEIVER_FIELDS: Array<keyof Pick<OrderRow, "receiverStore" | "recipientName" | "recipientPhone" | "recipientAddress">> = [
  "receiverStore",
  "recipientName",
  "recipientPhone",
  "recipientAddress"
];

export function validateRows(rows: OrderRow[], existingOrderLineKeys: Set<string> = new Set()) {
  const errors: ValidationError[] = [];
  const duplicates: DuplicateInfo[] = [];
  const seen = new Map<string, { id: string; rowNumber: number }>();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const hasStoreMode = Boolean(row.receiverStore.trim());
    const recipientValues = {
      recipientName: row.recipientName.trim(),
      recipientPhone: row.recipientPhone.trim(),
      recipientAddress: row.recipientAddress.trim()
    };
    const hasAnyRecipientField = Boolean(recipientValues.recipientName || recipientValues.recipientPhone || recipientValues.recipientAddress);
    const hasRecipientMode = Boolean(recipientValues.recipientName && recipientValues.recipientPhone && recipientValues.recipientAddress);

    if (!hasStoreMode && !hasRecipientMode) {
      if (!hasAnyRecipientField) {
        errors.push({
          rowId: row.id,
          rowNumber,
          field: "row",
          reason: "收货门店，或收件人姓名+电话+地址，至少填写一组"
        });
      } else {
        if (!recipientValues.recipientName) {
          errors.push({ rowId: row.id, rowNumber, field: "recipientName", reason: "收件人模式下姓名必填" });
        }
        if (!recipientValues.recipientPhone) {
          errors.push({ rowId: row.id, rowNumber, field: "recipientPhone", reason: "收件人模式下电话必填" });
        }
        if (!recipientValues.recipientAddress) {
          errors.push({ rowId: row.id, rowNumber, field: "recipientAddress", reason: "收件人模式下地址必填" });
        }
      }
    }

    if (!row.skuCode.trim()) {
      errors.push({ rowId: row.id, rowNumber, field: "skuCode", reason: "SKU物品编码必填" });
    }
    if (!row.skuName.trim()) {
      errors.push({ rowId: row.id, rowNumber, field: "skuName", reason: "SKU物品名称必填" });
    }
    if (!isPositiveNumber(row.skuQuantity)) {
      errors.push({ rowId: row.id, rowNumber, field: "skuQuantity", reason: "SKU发货数量必须为正数" });
    }
    if (row.recipientPhone.trim() && !PHONE_RE.test(row.recipientPhone.replace(/\s+/g, ""))) {
      errors.push({ rowId: row.id, rowNumber, field: "recipientPhone", reason: "电话格式不正确" });
    }

    const orderLineKey = makeOrderLineKey(row);
    if (orderLineKey) {
      const prior = seen.get(orderLineKey);
      if (prior) {
        duplicates.push({
          rowId: row.id,
          field: "skuCode",
          reason: `与本批第 ${prior.rowNumber} 行属于同一外部编码和同一 SKU`
        });
      } else {
        seen.set(orderLineKey, { id: row.id, rowNumber });
      }
      if (existingOrderLineKeys.has(orderLineKey)) {
        duplicates.push({
          rowId: row.id,
          field: "skuCode",
          reason: "与数据库已存在的外部编码 + SKU 明细重复"
        });
      }
    }
  });

  return { errors, duplicates };
}

export function errorFieldsByRow(errors: ValidationError[]) {
  const map = new Map<string, Set<string>>();
  errors.forEach((error) => {
    if (!map.has(error.rowId)) {
      map.set(error.rowId, new Set());
    }
    if (error.field === "row") {
      RECEIVER_FIELDS.forEach((field) => map.get(error.rowId)?.add(field));
    } else {
      map.get(error.rowId)?.add(error.field);
    }
  });
  return map;
}

export function duplicateRows(duplicates: DuplicateInfo[]) {
  return new Set(duplicates.map((duplicate) => duplicate.rowId));
}

function isPositiveNumber(value: string) {
  const normalized = value.replace(/,/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0;
}

export function makeOrderLineKey(row: Pick<OrderRow, "externalCode" | "skuCode">) {
  const externalCode = row.externalCode.trim();
  const skuCode = row.skuCode.trim();
  if (!externalCode || !skuCode) {
    return "";
  }
  return `${externalCode}::${skuCode}`;
}
