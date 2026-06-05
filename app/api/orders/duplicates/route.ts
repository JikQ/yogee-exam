import { NextResponse } from "next/server";
import { findExistingOrderLineKeys } from "@/lib/db";
import type { OrderRow } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { rows?: Array<Pick<OrderRow, "externalCode" | "skuCode">> };
    const keys = await findExistingOrderLineKeys(body.rows ?? []);
    return NextResponse.json({ keys });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "重复检测失败" }, { status: 500 });
  }
}
