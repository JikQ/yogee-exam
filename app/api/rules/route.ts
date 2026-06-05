import { NextResponse } from "next/server";
import { hasDatabase, listRules, upsertRule } from "@/lib/db";
import type { ParseRuleConfig } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rules = await listRules();
    return NextResponse.json({ rules, databaseReady: hasDatabase() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取规则失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: string;
      name?: string;
      description?: string;
      config?: ParseRuleConfig;
      aiNotes?: string;
    };
    if (!body.name || !body.config) {
      return NextResponse.json({ error: "规则名称和配置必填" }, { status: 400 });
    }
    const rule = await upsertRule({
      id: body.id,
      name: body.name,
      description: body.description ?? "",
      config: body.config,
      aiNotes: body.aiNotes ?? ""
    });
    return NextResponse.json({ rule });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存规则失败" }, { status: 500 });
  }
}
