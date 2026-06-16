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
        <p>该功能的 React 版本尚未实现。</p>
        <ul>
          <li>旧版实现已收拢到 `legacy/web/`。</li>
          <li>当前阶段：此工具页尚未实现。</li>
        </ul>
      </div>
    </section>
  );
}
