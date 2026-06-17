const root = document.documentElement;
const themeToggle = document.querySelector("[data-theme-toggle]");
const searchInput = document.querySelector("[data-search]");
const countOutput = document.querySelector("[data-count]");
const emptyState = document.querySelector("[data-empty]");
const modeButtons = [...document.querySelectorAll("[data-mode-button]")];
const topicView = document.querySelector("[data-topic-view]");
const phaseView = document.querySelector("[data-phase-view]");
const phaseTabs = document.querySelector("[data-phase-tabs]");
const phaseKicker = document.querySelector("[data-phase-kicker]");
const phaseTitle = document.querySelector("[data-phase-title]");
const phaseDescription = document.querySelector("[data-phase-description]");
const phaseResourceCount = document.querySelector("[data-phase-resource-count]");
const phaseLinkCount = document.querySelector("[data-phase-link-count]");
const phaseLegal = document.querySelector("[data-phase-legal]");
const moduleNote = document.querySelector("[data-module-note]");
const phaseGroups = document.querySelector("[data-phase-groups]");
const phaseResultCount = document.querySelector("[data-phase-result-count]");
const phaseResources = document.querySelector("[data-phase-resources]");
const blocks = [...document.querySelectorAll("[data-block]")];
const topics = [...document.querySelectorAll("[data-topic]")];
const materialsUrl = "data/materials.json";
const phasesUrl = "data/phases.json";

let currentMode = "topics";
let phasesData = null;
let selectedPhaseId = "01_Primera_prueba_B_Tema_escrito";

function setTheme(theme) {
  root.dataset.theme = theme;
  localStorage.setItem("theme", theme);

  const isDark = theme === "dark";
  themeToggle?.setAttribute("aria-label", isDark ? "Activar modo claro" : "Activar modo oscuro");
  themeToggle?.setAttribute("aria-pressed", String(isDark));
}

function normalize(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function updateCount(visible) {
  if (!countOutput) return;
  const unit = currentMode === "phases" ? "recurso" : "tema";
  const plural = currentMode === "phases" ? "recursos" : "temas";
  countOutput.textContent = visible === 1 ? `1 ${unit}` : `${visible} ${plural}`;
}

function getTopicKey(topic) {
  const number = topic.querySelector(".topic-number")?.textContent.trim();
  return number?.padStart(2, "0") || "";
}

function groupMaterialsByAcademy(materials) {
  return materials.reduce((groups, material) => {
    if (!groups.has(material.academy)) groups.set(material.academy, []);
    groups.get(material.academy).push(material);
    return groups;
  }, new Map());
}

function getMaterialLabel(material) {
  const parts = [material.label || material.fileName];
  if (material.pages) parts.push(`${material.pages} pag.`);
  return parts.join(" - ");
}

function createOption(value, text) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  return option;
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function buildMaterialControls(topic, topicData) {
  const materials = topicData?.materials || [];
  if (!materials.length || topic.querySelector("[data-materials]")) return;

  const groups = groupMaterialsByAcademy(materials);
  const panel = document.createElement("div");
  panel.className = "topic-materials";
  panel.dataset.materials = "";

  const academySelect = document.createElement("select");
  academySelect.className = "material-select";
  academySelect.setAttribute("aria-label", "Academia");

  const materialSelect = document.createElement("select");
  materialSelect.className = "material-select";
  materialSelect.setAttribute("aria-label", "Material");

  const openLink = document.createElement("a");
  openLink.className = "material-link";
  openLink.target = "_blank";
  openLink.rel = "noreferrer";

  [...groups.keys()].sort().forEach((academy) => {
    academySelect.append(createOption(academy, academy));
  });

  function renderMaterialOptions() {
    const selectedAcademy = academySelect.value;
    const academyMaterials = groups.get(selectedAcademy) || [];
    materialSelect.replaceChildren();
    academyMaterials.forEach((material, index) => {
      materialSelect.append(createOption(String(index), getMaterialLabel(material)));
    });
    renderOpenLink();
  }

  function renderOpenLink() {
    const selectedAcademy = academySelect.value;
    const academyMaterials = groups.get(selectedAcademy) || [];
    const material = academyMaterials[Number(materialSelect.value) || 0];
    if (material?.url) {
      openLink.href = material.url;
      openLink.textContent = material.urlMode === "drive-pdf-preview"
        ? "PDF"
        : material.urlMode === "drive-title-search"
          ? "Drive"
          : "Abrir";
      openLink.title = material.driveFileName || getMaterialLabel(material);
      openLink.removeAttribute("aria-disabled");
      return;
    }

    openLink.removeAttribute("href");
    openLink.removeAttribute("title");
    openLink.textContent = "Pendiente";
    openLink.setAttribute("aria-disabled", "true");
  }

  academySelect.addEventListener("change", renderMaterialOptions);
  materialSelect.addEventListener("change", renderOpenLink);

  panel.append(academySelect, materialSelect, openLink);
  topic.append(panel);
  renderMaterialOptions();
}

async function loadMaterials() {
  try {
    const response = await fetch(materialsUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`No se pudo cargar ${materialsUrl}`);
    const data = await response.json();

    topics.forEach((topic) => {
      const key = getTopicKey(topic);
      buildMaterialControls(topic, data.topics?.[key]);
    });
  } catch (error) {
    console.warn(error);
  }
}

async function loadPhases() {
  try {
    const response = await fetch(phasesUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`No se pudo cargar ${phasesUrl}`);
    phasesData = await response.json();
    renderPhaseTabs();
    renderSelectedPhase();
  } catch (error) {
    console.warn(error);
  }
}

function getSelectedPhase() {
  return phasesData?.phases?.find((phase) => phase.id === selectedPhaseId) || phasesData?.phases?.[0];
}

function renderPhaseTabs() {
  if (!phaseTabs || !phasesData?.phases) return;
  const fragment = document.createDocumentFragment();
  phasesData.phases.forEach((phase) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "phase-tab";
    button.dataset.phaseId = phase.id;
    button.setAttribute("aria-pressed", String(phase.id === selectedPhaseId));
    button.innerHTML = `<span>${phase.label}</span><strong>${phase.resourceCount}</strong>`;
    button.addEventListener("click", () => {
      selectedPhaseId = phase.id;
      renderSelectedPhase();
    });
    fragment.append(button);
  });
  phaseTabs.replaceChildren(fragment);
}

