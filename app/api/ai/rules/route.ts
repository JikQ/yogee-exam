import { NextResponse } from "next/server";
import { generateRuleWithAi } from "@/lib/ai";
import type { FileSnapshot } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { snapshot?: FileSnapshot };
    if (!body.snapshot) {
      return NextResponse.json({ error: "缺少文件快照" }, { status: 400 });
    }
    const rule = await generateRuleWithAi(body.snapshot);
    return NextResponse.json({ rule });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI 生成规则失败" }, { status: 500 });
  }
}
