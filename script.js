const root = document.documentElement;
const themeToggle = document.querySelector("[data-theme-toggle]");
const searchInput = document.querySelector("[data-search]");
const countOutput = document.querySelector("[data-count]");
const emptyState = document.querySelector("[data-empty]");
const phaseSelect = document.querySelector("[data-phase-select]");
const topicView = document.querySelector("[data-topic-view]");
const phaseView = document.querySelector("[data-phase-view]");
const blocks = [...document.querySelectorAll("[data-block]")];
const topics = [...document.querySelectorAll("[data-topic]")];
const rubricBlock = document.querySelector("[data-rubric-block]");
const rubricItems = [...document.querySelectorAll("[data-rubric-item]")];
const materialsUrl = "data/materials.json";
const phasesUrl = "data/phases.json";

let currentView = "topics";
let phasesData = null;

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

function updateCount(visible, type = "temas") {
  if (!countOutput) return;
  const singularByType = {
    novedades: "novedad",
    recursos: "recurso",
    temas: "tema",
  };
  const singular = singularByType[type] || "elemento";
  countOutput.textContent = visible === 1 ? `1 ${singular}` : `${visible} ${type}`;
}

function updateTopicCount(visibleTopics, visibleRubrics) {
  if (!countOutput) return;

  if (visibleRubrics > 0 && visibleTopics > 0) {
    countOutput.textContent = `${visibleTopics} temas · ${visibleRubrics} rúbricas`;
    return;
  }

  if (visibleRubrics > 0) {
    countOutput.textContent = visibleRubrics === 1 ? "1 rúbrica" : `${visibleRubrics} rúbricas`;
    return;
  }

  updateCount(visibleTopics);
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

function getOpenLinkText(item) {
  if (item.clickLabel) return item.clickLabel;
  if (item.urlMode === "drive-pdf-preview" || item.urlMode === "official-pdf") return "PDF";
  if (item.urlMode === "official-doc") return "DOC";
  if (item.urlMode === "official-sheet") return "XLS";
  if (item.urlMode === "official-page") return "Oficial";
  if (item.urlMode === "drive-title-search" || item.urlMode === "drive-file-view") return "Drive";
  return "Abrir";
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
      openLink.textContent = getOpenLinkText(material);
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
    renderPhaseOptions();
  } catch (error) {
    console.warn(error);
  }
}

function renderPhaseOptions() {
  if (!phaseSelect || !phasesData?.phases) return;
  const phaseOrder = [
    "98_Novedades_y_publicaciones",
    "00_Normativa_y_orden_legal",
    "02_Primera_prueba_A_Practico",
    "01_Primera_prueba_B_Tema_escrito",
    "03_Segunda_prueba_Programacion_didactica",
    "04_Segunda_prueba_Unidad_didactica",
    "05_Fase_concurso_meritos",
    "06_Fase_practicas",
    "99_Transversal_Bibliografia_y_simulacros",
  ];
  const orderIndex = new Map(phaseOrder.map((phaseId, index) => [phaseId, index]));

  [...phasesData.phases]
    .sort((left, right) => (orderIndex.get(left.id) ?? 99) - (orderIndex.get(right.id) ?? 99))
    .forEach((phase) => {
      phaseSelect.append(createOption(phase.id, phase.title));
    });
}

function formatSectionName(section) {
  return section
    .replaceAll("_", " ")
    .replaceAll("/", " / ");
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
      resource.status,
      resource.officialDate,
      resource.note,
    ].join(" "),
  ).includes(query);
}

function getSelectedPhase() {
  return phasesData?.phases?.find((phase) => phase.id === currentView);
}

function groupResourcesBySection(resources) {
  return resources.reduce((groups, resource) => {
    const section = resource.section || "General";
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push(resource);
    return groups;
  }, new Map());
}

function getOrderedSectionGroups(phase, groups) {
  const sectionOrder = new Map(
    (phase.sections || []).map((section, index) => [section.name, index]),
  );

  return [...groups.entries()].sort(
    ([left], [right]) => (sectionOrder.get(left) ?? 999) - (sectionOrder.get(right) ?? 999),
  );
}

function getResourceMarker(resource) {
  const topic = resource.topic || "";
  if (!topic || topic === "General") return "•";

  const themeNumbers = topic.match(/\d+/g);
  if (!themeNumbers?.length) return "•";

  return `T${themeNumbers.map((number) => number.padStart(2, "0")).join("/")}`;
}

function getResourceMetaItems(resource) {
  const items = [];
  if (resource.topic && resource.topic !== "General") items.push({ text: resource.topic });
  if (resource.academy) items.push({ text: resource.academy });
  if (resource.type) items.push({ text: resource.type });
  if (resource.area) items.push({ text: resource.area });
  if (resource.officialDate) items.push({ text: resource.officialDate });
  if (resource.status) {
    items.push({
      text: resource.status,
      kind: resource.statusKind ? `is-${resource.statusKind}` : "is-status",
    });
  }
  return items;
}

