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
const fallbackTopicTemplate = [
  {
    name: "Índice",
    goal: "Abrir con 4-6 epígrafes que ordenen el tema y dejen claro el eje central.",
    check: "El recorrido completo se entiende de un vistazo.",
  },
  {
    name: "Introducción",
    goal: "Definir el tema, justificar su relevancia técnica/docente y anunciar la estructura.",
    check: "Incluye definición, importancia y enlace con el temario oficial.",
  },
  {
    name: "Desarrollo científico",
    goal: "Explicar conceptos, clasificaciones, funcionamiento, relaciones, límites y terminología.",
    check: "Cada epígrafe aporta contenido evaluable.",
  },
  {
    name: "Normativa y actualización",
    goal: "Integrar BOE, normativa educativa, Murcia, estándares, seguridad, accesibilidad y versiones actuales cuando proceda.",
    check: "La normativa no queda pegada al final sin relación.",
  },
  {
    name: "Ejemplos propios",
    goal: "Incluir 2-3 ejemplos breves y correctos, conectados con DAW, programación, BBDD, redes, sistemas o seguridad.",
    check: "Los ejemplos demuestran dominio real.",
  },
  {
    name: "Conclusión",
    goal: "Cerrar sintetizando el valor del tema y su aplicación profesional/docente.",
    check: "No repite la introducción.",
  },
  {
    name: "Bibliografía",
    goal: "Terminar con fuentes oficiales, manuales, documentación técnica y referencias actualizadas.",
    check: "No depende solo de apuntes de academia.",
  },
];

let currentView = "topics";
let materialsData = null;
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
    áreas: "área",
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

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
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
    materialsData = data;

    topics.forEach((topic) => {
      const key = getTopicKey(topic);
      buildMaterialControls(topic, data.topics?.[key]);
    });

    if (currentView === "progress") renderCurrentView();
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
    "97_Que_cae_mas",
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
      ...getResourceDocumentTags(resource).map(({ text }) => text),
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

function getTopicEntries() {
  return Object.entries(materialsData?.topics || {})
    .map(([key, topic]) => ({ key, topic }))
    .sort((left, right) => Number(left.key) - Number(right.key));
}

function getTopicMaterial(topic, predicate) {
  return (topic.materials || []).find(predicate);
}

function getProgressState(topic) {
  const myTopic = getTopicMaterial(topic, (material) => material.academy === "Mi temario");
  const examples = (topic.materials || []).filter((material) => material.academy === "Ejemplos míos");
  const fullExample = examples.find((material) => material.variant === "tema-desarrollado");
  const memorySheet = examples.find((material) => material.variant === "memorizacion");

  return {
    fullExample,
    memorySheet,
    myTopic,
    updatedAt: myTopic?.progressUpdatedAt,
  };
}

function getTopicTemplateSections() {
  return materialsData?.myTopicProgress?.templateStructure || fallbackTopicTemplate;
}

function progressTopicMatches(entry, query) {
  if (!query) return true;
  const state = getProgressState(entry.topic);
  const templateText = getTopicTemplateSections()
    .map((section) => [section.name, section.goal, section.check].join(" "))
    .join(" ");
  return normalize(
    [
      entry.key,
      entry.topic.title,
      entry.topic.block,
      state.myTopic?.progressLabel,
      state.fullExample?.label,
      state.memorySheet?.label,
      templateText,
    ].join(" "),
  ).includes(query);
}

function buildProgressOverview(entries) {
  const progress = materialsData?.myTopicProgress || {};
  const templatesReady = progress.templatesReady ?? entries.filter(({ topic }) => getProgressState(topic).myTopic).length;
  const examplesReady = progress.examplesAvailable ?? entries.filter(({ topic }) => getProgressState(topic).fullExample).length;
  const memoryReady = progress.memorySheetsAvailable ?? entries.filter(({ topic }) => getProgressState(topic).memorySheet).length;
  const total = progress.totalTopics ?? entries.length;
  const templateSections = getTopicTemplateSections();

  const block = createElement("article", "topic-block progress-overview");
  const header = createElement("header", "block-header");
  header.append(createElement("p", "", "Mi progreso"), createElement("h2", "", "Estado de mis temas"));

  const dashboard = createElement("div", "progress-dashboard");
  [
    ["Plantillas", `${templatesReady}/${total}`],
    ["Estructura", `${templateSections.length} apartados`],
    ["Mis versiones", `${progress.myVersionsComplete || 0} completas`],
    ["Ejemplos", `${examplesReady} disponibles`],
    ["Repasos", `${memoryReady} disponibles`],
    ["Revisión", formatDate(progress.updatedAt)],
  ].forEach(([label, value]) => {
    const stat = createElement("span", "progress-stat");
    stat.append(createElement("span", "progress-stat-label", label), createElement("strong", "", value));
    dashboard.append(stat);
  });

  block.append(header, dashboard);
  return block;
}

