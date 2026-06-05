import { NextResponse } from "next/server";
import { executeRule } from "@/lib/rule-engine";
import type { FileSnapshot, ParseRuleConfig } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { snapshot?: FileSnapshot; config?: ParseRuleConfig };
    if (!body.snapshot || !body.config) {
      return NextResponse.json({ error: "缺少文件快照或解析规则" }, { status: 400 });
    }
    const rows = executeRule(body.snapshot, body.config);
    return NextResponse.json({ rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "解析执行失败" }, { status: 500 });
  }
}