function renderModuleNote(phase) {
  if (!moduleNote || !phasesData?.selectedModule) return;
  const module = phasesData.selectedModule;
  const shouldShow = [
    "00_Normativa_y_orden_legal",
    "03_Segunda_prueba_Programacion_didactica",
    "04_Segunda_prueba_Unidad_didactica",
  ].includes(phase.id);

  if (!shouldShow) {
    moduleNote.hidden = true;
    moduleNote.replaceChildren();
    return;
  }

  moduleNote.hidden = false;
  moduleNote.innerHTML = `
    <p><strong>DAW ${module.code}</strong> · ${module.module}</p>
    <p>${module.course} · ${module.current_total_hours} · ${module.weekly_hours}</p>
  `;
}

function renderPhaseGroups(phase) {
  if (!phaseGroups) return;
  const groups = [
    ["Secciones", phase.sections],
    ["Academias", phase.academies],
    ["Tipos", phase.types],
  ];
  const fragment = document.createDocumentFragment();

  groups.forEach(([label, items]) => {
    if (!items?.length) return;
    const group = createElement("section", "phase-group");
    group.append(createElement("h3", "", label));
    const list = createElement("div", "phase-chips");
    items.slice(0, 10).forEach((item) => {
      const chip = createElement("span", "phase-chip");
      chip.innerHTML = `<span>${item.name}</span><strong>${item.count}</strong>`;
      list.append(chip);
    });
    group.append(list);
    fragment.append(group);
  });

  if (phase.id === "00_Normativa_y_orden_legal" && phasesData?.legalSources?.length) {
    const sourceGroup = createElement("section", "phase-group phase-group-wide");
    sourceGroup.append(createElement("h3", "", "Fuentes oficiales"));
    const sourceList = createElement("div", "source-grid");
    phasesData.legalSources.forEach((source) => {
      const link = document.createElement("a");
      link.className = "source-card";
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.innerHTML = `<span>${source.nivel}</span><strong>${source.norma}</strong>`;
      sourceList.append(link);
    });
    sourceGroup.append(sourceList);
    fragment.append(sourceGroup);
  }

  phaseGroups.replaceChildren(fragment);
}

