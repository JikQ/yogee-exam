import type { AiRuleResponse, FileSnapshot, ParseRuleConfig } from "@/lib/types";
import { trimSnapshotForAi } from "@/lib/rule-utils";
import { inferRuleFromSnapshot } from "@/lib/rule-inference";
import { executeRule } from "@/lib/rule-engine";

const baseURL = process.env.OPENAI_BASE_URL;
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
const AI_TIMEOUT_MS = 3500;
const AI_MAX_ATTEMPTS = 2;

export async function generateRuleWithAi(snapshot: FileSnapshot): Promise<AiRuleResponse> {
  if (!apiKey) {
    return inferRuleFromSnapshot(snapshot, "AI 未调用：缺少 OPENAI_API_KEY，已使用本地结构识别生成规则。");
  }

  try {
    const parsed = await requestAiRule(snapshot);
    assertRule(parsed.config);
    if (!isUsableRule(snapshot, parsed.config)) {
      return inferRuleFromSnapshot(snapshot, "AI 返回了合法规则，但试解析质量不足，已自动切换为本地结构识别规则。");
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return inferRuleFromSnapshot(snapshot, `AI 规则生成未完成：${message}。已自动切换为本地结构识别规则。`);
  }
}

async function requestAiRule(snapshot: FileSnapshot) {
  const endpoint = `${(baseURL || "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= AI_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: buildSystemPrompt()
            },
            {
              role: "user",
              content: JSON.stringify(trimSnapshotForAi(snapshot))
            }
          ]
        }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS)
      });
      if (!response.ok) {
        throw new Error(`模型接口返回 ${response.status}`);
      }
      const completion = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = completion.choices?.[0]?.message?.content ?? "";
      return JSON.parse(text) as AiRuleResponse;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("未知错误");
      if (attempt < AI_MAX_ATTEMPTS) {
        await delay(250 * attempt);
      }
    }
  }
  throw lastError ?? new Error("AI 规则生成失败");
}

function buildSystemPrompt() {
  return [
    "你是物流出库单解析规则设计助手。你只生成可编辑规则，不直接输出解析后的业务数据。",
    "请根据输入文件快照，设计一条通用解析规则 DSL，字段统一映射为 externalCode, receiverStore, recipientName, recipientPhone, recipientAddress, skuCode, skuName, skuQuantity, skuSpec, remark。",
    "必须返回 JSON 对象：{ name, description, config, aiNotes, inferredMappings }。",
    "config 必须符合 version=2 的 DSL，strategy 只能是 table, matrix, card, textBlocks。",
    "table 适合普通表格、跨行聚合、尾部信息提取、多 Sheet；matrix 适合门店或日期横向展开；card 适合纵向卡片；textBlocks 适合 Word/PDF 纯文本多单。",
    "行列编号全部使用 1-based。header/index/cell 映射不要写代码。regex 支持命名捕获组。",
    "AI 不确定的映射必须写进 inferredMappings，confidence 为 low 或 medium，并在 aiNotes 里提示用户确认。",
    "不要根据文件名判断规则，不要输出解释性 Markdown，只输出 JSON。"
  ].join("\n");
}

function assertRule(config: ParseRuleConfig) {
  if (!config || config.version !== 2 || !config.strategy) {
    throw new Error("AI 返回的规则结构不完整");
  }
}

function isUsableRule(snapshot: FileSnapshot, config: ParseRuleConfig) {
  try {
    const rows = executeRule(snapshot, config);
    if (!rows.length) {
      return false;
    }
    const sample = rows.slice(0, Math.min(rows.length, 20));
    const missingRequired = sample.filter((row) => !row.skuCode || !row.skuName || !row.skuQuantity).length;
    const missingReceiver = sample.filter((row) => {
      const hasStore = Boolean(row.receiverStore);
      const hasRecipient = Boolean(row.recipientName && row.recipientPhone && row.recipientAddress);
      return !hasStore && !hasRecipient;
    }).length;
    return missingRequired / sample.length <= 0.25 && missingReceiver / sample.length <= 0.25;
  } catch {
    return false;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
