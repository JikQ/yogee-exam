import { neon } from "@neondatabase/serverless";
import type { OrderRow, ParseRuleConfig, RuleRecord } from "@/lib/types";

const connectionString =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.POSTGRES_PRISMA_URL ??
  "";

const sql = connectionString ? neon(connectionString) : null;

let initialized = false;

export function hasDatabase() {
  return Boolean(sql);
}

export async function ensureDatabase() {
  if (!sql || initialized) {
    return;
  }
  await sql`
    create table if not exists parse_rules (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      description text not null default '',
      config jsonb not null,
      ai_notes text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists import_orders (
      id uuid primary key default gen_random_uuid(),
      external_code text not null default '',
      receiver_store text not null default '',
      recipient_name text not null default '',
      recipient_phone text not null default '',
      recipient_address text not null default '',
      sku_code text not null default '',
      sku_name text not null default '',
      sku_quantity numeric,
      sku_spec text not null default '',
      remark text not null default '',
      source_file text not null default '',
      source_sheet text not null default '',
      source_row integer,
      submitted_at timestamptz not null default now()
    )
  `;
  await sql`create index if not exists import_orders_external_code_idx on import_orders (external_code)`;
  await sql`create index if not exists import_orders_external_sku_idx on import_orders (external_code, sku_code)`;
  await sql`create index if not exists import_orders_recipient_name_idx on import_orders (recipient_name)`;
  await sql`create index if not exists import_orders_submitted_at_idx on import_orders (submitted_at desc)`;
  initialized = true;
}

export async function listRules(): Promise<RuleRecord[]> {
  if (!sql) {
    return [];
  }
  await ensureDatabase();
  const rows = await sql`
    select id, name, description, config, ai_notes, created_at, updated_at
    from parse_rules
    order by updated_at desc
  `;
  return rows.map(ruleFromDb);
}

export async function upsertRule(input: {
  id?: string;
  name: string;
  description: string;
  config: ParseRuleConfig;
  aiNotes?: string;
}): Promise<RuleRecord> {
  if (!sql) {
    throw new Error("数据库环境变量未配置");
  }
  await ensureDatabase();
  if (input.id) {
    const rows = await sql`
      update parse_rules
      set name = ${input.name},
          description = ${input.description},
          config = ${JSON.stringify(input.config)}::jsonb,
          ai_notes = ${input.aiNotes ?? ""},
          updated_at = now()
      where id = ${input.id}
      returning id, name, description, config, ai_notes, created_at, updated_at
    `;
    return ruleFromDb(rows[0]);
  }
  const rows = await sql`
    insert into parse_rules (name, description, config, ai_notes)
    values (${input.name}, ${input.description}, ${JSON.stringify(input.config)}::jsonb, ${input.aiNotes ?? ""})
    returning id, name, description, config, ai_notes, created_at, updated_at
  `;
  return ruleFromDb(rows[0]);
}

export async function deleteRule(id: string) {
  if (!sql) {
    throw new Error("数据库环境变量未配置");
  }
  await ensureDatabase();
  await sql`delete from parse_rules where id = ${id}`;
}

export async function findExistingOrderLineKeys(inputRows: Array<Pick<OrderRow, "externalCode" | "skuCode">>) {
  if (!sql || inputRows.length === 0) {
    return [];
  }
  await ensureDatabase();
  const payload = inputRows
    .map((row) => ({
      external_code: row.externalCode.trim(),
      sku_code: row.skuCode.trim()
    }))
    .filter((row) => row.external_code && row.sku_code);
  if (!payload.length) {
    return [];
  }
  const existingRows = await sql`
    select distinct import_orders.external_code, import_orders.sku_code
    from import_orders
    inner join jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as incoming(
      external_code text,
      sku_code text
    )
      on import_orders.external_code = incoming.external_code
     and import_orders.sku_code = incoming.sku_code
  `;
  return existingRows.map((row) => `${String(row.external_code)}::${String(row.sku_code)}`);
}

export async function insertOrders(rows: OrderRow[]) {
  if (!sql) {
    throw new Error("数据库环境变量未配置");
  }
  await ensureDatabase();
  if (!rows.length) {
    return { success: 0, failed: 0 };
  }

  const payload = rows.map((row) => ({
    external_code: row.externalCode,
    receiver_store: row.receiverStore,
    recipient_name: row.recipientName,
    recipient_phone: row.recipientPhone,
    recipient_address: row.recipientAddress,
    sku_code: row.skuCode,
    sku_name: row.skuName,
    sku_quantity: parseQuantity(row.skuQuantity),
    sku_spec: row.skuSpec,
    remark: row.remark,
    source_file: row.sourceFile ?? "",
    source_sheet: row.sourceSheet ?? "",
    source_row: row.sourceRow ?? null
  }));

  const inserted = await sql`
    insert into import_orders (
      external_code, receiver_store, recipient_name, recipient_phone, recipient_address,
      sku_code, sku_name, sku_quantity, sku_spec, remark, source_file, source_sheet, source_row
    )
    select
      external_code, receiver_store, recipient_name, recipient_phone, recipient_address,
      sku_code, sku_name, sku_quantity, sku_spec, remark, source_file, source_sheet, source_row
    from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as x(
      external_code text,
      receiver_store text,
      recipient_name text,
      recipient_phone text,
      recipient_address text,
      sku_code text,
      sku_name text,
      sku_quantity numeric,
      sku_spec text,
      remark text,
      source_file text,
      source_sheet text,
      source_row integer
    )
    where not exists (
      select 1
      from import_orders existing
      where existing.external_code = x.external_code
        and existing.sku_code = x.sku_code
        and x.external_code <> ''
        and x.sku_code <> ''
    )
    returning id
  `;
  return { success: inserted.length, failed: rows.length - inserted.length };
}