function resourceMatches(resource, query) {
  if (!query) return true;
  return normalize(
    [
      resource.title,
      resource.section,
      resource.type,
      resource.academy,
      resource.topic,
      resource.area,
    ].join(" "),
  ).includes(query);
}

function renderPhaseResources(phase) {
  if (!phaseResources || !phaseResultCount) return;
  const query = normalize(searchInput?.value.trim() || "");
  const resources = (phase.resources || []).filter((resource) => resourceMatches(resource, query));
  const fragment = document.createDocumentFragment();

  resources.forEach((resource) => {
    const item = createElement("article", "phase-resource");
    const body = createElement("div", "phase-resource-body");
    body.append(createElement("h3", "", resource.title));
    body.append(
      createElement(
        "p",
        "",
        [resource.section, resource.topic, resource.academy, resource.type]
          .filter(Boolean)
          .join(" · "),
      ),
    );

    if (resource.hasPublicLink && resource.url) {
      const link = document.createElement("a");
      link.className = "phase-resource-link";
      link.href = resource.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = resource.urlMode === "drive-pdf-preview" ? "PDF" : "Drive";
      item.append(body, link);
    } else {
      const badge = createElement("span", "phase-resource-pending", "Pendiente Drive");
      item.append(body, badge);
    }

    fragment.append(item);
  });

  if (!resources.length) {
    const empty = createElement("p", "phase-empty", "No hay recursos que coincidan con la búsqueda en esta fase.");
    fragment.append(empty);
  }

  phaseResultCount.textContent = resources.length === 1 ? "1 recurso" : `${resources.length} recursos`;
  phaseResources.replaceChildren(fragment);
  updateCount(resources.length);
}

function renderSelectedPhase() {
  const phase = getSelectedPhase();
  if (!phase) return;

  selectedPhaseId = phase.id;
  if (phaseKicker) phaseKicker.textContent = phase.label;
  if (phaseTitle) phaseTitle.textContent = phase.title;
  if (phaseDescription) phaseDescription.textContent = phase.description;
  if (phaseResourceCount) phaseResourceCount.textContent = phase.resourceCount;
  if (phaseLinkCount) phaseLinkCount.textContent = phase.publicLinkCount;
  if (phaseLegal) phaseLegal.textContent = phase.legal;

  phaseTabs?.querySelectorAll("[data-phase-id]").forEach((button) => {
    const isActive = button.dataset.phaseId === phase.id;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  renderModuleNote(phase);
  renderPhaseGroups(phase);
  renderPhaseResources(phase);
}

function filterTopics() {
  const query = normalize(searchInput?.value.trim() || "");
  let visibleTopics = 0;

  topics.forEach((topic) => {
    const isVisible = normalize(topic.textContent || "").includes(query);
    topic.hidden = !isVisible;
    if (isVisible) visibleTopics += 1;
  });

  blocks.forEach((block) => {
    const hasVisibleTopic = [...block.querySelectorAll("[data-topic]")].some(
      (topic) => !topic.hidden,
    );
    block.hidden = !hasVisibleTopic;
  });

  updateCount(visibleTopics);
  if (emptyState) emptyState.hidden = visibleTopics !== 0;
}

function filterCurrentView() {
  if (currentMode === "phases") {
    if (emptyState) emptyState.hidden = true;
    const phase = getSelectedPhase();
    if (phase) renderPhaseResources(phase);
    return;
  }
  filterTopics();
}

function setMode(mode) {
  currentMode = mode;
  topicView.hidden = mode !== "topics";
  phaseView.hidden = mode !== "phases";
  if (emptyState && mode === "phases") emptyState.hidden = true;
  searchInput.placeholder = mode === "topics" ? "Buscar tema..." : "Buscar recurso, área, academia...";
  modeButtons.forEach((button) => {
    const isActive = button.dataset.modeButton === mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  filterCurrentView();
}

setTheme(root.dataset.theme || "dark");
updateCount(topics.length);
loadMaterials();
loadPhases();

themeToggle?.addEventListener("click", () => {
  const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
  setTheme(nextTheme);
});

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.modeButton || "topics"));
});

searchInput?.addEventListener("input", filterCurrentView);
