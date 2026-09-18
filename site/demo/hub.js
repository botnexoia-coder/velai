(() => {
  const grid = document.querySelector("#demo-grid");
  const count = document.querySelector("#catalog-count");
  const error = document.querySelector("#catalog-error");

  const createText = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = String(text ?? "");
    return element;
  };

  const renderCard = (demo, index) => {
    const paused = demo.status === "paused";
    const card = document.createElement(paused ? "article" : "a");
    card.className = `demo-card accent-${demo.accent || "blue"}${paused ? " is-paused" : ""}`;
    card.style.setProperty("--card-index", index);
    if (!paused) card.href = demo.path;

    const content = document.createElement("div");
    content.className = "card-content";
    const top = document.createElement("div");
    top.className = "card-top";
    top.append(createText("span", "card-eyebrow", demo.eyebrow));
    top.append(createText("span", `status status-${demo.status}`, paused ? "En pausa" : "Demo activa"));

    const body = document.createElement("div");
    body.className = "card-body";
    body.append(createText("h3", "", demo.title));
    body.append(createText("p", "", demo.description));

    const action = createText("span", "card-action", paused ? "Temporalmente no disponible" : "Abrir experiencia");
    if (!paused) action.append(" →");
    content.append(top, body, action);
    card.append(content);
    if (typeof demo.image === "string" && demo.image.startsWith("/demo/")) {
      const preview = document.createElement("img");
      preview.className = "card-preview";
      preview.src = demo.image;
      preview.alt = "";
      preview.loading = "lazy";
      card.append(preview);
    }
    return card;
  };

  fetch("./manifest.json", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((catalog) => {
      if (!catalog || !Array.isArray(catalog.demos)) throw new Error("Catálogo inválido");
      const visible = catalog.demos.filter((demo) => demo && ["active", "paused"].includes(demo.status));
      visible.forEach((demo, index) => grid.append(renderCard(demo, index)));
      if (!visible.length) grid.append(createText("p", "empty", "No hay demos visibles en este momento."));
      count.textContent = `${visible.filter((demo) => demo.status === "active").length} ${visible.filter((demo) => demo.status === "active").length === 1 ? "demo activa" : "demos activas"}`;
      grid.setAttribute("aria-busy", "false");
    })
    .catch((cause) => {
      console.error("No se pudo cargar el catálogo de demos", cause);
      grid.setAttribute("aria-busy", "false");
      count.textContent = "Catálogo no disponible";
      error.hidden = false;
    });
})();
