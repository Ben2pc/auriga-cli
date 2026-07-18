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
    if (!target) continue;

    if (figure.type === "sequence") {
      target.innerHTML = renderSequenceSvg(figure.data);
    } else if (figure.type === "flow" || figure.type === "state") {
      target.innerHTML = renderFlowSvg(figure.data);
    } else {
      target.textContent = `不支持的图形类型: ${String(figure.type)}`;
    }
  }
}

renderDocentFigures();
