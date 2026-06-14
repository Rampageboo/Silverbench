import { WORKBENCH_TOOLS, type ToolTab } from "../types/tools";

type PlaceholderPageProps = {
  tab: ToolTab;
};

export function PlaceholderPage({ tab }: PlaceholderPageProps) {
  const tool = WORKBENCH_TOOLS.find((item) => item.tab === tab);
  if (!tool) return null;

  return (
    <section className="placeholder-page">
      <div className="placeholder-card">
        <h2>{tool.label}</h2>
        <p className="placeholder-sub">{tool.labelZh}</p>
        <p>该功能仍通过下方嵌入的旧版页面提供完整能力，React 版正在逐步替换。</p>
        <ul>
          <li>旧模块：`web/` 目录下对应 JS 文件</li>
          <li>当前阶段：Phase 0 应用骨架已完成，此工具页尚未实现</li>
        </ul>
      </div>
    </section>
  );
}
