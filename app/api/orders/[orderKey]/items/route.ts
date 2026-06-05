import { NextResponse } from "next/server";
import { listOrderItems } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ orderKey: string }> }) {
  try {
    const { orderKey } = await params;
    const url = new URL(request.url);
    const result = await listOrderItems({
      orderKey,
      page: Number(url.searchParams.get("page") ?? "1"),
      pageSize: Number(url.searchParams.get("pageSize") ?? "10")
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取 SKU 明细失败" }, { status: 500 });
  }
}
