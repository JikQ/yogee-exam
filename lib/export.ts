import * as XLSX from "xlsx";
import { ORDER_FIELDS, type OrderRow } from "@/lib/types";

export function exportRowsToExcel(rows: OrderRow[], fileName = "万能导入预览数据.xlsx") {
  const data = rows.map((row) => {
    const item: Record<string, string> = {};
    ORDER_FIELDS.forEach((field) => {
      item[field.label] = row[field.key] ?? "";
    });
    return item;
  });
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "预览数据");
  XLSX.writeFile(workbook, fileName);
}
