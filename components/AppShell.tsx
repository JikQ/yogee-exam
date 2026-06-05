"use client";

import { Activity, Bot, Database, FileCheck2, Gauge, LayoutGrid, Settings, ShieldCheck, Sparkles, UploadCloud } from "lucide-react";

const steps = [
  { label: "采集文件", icon: UploadCloud },
  { label: "生成规则", icon: Bot },
  { label: "试解析", icon: Sparkles },
  { label: "校验下单", icon: FileCheck2 }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="万能导入控制台">
          <div className="brand-mark">
            <LayoutGrid size={20} />
          </div>
          <div className="brand-text">
            <span className="brand-title">万能导入控制台</span>
            <span className="brand-subtitle">AI Rule Engine · Order Import</span>
          </div>
        </div>

        <div className="top-menu" aria-label="流程导航">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div className="top-step" key={step.label}>
                <span>{index + 1}</span>
                <Icon size={14} />
                {step.label}
              </div>
            );
          })}
        </div>

        <div className="top-actions">
          <span className="top-action">
            <Database size={14} />
            Neon 已接入
          </span>
          <span className="top-action">
            <Activity size={14} />
            GPT 规则生成
          </span>
          <button className="utility-button" title="质量阈值" aria-label="质量阈值">
            <Gauge size={16} />
          </button>
          <button className="utility-button" title="系统设置" aria-label="系统设置">
            <Settings size={16} />
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="hero-strip">
          <div>
            <span className="hero-kicker">
              <ShieldCheck size={15} />
              文件版本考试专用工作台
            </span>
            <h1>智能多格式批量下单</h1>
            <p>上传客户文件，先生成可复用解析规则，再用规则引擎稳定解析、校验、提交。</p>
          </div>
          <div className="hero-metrics" aria-label="工作台能力">
            <div>
              <strong>4</strong>
              <span>规则策略</span>
            </div>
            <div>
              <strong>1000+</strong>
              <span>虚拟行渲染</span>
            </div>
            <div>
              <strong>AI</strong>
              <span>辅助映射</span>
            </div>
          </div>
        </section>
        {children}
      </main>
    </div>
  );
}
