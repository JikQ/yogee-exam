# 万能导入 V2

智能多格式批量下单系统，技术栈为 Next.js App Router + TypeScript。项目实现了文件上传、AI 辅助生成解析规则、规则引擎试解析、类 Excel 预览编辑、校验、导出、提交入库和历史运单查询。

## 本地运行

```bash
npm install
npm run dev
```

本地访问 `http://127.0.0.1:3000`。

## Vercel 环境变量

在 Vercel Project Settings 中配置以下变量：

```bash
DATABASE_URL=
DATABASE_URL_UNPOOLED=
POSTGRES_URL=
POSTGRES_PRISMA_URL=
OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=
```

`.env.local` 仅用于本地运行，已被 `.gitignore` 排除。部署时不要把密钥硬编码进源码。

## AI 调用说明

AI 调用封装在 `lib/ai.ts`，通过 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL` 从环境变量读取配置。请求地址会由 `OPENAI_BASE_URL` 去掉末尾 `/` 后拼接 `/chat/completions`，用于兼容 OpenAI 协议代理服务。

Prompt 的核心思路是让大模型只生成“可编辑解析规则”，不直接返回业务数据。输入是文件快照，包括文件类型、Sheet 样例行、文本样例和解析警告；输出必须是 JSON，包含规则名称、说明、DSL 配置、AI 备注以及低置信度字段映射说明。

这样做的原因是：

- 规则可以保存、复用、复制、编辑和删除。
- 新文件格式可以先由 AI 生成推荐规则，再由用户人工确认。
- 实际解析由规则引擎执行，便于性能控制和结果复现。

## 规则 DSL

规则统一使用 `version: 2`，支持四类策略：

- `table`：普通表格、跳过头部、尾部信息提取、跨行聚合、多 Sheet 合并。
- `matrix`：门店或日期横向展开，支持数量矩阵和复合单元格拆分。
- `card`：卡片式堆叠结构，通过块起始正则拆分。
- `textBlocks`：Word/PDF 纯文本多订单，通过分隔线或正则拆块。

字段统一映射为：

```text
externalCode, receiverStore, recipientName, recipientPhone,
recipientAddress, skuCode, skuName, skuQuantity, skuSpec, remark
```

## 验证命令

```bash
npm run lint
npm run typecheck
npm run build
```

数据库表会在首次 API 调用时自动创建：`parse_rules` 和 `import_orders`。
