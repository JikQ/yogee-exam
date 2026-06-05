import { NextResponse } from "next/server";
import { snapshotFromFile } from "@/lib/file-snapshot";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传文件" }, { status: 400 });
    }
    const snapshot = await snapshotFromFile(file);
    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "文件解析失败" }, { status: 500 });
  }
}