function buildTemplateGuide() {
  const progress = materialsData?.myTopicProgress || {};
  const sections = getTopicTemplateSections();
  const block = createElement("article", "topic-block template-guide");
  const header = createElement("header", "block-header");
  header.append(
    createElement("p", "", "Plantilla"),
    createElement("h2", "", progress.templateName || "Plantilla fija de tema de 10"),
  );

  const list = createElement("ol", "topic-list template-list");
  sections.forEach((section, index) => {
    const item = createElement("li", "topic-item template-item");
    const row = createElement("span", "topic-row");
    row.append(
      createElement("span", "topic-number", String(index + 1).padStart(2, "0")),
      createElement("span", "", section.name),
    );

    const detail = createElement("div", "template-detail");
    detail.append(createElement("p", "template-goal", section.goal));
    if (section.check) detail.append(createElement("p", "template-check", section.check));
    item.append(row, detail);
    list.append(item);
  });

  block.append(header, list);
  return block;
}

function buildProgressItem(entry) {
  const { key, topic } = entry;
  const state = getProgressState(topic);
  const item = createElement("li", "topic-item progress-item");

  const row = createElement("span", "topic-row");
  row.append(createElement("span", "topic-number", key), createElement("span", "", topic.title));

  const panel = createElement("div", "topic-materials phase-materials progress-materials");
  const meta = createElement("span", "phase-meta progress-meta");

  const chips = [];
  chips.push({
    kind: state.myTopic ? "is-done" : "is-pending",
    text: state.myTopic?.progressLabel || "Sin plantilla",
  });
  chips.push({ kind: "is-pending", text: "Mi versión pendiente" });
  if (state.fullExample) chips.push({ kind: "is-done", text: "Ejemplo completo" });
  if (state.memorySheet) chips.push({ kind: "is-done", text: "Repaso listo" });
  if (state.updatedAt) chips.push({ text: `Rev. ${formatDate(state.updatedAt)}` });

  chips.forEach(({ text, kind }) => {
    meta.append(createElement("span", kind ? `phase-meta-chip ${kind}` : "phase-meta-chip", text));
  });

  const actions = createElement("span", "progress-actions");
  [
    { item: state.myTopic, label: "Editar" },
    { item: state.fullExample, label: "Leer" },
    { item: state.memorySheet, label: "Repasar" },
  ].forEach(({ item: material, label }) => {
    if (!material?.url) return;
    const link = document.createElement("a");
    link.className = "material-link progress-link";
    link.href = material.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = material.clickLabel || label;
    link.title = material.driveFileName || material.label || label;
    actions.append(link);
  });

  panel.append(meta, actions);
  item.append(row, panel);
  return item;
}

function renderProgressView() {
  if (!phaseView) return;

  if (!materialsData?.topics) {
    phaseView.replaceChildren();
    updateCount(0);
    return;
  }

  const query = normalize(searchInput?.value.trim() || "");
  const entries = getTopicEntries();
  const filteredEntries = entries.filter((entry) => progressTopicMatches(entry, query));
  const groups = filteredEntries.reduce((map, entry) => {
    const block = entry.topic.block || "Temario";
    if (!map.has(block)) map.set(block, []);
    map.get(block).push(entry);
    return map;
  }, new Map());

  const fragment = document.createDocumentFragment();
  fragment.append(buildProgressOverview(entries));
  fragment.append(buildTemplateGuide());

  if (!filteredEntries.length) {
    const block = createElement("article", "topic-block");
    const header = createElement("header", "block-header");
    header.append(createElement("p", "", "Mi progreso"), createElement("h2", "", "Sin resultados"));
    const list = createElement("ol", "topic-list");
    const item = createElement("li", "topic-item");
    const row = createElement("span", "topic-row topic-row-no-marker");
    row.append(createElement("span", "", "No hay temas que coincidan."));
    item.append(row);
    list.append(item);
    block.append(header, list);
    fragment.append(block);
  } else {
    groups.forEach((blockEntries, blockName) => {
      const block = createElement("article", "topic-block");
      const header = createElement("header", "block-header");
      header.append(createElement("p", "", "Mi progreso"), createElement("h2", "", blockName));
      const list = createElement("ol", "topic-list");
      blockEntries.forEach((entry) => list.append(buildProgressItem(entry)));
      block.append(header, list);
      fragment.append(block);
    });
  }

  phaseView.replaceChildren(fragment);
  updateCount(filteredEntries.length);
  if (emptyState) emptyState.hidden = filteredEntries.length !== 0;
}

function getResourceMarker(resource) {
  const topic = resource.topic || "";
  if (!topic || topic === "General") return "";

  const themeNumbers = topic.match(/\d+/g);
  if (!themeNumbers?.length) return "";

  return `T${themeNumbers.map((number) => number.padStart(2, "0")).join("/")}`;
}

