(() => {
  const container = document.querySelector("[data-family-tree]");
  if (!container) return;
  const nodes = [...container.querySelectorAll("[data-tree-id]")],
    links = [...document.querySelectorAll(".tree-link")].map((e) => ({
      parent: e.dataset.parent,
      child: e.dataset.child,
      kind: e.dataset.kind,
    })),
    depth = new Map(nodes.map((n) => [n.dataset.treeId, 0]));
  for (let i = 0; i < nodes.length; i++)
    for (const l of links)
      if (l.kind === "parent" && depth.has(l.parent) && depth.has(l.child))
        depth.set(
          l.child,
          Math.max(
            depth.get(l.child),
            Math.min(nodes.length, depth.get(l.parent) + 1),
          ),
        );
  const rows = new Map();
  for (const node of nodes) {
    const d = depth.get(node.dataset.treeId);
    if (!rows.has(d)) rows.set(d, []);
    rows.get(d).push(node);
  }
  for (const [level, items] of [...rows].sort((a, b) => a[0] - b[0])) {
    const row = document.createElement("div");
    row.className = "tree-row";
    row.dataset.level = level;
    items.forEach((n) => row.append(n));
    container.append(row);
  }
  const svg = container.querySelector("svg");
  function paint() {
    svg.replaceChildren();
    svg.setAttribute("width", container.scrollWidth);
    svg.setAttribute("height", container.scrollHeight);
    for (const l of links) {
      const p = container.querySelector(`[data-tree-id="${l.parent}"]`),
        c = container.querySelector(`[data-tree-id="${l.child}"]`);
      if (!p || !c) continue;
      const a = p.getBoundingClientRect(),
        b = c.getBoundingClientRect(),
        r = container.getBoundingClientRect(),
        x1 = a.left + a.width / 2 - r.left + container.scrollLeft,
        y1 =
          (l.kind === "parent" ? a.bottom : a.top + a.height / 2) -
          r.top +
          container.scrollTop,
        x2 = b.left + b.width / 2 - r.left + container.scrollLeft,
        y2 =
          (l.kind === "parent" ? b.top : b.top + b.height / 2) -
          r.top +
          container.scrollTop,
        path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute(
        "d",
        l.kind === "parent"
          ? `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`
          : `M${x1},${y1} L${x2},${y2}`,
      );
      path.setAttribute("class", l.kind);
      svg.append(path);
    }
  }
  new ResizeObserver(paint).observe(container);
  window.addEventListener("load", paint);
  paint();
})();
