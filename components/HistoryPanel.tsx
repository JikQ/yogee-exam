"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Search } from "lucide-react";
import { toast } from "sonner";

type HistoryRow = {
  id: string;
  externalCode: string;
  receiverStore: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  skuCount: number;
  totalQuantity: string;
  submittedAt: string;
};

type HistoryItem = {
  id: string;
  skuCode: string;
  skuName: string;
  skuQuantity: string;
  skuSpec: string;
  remark: string;
  sourceFile?: string;
  sourceSheet?: string;
  sourceRow?: number | null;
  submittedAt?: string;
};

type ItemState = {
  rows: HistoryItem[];
  total: number;
  page: number;
  loading: boolean;
};

const ORDER_PAGE_SIZE = 20;
const ITEM_PAGE_SIZE = 10;

export function HistoryPanel({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ externalCode: "", recipientName: "", from: "", to: "" });
  const [expandedOrderId, setExpandedOrderId] = useState("");
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        externalCode: filters.externalCode,
        recipientName: filters.recipientName,
        from: filters.from,
        to: filters.to,
        page: String(page),
        pageSize: String(ORDER_PAGE_SIZE)
      });
      const response = await fetch(`/api/orders?${params}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "读取失败");
      }
      setRows(payload.rows ?? []);
      setTotal(payload.total ?? 0);
      setExpandedOrderId("");
      setItemStates({});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取历史运单失败");
    } finally {
      setLoading(false);
    }
  }, [filters.externalCode, filters.from, filters.recipientName, filters.to, page]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const loadItems = useCallback(async (orderKey: string, nextPage: number) => {
    setItemStates((current) => ({
      ...current,
      [orderKey]: {
        rows: current[orderKey]?.rows ?? [],
        total: current[orderKey]?.total ?? 0,
        page: nextPage,
        loading: true
      }
    }));
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(ITEM_PAGE_SIZE)
      });
      const response = await fetch(`/api/orders/${encodeURIComponent(orderKey)}/items?${params}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "读取 SKU 明细失败");
      }
      setItemStates((current) => ({
        ...current,
        [orderKey]: {
          rows: payload.rows ?? [],
          total: payload.total ?? 0,
          page: nextPage,
          loading: false
        }
      }));
    } catch (error) {
      setItemStates((current) => ({
        ...current,
        [orderKey]: {
          rows: current[orderKey]?.rows ?? [],
          total: current[orderKey]?.total ?? 0,
          page: nextPage,
          loading: false
        }
      }));
      toast.error(error instanceof Error ? error.message : "读取 SKU 明细失败");
    }
  }, []);

  function toggleDetails(row: HistoryRow) {
    if (expandedOrderId === row.id) {
      setExpandedOrderId("");
      return;
    }
    setExpandedOrderId(row.id);
    if (!itemStates[row.id]) {
      loadItems(row.id, 1);
    }
  }

  const pageCount = Math.max(Math.ceil(total / ORDER_PAGE_SIZE), 1);

  return (
    <div className="history-panel">
      <div className="history-filters">
        <div className="field">
          <label>外部编码</label>
          <input className="input" value={filters.externalCode} onChange={(event) => setFilters({ ...filters, externalCode: event.target.value })} />
        </div>
        <div className="field">
          <label>收件人姓名</label>
          <input className="input" value={filters.recipientName} onChange={(event) => setFilters({ ...filters, recipientName: event.target.value })} />
        </div>
        <div className="field">
          <label>提交开始</label>
          <input className="input" type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
        </div>
        <div className="field">
          <label>提交结束</label>
          <input className="input" type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
        </div>
        <button className="btn primary" onClick={() => setPage(1)} disabled={loading}>
          <Search size={15} />
          查询
        </button>
      </div>

      <div className="history-table-wrap">
        <table className="history-table">
          <thead>
            <tr>
              <th>外部编码</th>
              <th>收货信息</th>
              <th>汇总</th>
              <th>提交时间</th>
              <th>明细</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const itemState = itemStates[row.id];
              const isExpanded = expandedOrderId === row.id;
              const itemPageCount = Math.max(Math.ceil((itemState?.total ?? row.skuCount) / ITEM_PAGE_SIZE), 1);
              return (
                <Fragment key={row.id}>
                  <tr>
                    <td>{row.externalCode || <span className="muted">未填写</span>}</td>
                    <td>
                      <div>{row.receiverStore}</div>
                      <div className="muted">
                        {[row.recipientName, row.recipientPhone, row.recipientAddress].filter(Boolean).join(" / ")}
                      </div>
                    </td>
                    <td>
                      <div>{row.skuCount} 个 SKU</div>
                      <div className="muted">总数 {row.totalQuantity}</div>
                    </td>
                    <td>{formatTime(row.submittedAt)}</td>
                    <td>
                      <button className="btn detail-toggle" onClick={() => toggleDetails(row)} disabled={loading}>
                        {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        {isExpanded ? "收起" : "查看明细"}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="history-detail-row">
                      <td colSpan={5}>
                        <div className="order-items-panel">
                          <div className="detail-head">
                            <div>
                              <strong>SKU 明细列表</strong>
                              <span className="muted">共 {itemState?.total ?? row.skuCount} 条</span>
                            </div>
                            <div className="btn-row">
                              <span className="muted">
                                第 {itemState?.page ?? 1} / {itemPageCount} 页
                              </span>
                              <button
                                className="btn icon"
                                disabled={!itemState || itemState.page <= 1 || itemState.loading}
                                onClick={() => loadItems(row.id, Math.max(1, (itemState?.page ?? 1) - 1))}
                              >
                                <ChevronLeft size={15} />
                              </button>
                              <button
                                className="btn icon"
                                disabled={!itemState || itemState.page >= itemPageCount || itemState.loading}
                                onClick={() => loadItems(row.id, Math.min(itemPageCount, (itemState?.page ?? 1) + 1))}
                              >
                                <ChevronRight size={15} />
                              </button>
                            </div>
                          </div>
                          <div className="item-table-wrap">
                            <table className="item-table">
                              <thead>
                                <tr>
                                  <th>SKU编码</th>
                                  <th>SKU名称</th>
                                  <th>规格</th>
                                  <th>数量</th>
                                  <th>备注</th>
                                  <th>来源</th>
                                </tr>
                              </thead>
                              <tbody>
                                {itemState?.rows.map((item) => (
                                  <tr key={item.id}>
                                    <td>{item.skuCode}</td>
                                    <td>{item.skuName}</td>
                                    <td>{item.skuSpec}</td>
                                    <td>{item.skuQuantity}</td>
                                    <td>{item.remark}</td>
                                    <td className="muted">{formatSource(item)}</td>
                                  </tr>
                                ))}
                                {(!itemState || itemState.loading) && !itemState?.rows.length && (
                                  <tr>
                                    <td colSpan={6}>
                                      <div className="empty small">正在加载 SKU 明细...</div>
                                    </td>
                                  </tr>
                                )}
                                {itemState && !itemState.loading && !itemState.rows.length && (
                                  <tr>
                                    <td colSpan={6}>
                                      <div className="empty small">暂无 SKU 明细</div>
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={5}>
                  <div className="empty">{loading ? "正在加载..." : "暂无历史运单"}</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="btn-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <span className="muted">
          共 {total} 条，第 {page} / {pageCount} 页
        </span>
        <button className="btn icon" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>
          <ChevronLeft size={15} />
        </button>
        <button className="btn icon" disabled={page >= pageCount || loading} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

function formatSource(item: HistoryItem) {
  const sourceRow = item.sourceRow ? `第 ${item.sourceRow} 行` : "";
  return [item.sourceFile, item.sourceSheet, sourceRow].filter(Boolean).join(" / ");
}

function formatTime(value: string) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
