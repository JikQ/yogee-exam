import mammoth from "mammoth";
import pdf from "pdf-parse";
import * as XLSX from "xlsx";
import type { CellValue, FileKind, FileSnapshot, SheetSnapshot } from "@/lib/types";

export async function snapshotFromFile(file: File): Promise<FileSnapshot> {
  const fileName = file.name;
  const fileKind = detectFileKind(fileName, file.type);
  const buffer = Buffer.from(await file.arrayBuffer());
  const warnings: string[] = [];

  if (!buffer.length) {
    throw new Error("文件为空，请重新上传");
  }

  if (fileKind === "excel") {
    return parseExcel(fileName, buffer, file.size, warnings);
  }
  if (fileKind === "pdf") {
    return parsePdf(fileName, buffer, file.size, warnings);
  }
  if (fileKind === "docx") {
    return parseDocx(fileName, buffer, file.size, warnings);
  }

  const text = buffer.toString("utf8");
  if (!text.trim()) {
    throw new Error("暂不支持该文件格式，请上传 Excel、Word 或 PDF 文件");
  }
  return {
    fileName,
    fileKind,
    byteSize: file.size,
    sheets: [{ name: "文本", rows: textToRows(text) }],
    text,
    warnings
  };
}

function parseExcel(fileName: string, buffer: Buffer, byteSize: number, warnings: string[]): FileSnapshot {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheets: SheetSnapshot[] = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
      header: 1,
      defval: null,
      blankrows: false,
      raw: false
    });
    return {
      name: sheetName,
      rows: normalizeRows(rows)
    };
  });

  if (!sheets.length) {
    warnings.push("Excel 文件未读取到 Sheet");
  }

  return {
    fileName,
    fileKind: "excel",
    byteSize,
    sheets,
    text: sheets.map((sheet) => `# ${sheet.name}\n${sheetToText(sheet)}`).join("\n\n"),
    warnings
  };
}

async function parsePdf(fileName: string, buffer: Buffer, byteSize: number, warnings: string[]): Promise<FileSnapshot> {
  const result = await pdf(buffer);
  const text = result.text.trim();
  if (!text) {
    warnings.push("PDF 未提取到文本，可能是扫描件或图片型 PDF");
  }
  return {
    fileName,
    fileKind: "pdf",
    byteSize,
    sheets: [{ name: "PDF文本", rows: textToRows(text) }],
    text,
    warnings
  };
}

async function parseDocx(fileName: string, buffer: Buffer, byteSize: number, warnings: string[]): Promise<FileSnapshot> {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value.trim();
  result.messages.forEach((message) => {
    if (message.message) {
      warnings.push(message.message);
    }
  });
  return {
    fileName,
    fileKind: "docx",
    byteSize,
    sheets: [{ name: "Word文本", rows: textToRows(text) }],
    text,
    warnings
  };
}

function detectFileKind(fileName: string, mimeType: string): FileKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm") || mimeType.includes("spreadsheet")) {
    return "excel";
  }
  if (lower.endsWith(".pdf") || mimeType.includes("pdf")) {
    return "pdf";
  }
  if (lower.endsWith(".docx") || mimeType.includes("wordprocessingml")) {
    return "docx";
  }
  if (lower.endsWith(".txt") || mimeType.startsWith("text/")) {
    return "text";
  }
  return "unknown";
}

function normalizeRows(rows: CellValue[][]) {
  return rows.map((row) => row.map((cell) => normalizeCell(cell)));
}

function normalizeCell(cell: unknown): CellValue {
  if (cell === null || cell === undefined) {
    return null;
  }
  if (typeof cell === "number" || typeof cell === "boolean") {
    return cell;
  }
  const text = String(cell).trim();
  return text || null;
}

function textToRows(text: string): CellValue[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/\t|\s{2,}|,|，|\|/).map((cell) => cell.trim() || null))
    .filter((row) => row.some((cell) => cell !== null));
}

function sheetToText(sheet: SheetSnapshot) {
  return sheet.rows.map((row) => row.map((cell) => String(cell ?? "")).join(" | ")).join("\n");
}