export async function listOrders(params: {
  externalCode?: string;
  recipientName?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}) {
  if (!sql) {
    return { rows: [], total: 0 };
  }
  await ensureDatabase();
  const page = Math.max(params.page ?? 1, 1);
  const pageSize = Math.min(Math.max(params.pageSize ?? 20, 1), 100);
  const offset = (page - 1) * pageSize;
  const externalCode = `%${params.externalCode ?? ""}%`;
  const recipientName = `%${params.recipientName ?? ""}%`;
  const from = params.from || "1900-01-01";
  const to = params.to || "2999-12-31";

  const countRows = await sql`
    with filtered as (
      select
        coalesce(nullif(external_code, ''), id::text) as order_key
      from import_orders
      where external_code ilike ${externalCode}
        and recipient_name ilike ${recipientName}
        and submitted_at >= ${from}::date
        and submitted_at < (${to}::date + interval '1 day')
    )
    select count(*)::int as total
    from (
      select order_key
      from filtered
      group by order_key
    ) grouped
  `;
  const rows = await sql`
    with filtered as (
      select
        *,
        coalesce(nullif(external_code, ''), id::text) as order_key
      from import_orders
      where external_code ilike ${externalCode}
        and recipient_name ilike ${recipientName}
        and submitted_at >= ${from}::date
        and submitted_at < (${to}::date + interval '1 day')
    ),
    grouped as (
      select
        order_key,
        max(external_code) as external_code,
        max(receiver_store) as receiver_store,
        max(recipient_name) as recipient_name,
        max(recipient_phone) as recipient_phone,
        max(recipient_address) as recipient_address,
        count(*)::int as sku_count,
        coalesce(sum(sku_quantity), 0)::text as total_quantity,
        max(submitted_at) as submitted_at
      from filtered
      group by order_key
    )
    select *
    from grouped
    order by submitted_at desc
    limit ${pageSize}
    offset ${offset}
  `;

  return {
    total: Number(countRows[0]?.total ?? 0),
    rows: rows.map((row) => ({
      id: String(row.order_key),
      externalCode: String(row.external_code ?? ""),
      receiverStore: String(row.receiver_store ?? ""),
      recipientName: String(row.recipient_name ?? ""),
      recipientPhone: String(row.recipient_phone ?? ""),
      recipientAddress: String(row.recipient_address ?? ""),
      skuCount: Number(row.sku_count ?? 0),
      totalQuantity: String(row.total_quantity ?? "0"),
      submittedAt: new Date(String(row.submitted_at)).toISOString()
    }))
  };
}

export async function listOrderItems(params: {
  orderKey: string;
  page?: number;
  pageSize?: number;
}) {
  if (!sql) {
    return { rows: [], total: 0 };
  }
  await ensureDatabase();
  const page = Math.max(params.page ?? 1, 1);
  const pageSize = Math.min(Math.max(params.pageSize ?? 10, 1), 100);
  const offset = (page - 1) * pageSize;

  const countRows = await sql`
    select count(*)::int as total
    from import_orders
    where coalesce(nullif(external_code, ''), id::text) = ${params.orderKey}
  `;
  const rows = await sql`
    select
      id,
      sku_code,
      sku_name,
      coalesce(sku_quantity::text, '') as sku_quantity,
      sku_spec,
      remark,
      source_file,
      source_sheet,
      source_row,
      submitted_at
    from import_orders
    where coalesce(nullif(external_code, ''), id::text) = ${params.orderKey}
    order by sku_code, sku_name, source_row nulls last, submitted_at desc
    limit ${pageSize}
    offset ${offset}
  `;

  return {
    total: Number(countRows[0]?.total ?? 0),
    rows: rows.map((row) => ({
      id: String(row.id),
      skuCode: String(row.sku_code ?? ""),
      skuName: String(row.sku_name ?? ""),
      skuQuantity: String(row.sku_quantity ?? ""),
      skuSpec: String(row.sku_spec ?? ""),
      remark: String(row.remark ?? ""),
      sourceFile: String(row.source_file ?? ""),
      sourceSheet: String(row.source_sheet ?? ""),
      sourceRow: row.source_row === null || row.source_row === undefined ? null : Number(row.source_row),
      submittedAt: new Date(String(row.submitted_at)).toISOString()
    }))
  };
}

function ruleFromDb(row: Record<string, unknown>): RuleRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    config: row.config as ParseRuleConfig,
    aiNotes: String(row.ai_notes ?? ""),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  };
}

function parseQuantity(value: string) {
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}
