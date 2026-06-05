import { NextResponse } from "next/server";
import { findExistingOrderLineKeys, insertOrders, listOrders } from "@/lib/db";
import { validateRows } from "@/lib/validation";
import type { OrderRow } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const result = await listOrders({
      externalCode: url.searchParams.get("externalCode") ?? "",
      recipientName: url.searchParams.get("recipientName") ?? "",
      from: url.searchParams.get("from") ?? "",
      to: url.searchParams.get("to") ?? "",
      page: Number(url.searchParams.get("page") ?? "1"),
      pageSize: Number(url.searchParams.get("pageSize") ?? "20")
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取运单失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { rows?: OrderRow[] };
    const rows = body.rows ?? [];
    const existingOrderLineKeys = new Set(await findExistingOrderLineKeys(rows));
    const { errors, duplicates } = validateRows(rows, existingOrderLineKeys);
    if (errors.length || duplicates.length) {
      return NextResponse.json({ error: "存在未修正错误或重复明细，禁止提交", errors, duplicates }, { status: 400 });
    }
    const result = await insertOrders(rows);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "提交下单失败" }, { status: 500 });
  }
}