function buildResourceItem(resource) {
  const item = createElement("li", "topic-item");
  item.dataset.phaseResource = "";

  const row = createElement("span", "topic-row");
  const number = createElement("span", "topic-number phase-marker", getResourceMarker(resource));
  if (resource.topic && resource.topic !== "General") number.title = resource.topic;
  const title = createElement("span", "", resource.title);
  row.append(number, title);

  const panel = createElement("div", "topic-materials phase-materials");
  const meta = createElement("span", "phase-meta");
  getResourceMetaItems(resource).forEach(({ text, kind }) => {
    const chip = createElement("span", kind ? `phase-meta-chip ${kind}` : "phase-meta-chip", text);
    meta.append(chip);
  });
  if (resource.note) meta.title = resource.note;

  const openLink = document.createElement("a");
  openLink.className = "material-link";
  openLink.target = "_blank";
  openLink.rel = "noreferrer";

  if (resource.hasPublicLink && resource.url) {
    openLink.href = resource.url;
    openLink.textContent = getOpenLinkText(resource);
    openLink.title = resource.title;
    openLink.setAttribute("aria-label", `Abrir ${resource.title}`);
  } else {
    openLink.textContent = "Pendiente";
    openLink.setAttribute("aria-disabled", "true");
  }

  panel.append(meta, openLink);
  item.append(row, panel);
  return item;
}

function renderSelectedPhase() {
  if (!phaseView) return;
  const phase = getSelectedPhase();
  if (!phase) return;

  const query = normalize(searchInput?.value.trim() || "");
  const resources = (phase.resources || []).filter((resource) => resourceMatches(resource, query));
  const groups = groupResourcesBySection(resources);
  const fragment = document.createDocumentFragment();

  if (!resources.length) {
    const block = createElement("article", "topic-block");
    const header = createElement("header", "block-header");
    header.append(createElement("p", "", phase.label), createElement("h2", "", phase.title));
    const list = createElement("ol", "topic-list");
    const item = createElement("li", "topic-item");
    const row = createElement("span", "topic-row");
    row.append(createElement("span", "topic-number phase-marker", "•"), createElement("span", "", "No hay recursos que coincidan."));
    item.append(row);
    list.append(item);
    block.append(header, list);
    fragment.append(block);
  } else {
    getOrderedSectionGroups(phase, groups).forEach(([section, sectionResources]) => {
      const block = createElement("article", "topic-block");
      const header = createElement("header", "block-header");
      header.append(createElement("p", "", phase.label), createElement("h2", "", formatSectionName(section)));
      const list = createElement("ol", "topic-list");
      sectionResources.forEach((resource) => {
        list.append(buildResourceItem(resource));
      });
      block.append(header, list);
      fragment.append(block);
    });
  }

  phaseView.replaceChildren(fragment);
  updateCount(resources.length, phase.id === "98_Novedades_y_publicaciones" ? "novedades" : "recursos");
  if (emptyState) emptyState.hidden = true;
}

function filterTopics() {
  const query = normalize(searchInput?.value.trim() || "");
  let visibleTopics = 0;
  let visibleRubrics = 0;

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

  rubricItems.forEach((item) => {
    const isVisible = !query || normalize(item.textContent || "").includes(query);
    item.hidden = !isVisible;
    if (isVisible) visibleRubrics += 1;
  });

  if (rubricBlock) rubricBlock.hidden = visibleRubrics === 0;

  updateTopicCount(visibleTopics, visibleRubrics);
  if (emptyState) emptyState.hidden = visibleTopics !== 0 || visibleRubrics !== 0;
}

function renderCurrentView() {
  if (currentView === "topics") {
    topicView.hidden = false;
    phaseView.hidden = true;
    searchInput.placeholder = "Buscar tema...";
    filterTopics();
    return;
  }

  topicView.hidden = true;
  phaseView.hidden = false;
  const phase = getSelectedPhase();
  searchInput.placeholder = phase?.id === "98_Novedades_y_publicaciones"
    ? "Buscar novedad..."
    : "Buscar recurso...";
  renderSelectedPhase();
}

setTheme(root.dataset.theme || "dark");
filterTopics();
loadMaterials();
loadPhases();

themeToggle?.addEventListener("click", () => {
  const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
  setTheme(nextTheme);
});

phaseSelect?.addEventListener("change", () => {
  currentView = phaseSelect.value;
  renderCurrentView();
});

searchInput?.addEventListener("input", renderCurrentView);
