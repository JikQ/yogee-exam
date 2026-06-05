"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Copy,
  FileDown,
  FileSpreadsheet,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Upload
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { DataPreviewTable } from "@/components/DataPreviewTable";
import { HistoryPanel } from "@/components/HistoryPanel";
import { EMPTY_ORDER_VALUES, ORDER_FIELDS, type AiRuleResponse, type FileSnapshot, type OrderField, type OrderRow, type RuleRecord } from "@/lib/types";
import { createStarterRule, safeParseRuleJson, stringifyRule } from "@/lib/rule-utils";
import { makeOrderLineKey, validateRows } from "@/lib/validation";
import { exportRowsToExcel } from "@/lib/export";

type WorkspaceTab = "import" | "history";
type RuleEditor = {
  id?: string;
  name: string;
  description: string;
  configText: string;
  aiNotes: string;
};

const initialEditor: RuleEditor = {
  name: "新建解析规则",
  description: "手动配置或由 AI 生成后微调确认",
  configText: stringifyRule(createStarterRule()),
  aiNotes: ""
};

export default function Page() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("import");
  const [rules, setRules] = useState<RuleRecord[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [editor, setEditor] = useState<RuleEditor>(initialEditor);
  const [snapshot, setSnapshot] = useState<FileSnapshot | null>(null);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [existingOrderLineKeys, setExistingOrderLineKeys] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState({ value: 0, text: "等待上传" });
  const [busy, setBusy] = useState("");
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [aiInferred, setAiInferred] = useState<AiRuleResponse["inferredMappings"]>([]);

  const loadRules = useCallback(async () => {
    try {
      const response = await fetch("/api/rules");
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "读取规则失败");
      }
      setRules(payload.rules ?? []);
      if (!payload.databaseReady) {
        toast.warning("数据库环境变量未配置，规则与运单无法持久化");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取规则失败");
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const validation = useMemo(() => validateRows(rows, existingOrderLineKeys), [existingOrderLineKeys, rows]);
  const duplicateIds = useMemo(() => new Set(validation.duplicates.map((duplicate) => duplicate.rowId)), [validation.duplicates]);

  const selectedRule = useMemo(() => rules.find((rule) => rule.id === selectedRuleId), [rules, selectedRuleId]);

  const setEditorFromRule = useCallback((rule: RuleRecord) => {
    setSelectedRuleId(rule.id);
    setEditor({
      id: rule.id,
      name: rule.name,
      description: rule.description,
      configText: stringifyRule(rule.config),
      aiNotes: rule.aiNotes ?? ""
    });
    setAiInferred([]);
  }, []);

  async function handleFile(file: File) {
    const allowed = /\.(xlsx|xls|xlsm|docx|pdf|txt)$/i.test(file.name);
    if (!allowed) {
      toast.error("仅支持 Excel、Word、PDF 或文本文件");
      return;
    }
    setBusy("snapshot");
    setProgress({ value: 12, text: "正在读取文件结构" });
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/files/snapshot", {
        method: "POST",
        body: formData
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "文件解析失败");
      }
      const nextSnapshot = payload.snapshot as FileSnapshot;
      setSnapshot(nextSnapshot);
      setRows([]);
      setExistingOrderLineKeys(new Set());
      setProgress({ value: 38, text: `已读取 ${nextSnapshot.sheets.length || 1} 个结构块，等待选择规则` });
      toast.success("文件已读取，请选择规则或新建规则");
      if (!selectedRuleId && !rules.length) {
        setEditor({
          ...initialEditor,
          configText: stringifyRule(createStarterRule(nextSnapshot))
        });
      }
    } catch (error) {
      setProgress({ value: 0, text: "读取失败" });
      toast.error(error instanceof Error ? error.message : "文件解析失败");
    } finally {
      setBusy("");
    }
  }

  async function generateAiRule() {
    if (!snapshot) {
      toast.warning("请先上传文件");
      return;
    }
    setBusy("ai");
    setProgress({ value: 46, text: "AI 正在分析文件并生成推荐规则" });
    try {
      const response = await fetch("/api/ai/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "AI 生成失败");
      }
      const rule = payload.rule as AiRuleResponse;
      setSelectedRuleId("");
      setEditor({
        name: rule.name,
        description: rule.description,
        configText: stringifyRule(rule.config),
        aiNotes: rule.aiNotes
      });
      setAiInferred(rule.inferredMappings ?? []);
      setProgress({ value: 62, text: "推荐规则已生成，请确认映射后保存或试解析" });
      toast.success("AI 推荐规则已生成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI 生成规则失败");
    } finally {
      setBusy("");
    }
  }

  async function saveRule() {
    setBusy("saveRule");
    try {
      const config = safeParseRuleJson(editor.configText);
      const response = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editor.id,
          name: editor.name.trim(),
          description: editor.description.trim(),
          config,
          aiNotes: editor.aiNotes.trim()
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "保存失败");
      }
      const saved = payload.rule as RuleRecord;
      await loadRules();
      setEditorFromRule(saved);
      toast.success("规则已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存规则失败");
    } finally {
      setBusy("");
    }
  }

  async function deleteSelectedRule() {
    if (!editor.id) {
      toast.info("当前是未保存规则");
      return;
    }
    setBusy("deleteRule");
    try {
      const response = await fetch(`/api/rules/${editor.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "删除失败");
      }
      setSelectedRuleId("");
      setEditor(initialEditor);
      await loadRules();
      toast.success("规则已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除规则失败");
    } finally {
      setBusy("");
    }
  }

  function copyRule() {
    setSelectedRuleId("");
    setEditor({
      ...editor,
      id: undefined,
      name: `${editor.name} 副本`
    });
    toast.success("已复制为未保存规则");
  }

  function createRule() {
    setSelectedRuleId("");
    setEditor({
      ...initialEditor,
      configText: stringifyRule(createStarterRule(snapshot ?? undefined))
    });
    setAiInferred([]);
  }

  async function parseByCurrentRule() {
    if (!snapshot) {
      toast.warning("请先上传文件");
      return;
    }
    setBusy("parse");
    setProgress({ value: 66, text: "正在按当前规则试解析" });
    try {
      const config = safeParseRuleJson(editor.configText);
      const response = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot, config })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "解析失败");
      }
      const parsedRows = (payload.rows ?? []) as OrderRow[];
      setRows(parsedRows);
      setProgress({ value: 82, text: `已解析 ${parsedRows.length} 行，正在检测重复` });
      await refreshExistingOrderLines(parsedRows);
      setProgress({ value: 100, text: `解析完成：${parsedRows.length} 行` });
      toast.success(`解析完成，共 ${parsedRows.length} 行`);
    } catch (error) {
      setProgress({ value: 52, text: "解析失败，可调整规则后重试" });
      toast.error(error instanceof Error ? error.message : "解析失败");
    } finally {
      setBusy("");
    }
  }

  async function refreshExistingOrderLines(parsedRows: OrderRow[]) {
    const lines = parsedRows
      .map((row) => ({ externalCode: row.externalCode.trim(), skuCode: row.skuCode.trim() }))
      .filter((row) => row.externalCode && row.skuCode);
    if (!lines.length) {
      const emptySet = new Set<string>();
      setExistingOrderLineKeys(emptySet);
      return emptySet;
    }
    try {
      const response = await fetch("/api/orders/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: lines })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "重复检测失败");
      }
      const nextKeys = new Set<string>(payload.keys ?? []);
      setExistingOrderLineKeys(nextKeys);
      return nextKeys;
    } catch (error) {
      const emptySet = new Set<string>();
      setExistingOrderLineKeys(emptySet);
      toast.warning(error instanceof Error ? error.message : "数据库重复检测失败");
      return emptySet;
    }
  }

  function updateRow(rowId: string, field: OrderField, value: string) {
    setRows((current) => current.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)));
  }

  function deleteRow(rowId: string) {
    setRows((current) => current.filter((row) => row.id !== rowId));
  }

  function addEmptyRow() {
    setRows((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        ...EMPTY_ORDER_VALUES,
        sourceFile: snapshot?.fileName ?? "手动新增"
      }
    ]);
  }

  async function submitOrders() {
    if (!rows.length) {
      toast.warning("没有可提交的数据");
      return;
    }
    const latestExistingKeys = await refreshExistingOrderLines(rows);
    const latestValidation = validateRows(rows, latestExistingKeys);
    if (latestValidation.errors.length || latestValidation.duplicates.length) {
      toast.error("存在校验错误或重复明细，请修正后提交");
      return;
    }
    setBusy("submit");
    setProgress({ value: 88, text: `正在提交 ${rows.length} 行` });
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "提交失败");
      }
      setProgress({ value: 100, text: `提交完成：成功 ${payload.success} 条，失败 ${payload.failed} 条` });
      setExistingOrderLineKeys((current) => {
        const next = new Set(current);
        rows.forEach((row) => {
          const key = makeOrderLineKey(row);
          if (key) {
            next.add(key);
          }
        });
        return next;
      });
      setHistoryRefreshKey((value) => value + 1);
      toast.success(`提交成功 ${payload.success} 条`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交失败");
    } finally {
      setBusy("");
    }
  }

  const isBusy = Boolean(busy);

  return (
    <AppShell>
      <div className="content">
        <section className="workbench">
          <div className="toolbar">
            <div className="field">
              <label>操作类型</label>
              <select className="select" value="pickup" disabled>
                <option value="pickup">提收</option>
              </select>
            </div>
            <div className="field">
              <label>操作业务员</label>
              <input className="input" placeholder="请输入" />
            </div>
            <div className="field">
              <label>当前文件</label>
              <input className="input" value={snapshot?.fileName ?? ""} placeholder="尚未上传" readOnly />
            </div>
            <div className="btn-row">
              <button className="btn" onClick={() => fileInputRef.current?.click()} disabled={isBusy}>
                <Upload size={15} />
                选择文件
              </button>
              <button className="btn primary" onClick={parseByCurrentRule} disabled={isBusy || !snapshot}>
                {busy === "parse" ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
                试解析
              </button>
            </div>
          </div>

          <div className="tabs">
            <button className={`tab-btn${activeTab === "import" ? " active" : ""}`} onClick={() => setActiveTab("import")}>
              导入数据
            </button>
            <button className={`tab-btn${activeTab === "history" ? " active" : ""}`} onClick={() => setActiveTab("history")}>
              已导入运单
            </button>
          </div>

          {activeTab === "import" ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept=".xlsx,.xls,.xlsm,.docx,.pdf,.txt"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    handleFile(file);
                  }
                  event.currentTarget.value = "";
                }}
              />

              <div className="main-grid">
                <div className="module module-upload">
                  <div className="section-title">
                    <div>
                      <h2>1 选择文件</h2>
                      <p>支持 Excel / Word / PDF，上传后手动选择规则或新建规则</p>
                    </div>
                    <span className="pill">
                      <FileSpreadsheet size={13} />
                      {snapshot ? snapshot.fileKind.toUpperCase() : "等待上传"}
                    </span>
                  </div>

                  <div
                    className={`upload-zone${dragging ? " dragging" : ""}`}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setDragging(true);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      setDragging(false);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragging(false);
                      const file = event.dataTransfer.files?.[0];
                      if (file) {
                        handleFile(file);
                      }
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="upload-inner">
                      <span className="upload-icon">
                        <Plus size={22} />
                      </span>
                      <strong>
                        点击<span style={{ color: "var(--brand)" }}>添加文件</span>或将文件拖拽至此上传
                      </strong>
                      <span>单文件建议小于 10M，上传后由规则引擎解析，不按文件名分支</span>
                    </div>
                  </div>

                  <div className="progress-line">
                    <div className="progress">
                      <span style={{ width: `${progress.value}%` }} />
                    </div>
                    <span>{progress.text}</span>
                  </div>

                  <div className="notice">
                    注意：
                    <br />
                    1. 支持 xlsx、xls、docx、pdf 文件。
                    <br />
                    2. 新格式请先用 AI 生成推荐规则，再手动确认字段映射。
                    <br />
                    3. 规则保存后可复用；上传时必须手动选择规则，不做自动匹配。
                    <br />
                    4. 提交前会一次性列出所有校验错误和外部编码+SKU重复明细。
                  </div>
                </div>

                <div className="module module-rule">
                  <div className="section-title">
                    <div>
                      <h2>2 解析规则</h2>
                      <p>规则持久化保存，支持创建、编辑、复制、删除</p>
                    </div>
                    <div className="btn-row">
                      <button className="btn icon" onClick={createRule} title="新建规则">
                        <Plus size={15} />
                      </button>
                      <button className="btn icon" onClick={copyRule} title="复制规则">
                        <Copy size={15} />
                      </button>
                      <button className="btn icon" onClick={deleteSelectedRule} disabled={busy === "deleteRule"} title="删除规则">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="rule-list">
                    {rules.map((rule) => (
                      <button
                        className={`rule-card${selectedRuleId === rule.id ? " active" : ""}`}
                        key={rule.id}
                        onClick={() => setEditorFromRule(rule)}
                      >
                        <div>
                          <h3>{rule.name}</h3>
                          <p>{rule.description || "暂无说明"}</p>
                        </div>
                        <span className="pill">{rule.config.strategy}</span>
                      </button>
                    ))}
                    {!rules.length && <div className="empty">暂无已保存规则，可上传文件后由 AI 生成</div>}
                  </div>

                  <div className="editor-grid">
                    <div className="field-grid">
                      <div className="field">
                        <label>规则名称</label>
                        <input className="input" value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} />
                      </div>
                      <div className="field">
                        <label>规则说明</label>
                        <input className="input" value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} />
                      </div>
                    </div>
                    <div className="btn-row">
                      <button className="btn primary" onClick={generateAiRule} disabled={isBusy || !snapshot}>
                        {busy === "ai" ? <Loader2 className="spin" size={15} /> : <Bot size={15} />}
                        AI 生成规则
                      </button>
                      <button className="btn" onClick={saveRule} disabled={busy === "saveRule"}>
                        <Save size={15} />
                        保存规则
                      </button>
                      <button className="btn" onClick={() => selectedRule && setEditorFromRule(selectedRule)} disabled={!selectedRule}>
                        <RotateCcw size={15} />
                        还原
                      </button>
                    </div>
                    <textarea
                      className="textarea rule-json"
                      spellCheck={false}
                      value={editor.configText}
                      onChange={(event) => setEditor({ ...editor, configText: event.target.value })}
                    />
                    <textarea
                      className="textarea"
                      placeholder="AI 推测说明 / 人工确认备注"
                      value={editor.aiNotes}
                      onChange={(event) => setEditor({ ...editor, aiNotes: event.target.value })}
                    />
                    {aiInferred.length > 0 && (
                      <div className="error-box" style={{ color: "#855a00", background: "#fff9e8", borderColor: "#ffe2a8" }}>
                        {aiInferred.map((item) => (
                          <div key={`${item.field}-${item.reason}`}>
                            {fieldLabel(item.field)}：{item.confidence}，{item.reason}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="module preview-area">
                <div className="section-title" style={{ paddingLeft: 0, paddingRight: 0 }}>
                  <div>
                    <h2>3 预览与编辑</h2>
                    <p>固定表头、横向滚动、单元格直接编辑，1000+ 行使用虚拟滚动</p>
                  </div>
                  <div className="btn-row">
                    <button className="btn" onClick={addEmptyRow}>
                      <Plus size={15} />
                      新增行
                    </button>
                    <button className="btn" onClick={() => exportRowsToExcel(rows)} disabled={!rows.length}>
                      <FileDown size={15} />
                      导出 Excel
                    </button>
                    <button className="btn primary" onClick={submitOrders} disabled={busy === "submit" || !rows.length}>
                      {busy === "submit" ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}
                      提交下单
                    </button>
                  </div>
                </div>

                <div className="summary-grid">
                  <div className="metric">
                    <span>解析行数</span>
                    <strong>{rows.length}</strong>
                  </div>
                  <div className="metric">
                    <span>校验错误</span>
                    <strong style={{ color: validation.errors.length ? "var(--danger)" : "var(--success)" }}>{validation.errors.length}</strong>
                  </div>
                  <div className="metric">
                    <span>重复提示</span>
                    <strong style={{ color: validation.duplicates.length ? "var(--warning)" : "var(--success)" }}>{validation.duplicates.length}</strong>
                  </div>
                  <div className="metric">
                    <span>已保存规则</span>
                    <strong>{rules.length}</strong>
                  </div>
                </div>

                {(validation.errors.length > 0 || validation.duplicates.length > 0) && (
                  <div className="error-box">
                    {validation.errors.map((error) => (
                      <div key={`${error.rowId}-${error.field}-${error.reason}`}>
                        第 {error.rowNumber} 行 / {fieldLabel(error.field)}：{error.reason}
                      </div>
                    ))}
                    {validation.duplicates.map((duplicate) => {
                      const index = rows.findIndex((row) => row.id === duplicate.rowId);
                      return (
                        <div key={`${duplicate.rowId}-${duplicate.reason}`}>
                          第 {index + 1} 行 / 外部编码 + SKU：{duplicate.reason}
                        </div>
                      );
                    })}
                  </div>
                )}

                <DataPreviewTable
                  rows={rows}
                  errors={validation.errors}
                  duplicateIds={duplicateIds}
                  onChange={updateRow}
                  onDelete={deleteRow}
                />
              </div>
            </>
          ) : (
            <HistoryPanel refreshKey={historyRefreshKey} />
          )}
        </section>
      </div>
    </AppShell>
  );
}

function fieldLabel(field: OrderField | "row") {
  if (field === "row") {
    return "收货信息";
  }
  return ORDER_FIELDS.find((item) => item.key === field)?.label ?? field;
}
