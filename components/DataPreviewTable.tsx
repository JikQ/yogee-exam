"use client";

import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Trash2 } from "lucide-react";
import { ORDER_FIELDS, type OrderField, type OrderRow, type ValidationError } from "@/lib/types";
import { errorFieldsByRow } from "@/lib/validation";

type Props = {
  rows: OrderRow[];
  errors: ValidationError[];
  duplicateIds: Set<string>;
  onChange: (rowId: string, field: OrderField, value: string) => void;
  onDelete: (rowId: string) => void;
};

export function DataPreviewTable({ rows, errors, duplicateIds, onChange, onDelete }: Props) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const errorMap = useMemo(() => errorFieldsByRow(errors), [errors]);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 38,
    overscan: 12
  });

  if (!rows.length) {
    return (
      <div className="table-shell">
        <div className="empty">解析结果会显示在这里</div>
      </div>
    );
  }

  return (
    <div className="table-shell">
      <div ref={parentRef} className="virtual-table-wrap">
        <table className="data-table" style={{ height: rowVirtualizer.getTotalSize() + 38 }}>
          <thead>
            <tr>
              <th>行</th>
              {ORDER_FIELDS.map((field) => (
                <th key={field.key} style={{ width: field.width, minWidth: field.width }}>
                  {field.label}
                </th>
              ))}
              <th style={{ width: 64, minWidth: 64 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              const rowErrors = errorMap.get(row.id);
              const isDuplicate = duplicateIds.has(row.id);
              return (
                <tr
                  key={row.id}
                  className={isDuplicate ? "duplicate" : ""}
                  style={{
                    transform: `translateY(${virtualRow.start + 38}px)`,
                    position: "absolute",
                    left: 0,
                    right: 0,
                    display: "table",
                    width: "max-content",
                    minWidth: "100%",
                    tableLayout: "fixed"
                  }}
                >
                  <td>{virtualRow.index + 1}</td>
                  {ORDER_FIELDS.map((field) => (
                    <td
                      key={field.key}
                      className={rowErrors?.has(field.key) || (isDuplicate && (field.key === "externalCode" || field.key === "skuCode")) ? "has-error" : ""}
                      style={{ width: field.width, minWidth: field.width }}
                    >
                      <input
                        className="cell-input"
                        value={row[field.key] ?? ""}
                        title={
                          rowErrors?.has(field.key)
                            ? "该字段存在校验错误"
                            : isDuplicate && (field.key === "externalCode" || field.key === "skuCode")
                              ? "外部编码 + SKU 明细重复"
                              : ""
                        }
                        onChange={(event) => onChange(row.id, field.key, event.target.value)}
                      />
                    </td>
                  ))}
                  <td style={{ width: 64, minWidth: 64 }}>
                    <button className="btn icon ghost" title="删除行" onClick={() => onDelete(row.id)}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