function getResourceDocumentTags(resource) {
  const rawText = [
    resource.title,
    resource.section,
    resource.type,
    resource.academy,
    resource.area,
    resource.note,
    resource.url,
  ].join(" ");
  const text = normalize(rawText);
  const tags = [];

  const isOfficialMurcia =
    resource.academy === "CARM/BORM" ||
    text.includes("carm.es") ||
    text.includes("borm.es") ||
    text.includes("rrhheducacion.carm.es") ||
    (text.includes("murcia") && text.includes("oficial"));
  const isOfficialOtherRegion =
    resource.officialScope === "other-ccaa" ||
    resource.sourceKind === "official-other-ccaa";

  if (isOfficialMurcia) {
    tags.push({ text: "Oficial Murcia", kind: "is-doc-tag is-official-murcia" });
  } else if (isOfficialOtherRegion) {
    tags.push({ text: "Oficial otra CCAA", kind: "is-doc-tag is-official-other" });
  }

  const isRubric = text.includes("rubrica") || text.includes("criterios de valoracion");
  const isCriteria =
    text.includes("criterio") ||
    text.includes("criterios") ||
    text.includes("baremo") ||
    text.includes("especificaciones oficiales");
  const isPractical =
    resource.phase === "02_Primera_prueba_A_Practico" ||
    text.includes("practico") ||
    text.includes("prueba practica") ||
    text.includes("simulacro") ||
    text.includes("correccion");

  if (isRubric) tags.push({ text: "Rúbrica", kind: "is-doc-tag is-rubric" });
  if (isPractical) tags.push({ text: "Práctico", kind: "is-doc-tag is-practical" });
  if (isCriteria) tags.push({ text: "Criterios", kind: "is-doc-tag is-criteria" });

  if (!isRubric && !isPractical && !isCriteria) {
    tags.push({ text: "Referencia", kind: "is-doc-tag is-reference" });
  }

  return tags;
}

