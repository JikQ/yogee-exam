import fs from "node:fs";
import path from "node:path";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
const demoDir = path.resolve("demos");
const fields = ["externalCode", "receiverStore", "recipientName", "recipientPhone", "recipientAddress", "skuCode", "skuName", "skuQuantity", "skuSpec", "remark"];

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${url} ${response.status}: ${payload.error || "request failed"}`);
  }
  return payload;
}

async function postFile(filePath) {
  const form = new FormData();
  const bytes = fs.readFileSync(filePath);
  form.append("file", new File([bytes], path.basename(filePath)));
  const response = await fetch(`${baseUrl}/api/files/snapshot`, { method: "POST", body: form });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`snapshot ${response.status}: ${payload.error || "request failed"}`);
  }
  return payload.snapshot;
}

function summarize(rows) {
  const missing = {
    skuCode: rows.filter((row) => !String(row.skuCode || "").trim()).length,
    skuName: rows.filter((row) => !String(row.skuName || "").trim()).length,
    skuQuantity: rows.filter((row) => !String(row.skuQuantity || "").trim()).length,
    receiverOrRecipient: rows.filter((row) => {
      const hasStore = Boolean(String(row.receiverStore || "").trim());
      const hasRecipient = Boolean(String(row.recipientName || "").trim() && String(row.recipientPhone || "").trim() && String(row.recipientAddress || "").trim());
      return !hasStore && !hasRecipient;
    }).length
  };
  return {
    count: rows.length,
    missing,
    first: rows[0] ? Object.fromEntries(fields.map((field) => [field, rows[0][field] || ""])) : null
  };
}

async function main() {
  const files = fs.readdirSync(demoDir).filter((file) => /\.(xlsx|xls|xlsm|pdf|docx)$/i.test(file));
  if (!files.length) {
    throw new Error("demos 目录下没有可测试文件");
  }

  const results = [];
  for (const file of files) {
    const started = Date.now();
    const snapshot = await postFile(path.join(demoDir, file));
    const { rule } = await postJson(`${baseUrl}/api/ai/rules`, { snapshot });
    const { rows } = await postJson(`${baseUrl}/api/parse`, { snapshot, config: rule.config });
    const summary = summarize(rows || []);
    const failed = summary.count === 0 || summary.missing.skuCode > 0 || summary.missing.skuName > 0 || summary.missing.skuQuantity > 0 || summary.missing.receiverOrRecipient > 0;
    results.push({
      file,
      status: failed ? "fail" : "pass",
      ms: Date.now() - started,
      kind: snapshot.fileKind,
      strategy: rule.config.strategy,
      ...summary
    });
  }

  console.table(
    results.map((item) => ({
      file: item.file,
      status: item.status,
      rows: item.count,
      strategy: item.strategy,
      ms: item.ms,
      missingSkuCode: item.missing.skuCode,
      missingSkuName: item.missing.skuName,
      missingQty: item.missing.skuQuantity,
      missingReceiver: item.missing.receiverOrRecipient
    }))
  );

  const failed = results.filter((item) => item.status === "fail");
  if (failed.length) {
    console.log(JSON.stringify(failed, null, 2));
    throw new Error(`${failed.length} 个 demo 未通过解析自测`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
