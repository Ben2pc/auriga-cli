function renderDocentFigures() {
  const source = document.getElementById("docent-figures");
  if (!source) return;

  let figures;
  try {
    figures = JSON.parse(source.textContent || "[]");
  } catch (error) {
    console.error("docent figures JSON 无法解析", error);
    return;
  }

  for (const figure of figures) {
    const target = document.getElementById(figure.target);
    if (!target) {
      console.error(`docent figure target 不存在: ${String(figure.target)}`);
      continue;
    }

    try {
      if (figure.type === "sequence") {
        target.innerHTML = renderSequenceSvg(figure.data);
      } else if (figure.type === "flow" || figure.type === "state") {
        target.innerHTML = renderFlowSvg(figure.data);
      } else {
        target.textContent = `不支持的图形类型: ${String(figure.type)}`;
      }
    } catch (error) {
      console.error(`docent figure 渲染失败: ${String(figure.target)}`, error);
      target.textContent = "图形渲染失败；其他内容仍可阅读，请重新生成报告。";
    }
  }
}

renderDocentFigures();