function getResourceMetaItems(resource) {
  const items = [...getResourceDocumentTags(resource)];
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

function trendMatches(trend, query) {
  if (!query) return true;
  return normalize(
    [
      trend.name,
      trend.priority,
      trend.years?.join(" "),
      trend.focus?.join(" "),
      trend.evidence?.join(" "),
      trend.studyAction,
    ].join(" "),
  ).includes(query);
}

function buildTrendOverview(phase, trends) {
  const sources = phase.sourceYears || [];
  const totalYears = new Set(sources.map((source) => source.year)).size;
  const maxScore = Math.max(...trends.map((trend) => trend.score || 0), 0);

  const block = createElement("article", "topic-block trend-overview");
  const header = createElement("header", "block-header");
  header.append(createElement("p", "", phase.label), createElement("h2", "", "Lectura rápida"));

  const dashboard = createElement("div", "progress-dashboard trend-dashboard");
  [
    ["Años oficiales", totalYears],
    ["Áreas críticas", trends.filter((trend) => trend.priority?.includes("Muy alta")).length],
    ["Máxima frecuencia", `${maxScore} evidencias`],
    ["Otras CCAA", "0"],
  ].forEach(([label, value]) => {
    const stat = createElement("span", "progress-stat");
    stat.append(createElement("span", "progress-stat-label", label), createElement("strong", "", value));
    dashboard.append(stat);
  });

  const note = createElement(
    "p",
    "trend-note",
    phase.description || "Cruce de prácticos oficiales localizados.",
  );
  const body = createElement("div", "trend-overview-body");
  body.append(dashboard, note);
  block.append(header, body);
  return block;
}

function buildTrendItem(trend, index) {
  const item = createElement("li", "topic-item trend-item");
  const row = createElement("span", "topic-row");
  row.append(
    createElement("span", "topic-number", String(index + 1).padStart(2, "0")),
    createElement("span", "", trend.name),
  );

  const detail = createElement("div", "trend-detail");
  const width = Math.max(8, Math.min(100, ((trend.appearances || 0) / (trend.totalYears || 1)) * 100));
  const meter = createElement("span", "trend-meter");
  const bar = createElement("span", "trend-meter-bar");
  bar.style.width = `${width}%`;
  meter.append(bar);

  const meta = createElement("span", "phase-meta trend-meta");
  [
    trend.priority,
    `${trend.appearances}/${trend.totalYears} convocatorias`,
    `${trend.score} evidencias`,
    ...(trend.years || []),
  ]
    .filter(Boolean)
    .forEach((text, chipIndex) => {
      const kind = chipIndex === 0 ? "phase-meta-chip is-doc-tag is-official-murcia" : "phase-meta-chip";
      meta.append(createElement("span", kind, text));
    });

  const focus = createElement("p", "trend-focus", (trend.focus || []).join(" · "));
  const evidence = createElement("div", "trend-evidence");
  (trend.evidence || []).forEach((line) => evidence.append(createElement("p", "", line)));
  const action = createElement("p", "trend-action", trend.studyAction);

  detail.append(meter, meta, focus, evidence, action);
  item.append(row, detail);
  return item;
}

function buildTrendSources(phase) {
  const sources = phase.sourceYears || [];
  const block = createElement("article", "topic-block");
  const header = createElement("header", "block-header");
  header.append(createElement("p", "", "Fuentes"), createElement("h2", "", "Prácticos cruzados"));

  const list = createElement("ol", "topic-list");
  sources.forEach((source, index) => {
    const item = createElement("li", "topic-item");
    const row = createElement("span", "topic-row");
    row.append(
      createElement("span", "topic-number", source.year || String(index + 1).padStart(2, "0")),
      createElement("span", "", source.title),
    );

    const panel = createElement("div", "topic-materials phase-materials");
    const meta = createElement("span", "phase-meta");
    meta.append(
      createElement("span", "phase-meta-chip is-doc-tag is-official-murcia", "Oficial Murcia"),
      createElement("span", "phase-meta-chip", source.summary || "Práctico oficial localizado"),
    );
    const link = document.createElement("a");
    link.className = "material-link";
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "PDF";
    link.setAttribute("aria-label", `Abrir ${source.title}`);
    panel.append(meta, link);
    item.append(row, panel);
    list.append(item);
  });

  block.append(header, list);
  return block;
}

function renderTrendView(phase, query) {
  const trends = (phase.trendAreas || []).filter((trend) => trendMatches(trend, query));
  const fragment = document.createDocumentFragment();
  fragment.append(buildTrendOverview(phase, phase.trendAreas || []));

  if (!trends.length) {
    const block = createElement("article", "topic-block");
    const header = createElement("header", "block-header");
    header.append(createElement("p", "", phase.label), createElement("h2", "", "Sin resultados"));
    const list = createElement("ol", "topic-list");
    const item = createElement("li", "topic-item");
    const row = createElement("span", "topic-row topic-row-no-marker");
    row.append(createElement("span", "", "No hay áreas que coincidan."));
    item.append(row);
    list.append(item);
    block.append(header, list);
    fragment.append(block);
  } else {
    const block = createElement("article", "topic-block");
    const header = createElement("header", "block-header");
    header.append(createElement("p", "", phase.label), createElement("h2", "", "Áreas por frecuencia"));
    const list = createElement("ol", "topic-list");
    trends.forEach((trend, index) => list.append(buildTrendItem(trend, index)));
    block.append(header, list);
    fragment.append(block);
  }

  fragment.append(buildTrendSources(phase));
  phaseView.replaceChildren(fragment);
  updateCount(trends.length, "áreas");
  if (emptyState) emptyState.hidden = true;
}

function buildResourceItem(resource) {
  const item = createElement("li", "topic-item");
  item.dataset.phaseResource = "";

  const marker = getResourceMarker(resource);
  const row = createElement("span", marker ? "topic-row" : "topic-row topic-row-no-marker");
  if (!marker) item.classList.add("topic-item-no-marker");
  const number = marker ? createElement("span", "topic-number phase-marker", marker) : null;
  if (number && resource.topic && resource.topic !== "General") number.title = resource.topic;
  const title = createElement("span", "", resource.title);
  if (number) row.append(number);
  row.append(title);

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
  if (phase.trendAreas) {
    renderTrendView(phase, query);
    return;
  }

  const resources = (phase.resources || []).filter((resource) => resourceMatches(resource, query));
  const groups = groupResourcesBySection(resources);
  const fragment = document.createDocumentFragment();

  if (!resources.length) {
    const block = createElement("article", "topic-block");
    const header = createElement("header", "block-header");
    header.append(createElement("p", "", phase.label), createElement("h2", "", phase.title));
    const list = createElement("ol", "topic-list");
    const item = createElement("li", "topic-item");
    const row = createElement("span", "topic-row topic-row-no-marker");
    row.append(createElement("span", "", "No hay recursos que coincidan."));
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

  if (currentView === "progress") {
    topicView.hidden = true;
    phaseView.hidden = false;
    searchInput.placeholder = "Buscar tema...";
    renderProgressView();
    return;
  }

  topicView.hidden = true;
  phaseView.hidden = false;
  const phase = getSelectedPhase();
  if (phase?.trendAreas) {
    searchInput.placeholder = "Buscar tendencia...";
  } else {
    searchInput.placeholder = phase?.id === "98_Novedades_y_publicaciones"
      ? "Buscar novedad..."
      : "Buscar recurso...";
  }
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
