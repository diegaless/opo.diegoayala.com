const root = document.documentElement;
const searchInput = document.querySelector("[data-search]");
const searchClear = document.querySelector("[data-search-clear]");
const countOutput = document.querySelector("[data-count]");
const emptyState = document.querySelector("[data-empty]");
const phaseSelect = document.querySelector("[data-phase-select]");
const phaseTrigger = document.querySelector("[data-phase-trigger]");
const phaseValue = document.querySelector("[data-phase-value]");
const phaseDialog = document.querySelector("[data-phase-dialog]");
const phaseDialogClose = document.querySelector("[data-phase-close]");
const phaseOptionSearch = document.querySelector("[data-phase-search]");
const phaseOptionList = document.querySelector("[data-phase-options]");
const indexTrigger = document.querySelector("[data-index-trigger]");
const indexDialog = document.querySelector("[data-index-dialog]");
const indexDialogClose = document.querySelector("[data-index-close]");
const indexList = document.querySelector("[data-index-list]");
const topicView = document.querySelector("[data-topic-view]");
const phaseView = document.querySelector("[data-phase-view]");
const blocks = [...document.querySelectorAll("[data-block]")];
const topics = [...document.querySelectorAll("[data-topic]")];
const rubricBlock = document.querySelector("[data-rubric-block]");
const rubricItems = [...document.querySelectorAll("[data-rubric-item]")];
const rubricToggle = document.querySelector("[data-rubric-toggle]");
const materialsUrl = "data/materials.json";
const phasesUrl = "data/phases.json";
const studyStateKey = "opo-study-state-v1";
const collapsedBlocksKey = "opo-collapsed-blocks-v1";
const rubricExpandedKey = "opo-rubric-expanded-v1";
const resourceFiltersKey = "opo-resource-filters-v1";
const personalProgressKey = "opo-personal-progress-v1";
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
let isRestoringStudyState = true;
let scrollSaveTimer = null;
let lastExplicitStudyItem = null;
let readingPositionFrame = null;
let resourceFilters = readStoredObject(resourceFiltersKey);
let personalProgress = readStoredObject(personalProgressKey);
let rubricExpandedSession = null;

function normalize(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function readStoredObject(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeStoredObject(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The interface remains usable when storage is unavailable.
  }
}

function showModal(dialog) {
  if (!dialog || dialog.open) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeModal(dialog) {
  if (!dialog?.open) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function clickedOutsideDialog(dialog, event) {
  if (event.target !== dialog) return false;
  const rect = dialog.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right
    || event.clientY < rect.top || event.clientY > rect.bottom;
}

function syncPhasePicker() {
  if (!phaseSelect || !phaseValue) return;
  const selected = phaseSelect.selectedOptions[0];
  if (selected) phaseValue.textContent = selected.textContent;
  phaseOptionList?.querySelectorAll("[data-phase-option]").forEach((option) => {
    option.setAttribute("aria-selected", String(option.dataset.phaseOption === phaseSelect.value));
  });
}

function getVisiblePhaseOptions() {
  if (!phaseOptionList) return [];
  return [...phaseOptionList.querySelectorAll("[data-phase-option]")].filter(
    (option) => !option.hidden && !option.closest("[data-phase-group]")?.hidden,
  );
}

function movePhaseOptionFocus(current, direction) {
  const options = getVisiblePhaseOptions();
  if (!options.length) return;
  const currentIndex = options.indexOf(current);
  const nextIndex = (currentIndex + direction + options.length) % options.length;
  options[nextIndex].focus();
}

function choosePhase(value) {
  if (!phaseSelect || phaseSelect.value === value) {
    closeModal(phaseDialog);
    phaseTrigger?.focus();
    return;
  }
  phaseSelect.value = value;
  phaseSelect.dispatchEvent(new Event("change", { bubbles: true }));
  closeModal(phaseDialog);
  phaseTrigger?.focus();
}

function renderPhasePickerOptions() {
  if (!phaseSelect || !phaseOptionList) return;
  const fragment = document.createDocumentFragment();

  [...phaseSelect.children].forEach((child, groupIndex) => {
    const options = child.tagName === "OPTGROUP" ? [...child.querySelectorAll("option")] : [child];
    if (!options.length) return;

    const group = createElement("div", "phase-option-group");
    group.dataset.phaseGroup = "";
    group.dataset.phaseGroupText = normalize(child.label || "General");
    group.setAttribute("role", "group");
    const groupLabel = createElement("p", "phase-option-group-label", child.label || "General");
    groupLabel.id = `phase-option-group-${groupIndex + 1}`;
    group.setAttribute("aria-labelledby", groupLabel.id);
    group.append(groupLabel);

    options.forEach((sourceOption, optionIndex) => {
      const option = createElement("button", "phase-option", sourceOption.textContent);
      option.type = "button";
      option.id = `phase-option-${groupIndex + 1}-${optionIndex + 1}`;
      option.dataset.phaseOption = sourceOption.value;
      option.dataset.phaseOptionText = normalize(`${sourceOption.textContent} ${sourceOption.title || ""}`);
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(sourceOption.selected));
      option.addEventListener("click", () => choosePhase(sourceOption.value));
      option.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          movePhaseOptionFocus(option, 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          movePhaseOptionFocus(option, -1);
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          const visibleOptions = getVisiblePhaseOptions();
          visibleOptions[event.key === "Home" ? 0 : visibleOptions.length - 1]?.focus();
        } else if (event.key === "Escape") {
          event.preventDefault();
          closeModal(phaseDialog);
        }
      });
      group.append(option);
    });
    fragment.append(group);
  });

  const empty = createElement("p", "phase-option-empty", "No hay vistas que coincidan.");
  empty.dataset.phaseEmpty = "";
  empty.hidden = true;
  fragment.append(empty);
  phaseOptionList.replaceChildren(fragment);
  syncPhasePicker();
}

function filterPhasePickerOptions() {
  if (!phaseOptionList) return;
  const query = normalize(phaseOptionSearch?.value.trim() || "");
  let visibleCount = 0;
  phaseOptionList.querySelectorAll("[data-phase-group]").forEach((group) => {
    const groupMatches = group.dataset.phaseGroupText.includes(query);
    let groupVisible = 0;
    group.querySelectorAll("[data-phase-option]").forEach((option) => {
      const matches = !query || groupMatches || option.dataset.phaseOptionText.includes(query);
      option.hidden = !matches;
      if (matches) groupVisible += 1;
    });
    group.hidden = groupVisible === 0;
    visibleCount += groupVisible;
  });
  const empty = phaseOptionList.querySelector("[data-phase-empty]");
  if (empty) empty.hidden = visibleCount !== 0;
}

function positionPhaseDialog() {
  if (!phaseDialog || !phaseTrigger || window.innerWidth <= 820) return;
  const triggerRect = phaseTrigger.getBoundingClientRect();
  const width = Math.min(Math.max(triggerRect.width, 380), Math.min(480, window.innerWidth - 24));
  const left = Math.min(Math.max(12, triggerRect.left), window.innerWidth - width - 12);
  phaseDialog.style.setProperty("--phase-dialog-top", `${Math.min(triggerRect.bottom + 6, window.innerHeight - 180)}px`);
  phaseDialog.style.setProperty("--phase-dialog-left", `${left}px`);
  phaseDialog.style.setProperty("--phase-dialog-width", `${width}px`);
}

function openPhasePicker(focusSelected = false) {
  if (!phaseDialog) return;
  phaseOptionSearch.value = "";
  filterPhasePickerOptions();
  positionPhaseDialog();
  showModal(phaseDialog);
  phaseTrigger?.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    if (focusSelected) {
      phaseOptionList?.querySelector('[aria-selected="true"]')?.focus();
    } else {
      phaseOptionSearch?.focus();
    }
  });
}

function createStudyKey(scope, type, ...parts) {
  const source = normalize(parts.filter(Boolean).join("|"));
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${scope}:${type}:${(hash >>> 0).toString(36)}`;
}

function assignStaticStudyKeys() {
  topics.forEach((topic, index) => {
    const number = topic.querySelector(".topic-number")?.textContent.trim();
    topic.dataset.studyKey = `topics:topic:${number || index + 1}`;
    topic.querySelector(".topic-row > span:last-child")?.classList.add("searchable-title");
  });
  rubricItems.forEach((item, index) => {
    item.dataset.studyKey = `topics:rubric:${index + 1}`;
    item.querySelector(".topic-row > span:last-child")?.classList.add("searchable-title");
  });
}

function readStudyState() {
  try {
    const state = JSON.parse(localStorage.getItem(studyStateKey) || "null");
    return state && typeof state === "object" ? state : null;
  } catch {
    return null;
  }
}

function getVisibleStudyItems() {
  const view = currentView === "topics" ? topicView : phaseView;
  if (!view || view.hidden) return [];
  return [...view.querySelectorAll("[data-study-key]")].filter((item) => {
    const rect = item.getBoundingClientRect();
    return !item.hidden && rect.width > 0 && rect.height > 0;
  });
}

function getCurrentStudyItem() {
  const items = getVisibleStudyItems();
  if (!items.length) return null;

  const readingLine = Math.min(window.innerHeight * 0.42, 360);
  return items.find((item) => {
    const rect = item.getBoundingClientRect();
    return rect.top <= readingLine && rect.bottom > readingLine;
  }) || items.find((item) => item.getBoundingClientRect().top > readingLine) || items.at(-1);
}

function writeStudyState(preferredItem = null) {
  if (isRestoringStudyState) return;
  const item = preferredItem?.dataset.studyKey ? preferredItem : getCurrentStudyItem();
  const details = item?.querySelector(":scope > details");
  const state = {
    view: currentView,
    search: searchInput?.value || "",
    scrollY: Math.round(window.scrollY),
    anchorKey: item?.dataset.studyKey || "",
    anchorTop: item ? Math.round(item.getBoundingClientRect().top) : null,
    anchorOpen: Boolean(details?.open),
  };

  try {
    localStorage.setItem(studyStateKey, JSON.stringify(state));
  } catch {
    // The page remains usable when storage is unavailable.
  }
}

function getRestoreOffset(item, savedTop) {
  const stickyTop = Number.parseFloat(
    getComputedStyle(root).getPropertyValue("--block-sticky-offset"),
  ) || 0;
  const blockHeader = window.matchMedia("(max-width: 820px)").matches
    ? item.closest(".topic-block")?.querySelector(":scope > .block-header")
    : null;
  const minimum = stickyTop + (blockHeader?.offsetHeight || 0) + 12;
  const maximum = Math.max(minimum, Math.min(window.innerHeight * 0.42, 360));
  const preferred = Number.isFinite(savedTop) ? savedTop : minimum;
  return Math.min(maximum, Math.max(minimum, preferred));
}

function afterNextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function scrollImmediately(top) {
  const previousBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  window.scrollTo(0, Math.max(0, top));
  requestAnimationFrame(() => {
    root.style.scrollBehavior = previousBehavior;
  });
}

async function restoreStudyState() {
  const state = readStudyState();
  const hasView = state?.view && [...phaseSelect.options].some((option) => option.value === state.view);
  let restoredItem = null;

  if (hasView) {
    currentView = state.view;
    phaseSelect.value = currentView;
    searchInput.value = typeof state.search === "string" ? state.search : "";
    renderCurrentView();
    await afterNextPaint();

    const item = getVisibleStudyItems().find(
      (candidate) => candidate.dataset.studyKey === state.anchorKey,
    );
    if (item) {
      restoredItem = item;
      const details = item.querySelector(":scope > details");
      if (details && state.anchorOpen) details.open = true;
      const top = item.getBoundingClientRect().top + window.scrollY - getRestoreOffset(item, state.anchorTop);
      scrollImmediately(top);
    } else if (Number.isFinite(state.scrollY)) {
      scrollImmediately(state.scrollY);
    }
    await afterNextPaint();
  }

  isRestoringStudyState = false;
  writeStudyState(restoredItem);
}

function updateCount(visible, type = "temas") {
  if (!countOutput) return;
  const singularByType = {
    áreas: "área",
    fichas: "ficha",
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

function createIcon(paths) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "control-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  paths.forEach((pathData) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  });
  return svg;
}

function readCollapsedBlocks() {
  try {
    const value = JSON.parse(localStorage.getItem(collapsedBlocksKey) || "[]");
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedBlocks() {
  const collapsed = blocks
    .filter((block) => block.dataset.collapsed === "true")
    .map((block) => block.dataset.blockKey);
  try {
    localStorage.setItem(collapsedBlocksKey, JSON.stringify(collapsed));
  } catch {
    // Collapsing still works for the current visit.
  }
}

function updateBlockCollapseButton(block) {
  const button = block.querySelector("[data-block-collapse]");
  if (!button) return;
  const collapsed = block.dataset.collapsed === "true";
  const title = block.querySelector(".block-header h2")?.textContent || "bloque";
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute("aria-label", `${collapsed ? "Desplegar" : "Plegar"} ${title}`);
  button.title = collapsed ? "Desplegar bloque" : "Plegar bloque";
}

function applyBlockCollapseState() {
  const hasQuery = Boolean(searchInput?.value.trim());
  blocks.forEach((block) => {
    block.classList.toggle(
      "is-collapsed",
      !hasQuery && block.dataset.collapsed === "true",
    );
    updateBlockCollapseButton(block);
  });
}

function setBlockCollapsed(block, collapsed) {
  block.dataset.collapsed = String(collapsed);
  applyBlockCollapseState();
  saveCollapsedBlocks();
  scheduleReadingPositionUpdate();
}

function isRubricExpanded() {
  if (rubricExpandedSession !== null) return rubricExpandedSession;
  try {
    return localStorage.getItem(rubricExpandedKey) === "true";
  } catch {
    return false;
  }
}

function updateRubricCollapseState() {
  if (!rubricBlock || !rubricToggle) return;
  const expanded = Boolean(searchInput?.value.trim()) || isRubricExpanded();
  rubricBlock.classList.toggle("is-collapsed", !expanded);
  rubricToggle.setAttribute("aria-expanded", String(expanded));
  rubricToggle.title = expanded ? "Ocultar rúbrica" : "Mostrar rúbrica";
  const label = rubricToggle.querySelector("span");
  if (label) label.textContent = expanded ? "Ocultar criterios" : "Ver criterios";
}

function setRubricExpanded(expanded) {
  rubricExpandedSession = expanded;
  try {
    localStorage.setItem(rubricExpandedKey, String(expanded));
  } catch {
    // The control still works for the current render when storage is unavailable.
  }
  updateRubricCollapseState();
  scheduleReadingPositionUpdate();
}

async function jumpToRubric() {
  if (searchInput?.value) searchInput.value = "";
  setRubricExpanded(true);
  renderCurrentView();
  closeModal(indexDialog);
  await afterNextPaint();
  rubricBlock?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function jumpToTopicBlock(block) {
  if (searchInput?.value) {
    searchInput.value = "";
    renderCurrentView();
    writeStudyState();
  }
  setBlockCollapsed(block, false);
  closeModal(indexDialog);
  await afterNextPaint();
  block.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setupTopicNavigation() {
  if (!indexList) return;
  const collapsed = readCollapsedBlocks();
  const fragment = document.createDocumentFragment();

  if (rubricBlock) {
    const rubricIndexItem = createElement("button", "quick-index-item");
    rubricIndexItem.type = "button";
    rubricIndexItem.dataset.indexRubric = "";
    rubricIndexItem.append(
      createElement("span", "quick-index-item-label", "Criterios 2025"),
      createElement("strong", "", "Rúbrica oficial del tema escrito"),
      createElement("span", "quick-index-item-range", "10 apartados"),
    );
    rubricIndexItem.addEventListener("click", jumpToRubric);
    fragment.append(rubricIndexItem);
  }

  blocks.forEach((block, index) => {
    const header = block.querySelector(":scope > .block-header");
    const kicker = header?.querySelector(":scope > p");
    const title = header?.querySelector(":scope > h2");
    const list = block.querySelector(":scope > .topic-list");
    const blockTopics = [...block.querySelectorAll("[data-topic]")];
    if (!header || !kicker || !title || !list || !blockTopics.length) return;

    const firstNumber = getTopicKey(blockTopics[0]);
    const lastNumber = getTopicKey(blockTopics.at(-1));
    const blockKey = `block-${String(index + 1).padStart(2, "0")}`;
    block.dataset.blockKey = blockKey;
    block.dataset.collapsed = String(collapsed.has(blockKey));
    list.id = `topic-list-${index + 1}`;

    const meta = createElement("div", "block-meta");
    const position = createElement("span", "block-position");
    position.dataset.blockPosition = "";
    const collapse = createElement("button", "block-collapse");
    collapse.type = "button";
    collapse.dataset.blockCollapse = "";
    collapse.setAttribute("aria-controls", list.id);
    collapse.append(createIcon(["m6 9 6 6 6-6"]));
    collapse.addEventListener("click", () => {
      setBlockCollapsed(block, block.dataset.collapsed !== "true");
    });
    meta.append(kicker, position, collapse);
    header.prepend(meta);
    updateBlockCollapseButton(block);

    const indexItem = createElement("button", "quick-index-item");
    indexItem.type = "button";
    indexItem.dataset.indexBlock = blockKey;
    const indexLabel = createElement("span", "quick-index-item-label", kicker.textContent);
    const indexTitle = createElement("strong", "", title.textContent);
    const indexRange = createElement(
      "span",
      "quick-index-item-range",
      `Temas ${Number(firstNumber)}–${Number(lastNumber)}`,
    );
    indexItem.append(indexLabel, indexTitle, indexRange);
    indexItem.addEventListener("click", () => jumpToTopicBlock(block));
    fragment.append(indexItem);
  });

  indexList.replaceChildren(fragment);
  applyBlockCollapseState();
  updateRubricCollapseState();
}

function getReadingTopic() {
  const visibleTopics = topics.filter((topic) => {
    const rect = topic.getBoundingClientRect();
    return !topic.hidden && rect.width > 0 && rect.height > 0;
  });
  if (!visibleTopics.length) return null;
  const readingLine = Math.min(window.innerHeight * 0.42, 360);
  return visibleTopics.find((topic) => {
    const rect = topic.getBoundingClientRect();
    return rect.top <= readingLine && rect.bottom > readingLine;
  }) || visibleTopics.find((topic) => topic.getBoundingClientRect().top > readingLine) || visibleTopics.at(-1);
}

function updateReadingPosition() {
  readingPositionFrame = null;
  blocks.forEach((block) => block.querySelector(".block-header")?.classList.remove("is-current"));
  indexList?.querySelectorAll("[aria-current]").forEach((item) => item.removeAttribute("aria-current"));
  if (currentView !== "topics") return;

  const topic = getReadingTopic();
  const block = topic?.closest("[data-block]");
  if (!topic || !block) return;
  const number = Number(getTopicKey(topic));
  const header = block.querySelector(":scope > .block-header");
  const position = header?.querySelector("[data-block-position]");
  if (position) position.textContent = `Tema ${number} de ${topics.length}`;
  header?.classList.add("is-current");
  indexList?.querySelector(`[data-index-block="${block.dataset.blockKey}"]`)?.setAttribute("aria-current", "true");
}

function scheduleReadingPositionUpdate() {
  if (readingPositionFrame !== null) return;
  readingPositionFrame = requestAnimationFrame(updateReadingPosition);
}

function highlightSearchText(element, query) {
  const original = element.dataset.originalText || element.textContent || "";
  element.dataset.originalText = original;
  element.replaceChildren();
  if (!query) {
    element.textContent = original;
    return;
  }

  const normalizedText = normalize(original);
  const normalizedQuery = normalize(query);
  let cursor = 0;
  let matchIndex = normalizedText.indexOf(normalizedQuery);
  while (matchIndex >= 0) {
    element.append(document.createTextNode(original.slice(cursor, matchIndex)));
    const mark = createElement("mark", "search-highlight", original.slice(matchIndex, matchIndex + normalizedQuery.length));
    element.append(mark);
    cursor = matchIndex + normalizedQuery.length;
    matchIndex = normalizedText.indexOf(normalizedQuery, cursor);
  }
  element.append(document.createTextNode(original.slice(cursor)));
}

function applySearchHighlights() {
  const query = searchInput?.value.trim() || "";
  const view = currentView === "topics" ? topicView : phaseView;
  view?.querySelectorAll(".searchable-title").forEach((element) => {
    highlightSearchText(element, query);
  });
}

function finalizeViewRender() {
  if (searchClear) searchClear.hidden = !searchInput?.value;
  if (indexTrigger) indexTrigger.hidden = currentView !== "topics";
  syncPhasePicker();
  applySearchHighlights();
  applyBlockCollapseState();
  updateRubricCollapseState();
  scheduleReadingPositionUpdate();
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
  openLink.rel = "noopener noreferrer";

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

async function openPracticalsForTopic(topicKey) {
  const phaseId = "02_Primera_prueba_A_Practico";
  savePhaseResourceFilters(phaseId, { topic: topicKey });
  searchInput.value = "";
  currentView = phaseId;
  phaseSelect.value = phaseId;
  renderCurrentView();
  writeStudyState();
  await afterNextPaint();
  phaseView?.querySelector(".resource-filter-band")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function buildTopicPracticeControls() {
  const practicalPhase = phasesData?.phases?.find(
    (phase) => phase.id === "02_Primera_prueba_A_Practico",
  );
  if (!practicalPhase) return;

  topics.forEach((topic) => {
    topic.querySelector("[data-topic-practicals]")?.remove();
    const topicKey = getTopicKey(topic);
    const topicNumber = Number(topicKey);
    const resources = (practicalPhase.resources || []).filter(
      (resource) => (resource.relatedTopics || []).includes(topicNumber),
    );
    if (!resources.length) return;

    const exactCount = resources.filter((resource) => resource.relationBasis === "exacta").length;
    const areaCount = resources.length - exactCount;
    const solutionCount = resources.filter((resource) => resource.hasSolution).length;
    const bar = createElement("div", "topic-related");
    bar.dataset.topicPracticals = "";
    const button = createElement(
      "button",
      "topic-related-link",
      `Prácticos relacionados (${resources.length})`,
    );
    button.type = "button";
    button.title = `Abrir la Parte A con recursos relacionados con el tema ${topicKey}`;
    button.addEventListener("click", () => openPracticalsForTopic(topicKey));
    const relationParts = [];
    if (exactCount) relationParts.push(`${exactCount} específicos`);
    if (areaCount) relationParts.push(`${areaCount} del bloque`);
    if (solutionCount) relationParts.push(`${solutionCount} con solución`);
    const context = createElement(
      "span",
      "topic-related-context",
      relationParts.join(" · "),
    );
    bar.append(button, context);
    topic.append(bar);
  });
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
    buildTopicPracticeControls();
  } catch (error) {
    console.warn(error);
  }
}

function renderPhaseOptions() {
  if (!phaseSelect || !phasesData?.phases) return;
  const phaseGroups = [
    {
      label: "Actualidad y normativa",
      options: [
        ["98_Novedades_y_publicaciones", "Novedades oficiales"],
        ["00_Normativa_y_orden_legal", "Normativa y referencias"],
      ],
    },
    {
      label: "Primera prueba",
      options: [
        ["02_Primera_prueba_A_Practico", "Parte A · Prueba práctica"],
        ["97_Que_cae_mas", "Parte A · Qué cae más"],
        ["96_Practicos_soluciones_codex", "Parte A · Guías y soluciones propias"],
        ["01_Primera_prueba_B_Tema_escrito", "Parte B · Tema escrito"],
      ],
    },
    {
      label: "Segunda prueba · Aptitud pedagógica",
      options: [
        ["03_Segunda_prueba_Programacion_didactica", "Programación didáctica"],
        ["04_Segunda_prueba_Unidad_didactica", "Unidad didáctica"],
      ],
    },
    {
      label: "Después de la oposición",
      options: [
        ["05_Fase_concurso_meritos", "Concurso · Méritos"],
        ["06_Fase_practicas", "Fase de prácticas"],
      ],
    },
    {
      label: "Apoyo",
      options: [
        ["99_Transversal_Bibliografia_y_simulacros", "Bibliografía y simulacros"],
      ],
    },
  ];
  const phasesById = new Map(phasesData.phases.map((phase) => [phase.id, phase]));
  const renderedIds = new Set();

  phaseGroups.forEach((phaseGroup) => {
    const group = document.createElement("optgroup");
    group.label = phaseGroup.label;

    phaseGroup.options.forEach(([phaseId, optionLabel]) => {
      const phase = phasesById.get(phaseId);
      if (!phase) return;
      const option = createOption(phase.id, optionLabel);
      option.title = phase.title;
      group.append(option);
      renderedIds.add(phase.id);
    });

    if (group.children.length) phaseSelect.append(group);
  });

  const remainingPhases = phasesData.phases.filter((phase) => !renderedIds.has(phase.id));
  if (remainingPhases.length) {
    const otherGroup = document.createElement("optgroup");
    otherGroup.label = "Otros recursos";
    remainingPhases.forEach((phase) => otherGroup.append(createOption(phase.id, phase.title)));
    phaseSelect.append(otherGroup);
  }

  renderPhasePickerOptions();
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
      resource.displayTitle,
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
      resource.contentStatus,
      resource.publicationYear,
      ...(resource.relatedTopics || []).map((topic) => `tema ${topic}`),
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

const sourceFacetLabels = {
  "archive-private": "Archivo privado",
  "official-murcia": "Oficial Murcia",
  "official-state": "Oficial estatal",
  "private-study": "Material privado",
  "regional-guide": "Guía curricular",
};

function getPhaseResourceFilters(phaseId) {
  const stored = resourceFilters[phaseId];
  return stored && typeof stored === "object" ? stored : {};
}

function savePhaseResourceFilters(phaseId, filters) {
  const compact = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== "" && value !== null && value !== undefined),
  );
  if (Object.keys(compact).length) resourceFilters[phaseId] = compact;
  else delete resourceFilters[phaseId];
  writeStoredObject(resourceFiltersKey, resourceFilters);
}

function getResourceFacetValues(resource, key) {
  if (key === "source") return resource.sourceKind ? [resource.sourceKind] : [];
  if (key === "year") return resource.publicationYear ? [String(resource.publicationYear)] : [];
  if (key === "solution") return [resource.hasSolution ? "yes" : "no"];
  if (key === "topic") return (resource.relatedTopics || []).map((topic) => String(topic).padStart(2, "0"));
  return resource[key] ? [String(resource[key])] : [];
}

function resourceMatchesFacetFilters(resource, filters) {
  return Object.entries(filters).every(([key, selected]) => {
    if (!selected) return true;
    return getResourceFacetValues(resource, key).includes(String(selected));
  });
}

function getFacetOptionLabel(key, value) {
  if (key === "source") return sourceFacetLabels[value] || value;
  if (key === "solution") return value === "yes" ? "Con solución o corrección" : "Sin solución identificada";
  if (key === "year") return value;
  if (key === "topic") {
    const topic = materialsData?.topics?.[value];
    return topic ? `Tema ${value} · ${topic.title}` : `Tema ${value}`;
  }
  return formatSectionName(value);
}

function getFacetOptions(resources, key) {
  const values = new Set();
  resources.forEach((resource) => {
    getResourceFacetValues(resource, key).forEach((value) => values.add(value));
  });
  return [...values].sort((left, right) => {
    if (key === "year" || key === "topic") return Number(left) - Number(right);
    return getFacetOptionLabel(key, left).localeCompare(getFacetOptionLabel(key, right), "es");
  });
}

function buildResourceFilterBand(phase, allResources, visibleCount) {
  const filters = getPhaseResourceFilters(phase.id);
  const definitions = [
    { key: "area", label: "Área" },
    { key: "topic", label: "Tema relacionado" },
    { key: "academy", label: "Procedencia" },
    { key: "type", label: "Tipo" },
    { key: "source", label: "Carácter" },
    { key: "year", label: "Año" },
    { key: "solution", label: "Solución" },
  ]
    .map((definition) => ({ ...definition, options: getFacetOptions(allResources, definition.key) }))
    .filter((definition) => definition.options.length > 1 || filters[definition.key]);

  const band = createElement("section", "resource-filter-band");
  band.dataset.studyKey = `${phase.id}:filters`;
  band.setAttribute("aria-label", "Filtros de recursos");

  const heading = createElement("div", "resource-filter-heading");
  const headingCopy = createElement("div", "resource-filter-heading-copy");
  headingCopy.append(
    createElement("p", "", "Filtrar materiales"),
    createElement("span", "", `${visibleCount} de ${allResources.length}`),
  );
  const clear = createElement("button", "resource-filter-clear", "Limpiar");
  clear.type = "button";
  clear.disabled = Object.keys(filters).length === 0;
  clear.addEventListener("click", () => {
    savePhaseResourceFilters(phase.id, {});
    renderCurrentView();
    writeStudyState();
  });
  heading.append(headingCopy, clear);

  const controls = createElement("div", "resource-filter-grid");
  definitions.forEach(({ key, label, options }) => {
    const wrapper = createElement("label", "resource-filter-control");
    wrapper.append(createElement("span", "", label));
    const select = document.createElement("select");
    select.className = "resource-filter-select";
    select.dataset.resourceFilter = key;
    select.append(createOption("", `Todo · ${label.toLowerCase()}`));
    options.forEach((value) => select.append(createOption(value, getFacetOptionLabel(key, value))));
    select.value = filters[key] || "";
    select.addEventListener("change", () => {
      const next = { ...getPhaseResourceFilters(phase.id), [key]: select.value };
      savePhaseResourceFilters(phase.id, next);
      renderCurrentView();
      writeStudyState();
    });
    wrapper.append(select);
    controls.append(wrapper);
  });

  band.append(heading, controls);
  return band;
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

function getProgressStatusOptions() {
  return materialsData?.myTopicProgress?.statusOptions || [
    { value: "not-started", label: "Sin empezar" },
    { value: "draft", label: "Borrador" },
    { value: "reviewed", label: "Revisado" },
    { value: "memorizable", label: "Memorizable" },
    { value: "mock-ready", label: "Probado en simulacro" },
  ];
}

function getPersonalTopicProgress(key, topic) {
  const saved = personalProgress[key] || {};
  const initial = getProgressState(topic).myTopic?.initialStudyStatus || "not-started";
  const validStatuses = getProgressStatusOptions().map((option) => option.value);
  const hasScore = saved.score !== "" && saved.score !== null && saved.score !== undefined;
  const score = Number(saved.score);
  return {
    status: validStatuses.includes(saved.status) ? saved.status : initial,
    score: hasScore && Number.isFinite(score) ? Math.max(0, Math.min(10, score)) : null,
  };
}

function savePersonalTopicProgress(key, value) {
  personalProgress[key] = value;
  writeStoredObject(personalProgressKey, personalProgress);
}

function getProgressStatusLabel(status) {
  return getProgressStatusOptions().find((option) => option.value === status)?.label || "Sin empezar";
}

function getProgressMetrics(entries) {
  const order = getProgressStatusOptions().map((option) => option.value);
  const values = entries.map(({ key, topic }) => getPersonalTopicProgress(key, topic));
  const scores = values.map(({ score }) => score).filter((score) => score !== null);
  return {
    started: values.filter(({ status }) => status !== "not-started").length,
    reviewed: values.filter(({ status }) => order.indexOf(status) >= order.indexOf("reviewed")).length,
    mockReady: values.filter(({ status }) => status === "mock-ready").length,
    average: scores.length
      ? `${(scores.reduce((total, score) => total + score, 0) / scores.length).toFixed(1)}/10`
      : "Sin notas",
  };
}

function updateProgressOverviewStats() {
  const metrics = getProgressMetrics(getTopicEntries());
  Object.entries(metrics).forEach(([key, value]) => {
    const target = phaseView?.querySelector(`[data-progress-stat="${key}"]`);
    if (target) target.textContent = value;
  });
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
  const personal = getPersonalTopicProgress(entry.key, entry.topic);
  return normalize(
    [
      entry.key,
      entry.topic.title,
      entry.topic.block,
      state.myTopic?.progressLabel,
      state.fullExample?.label,
      state.memorySheet?.label,
      getProgressStatusLabel(personal.status),
      personal.score,
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
  const metrics = getProgressMetrics(entries);

  const block = createElement("article", "topic-block progress-overview");
  const header = createElement("header", "block-header");
  header.append(createElement("p", "", "Mi progreso"), createElement("h2", "", "Estado de mis temas"));

  const dashboard = createElement("div", "progress-dashboard");
  [
    ["Plantillas", `${templatesReady}/${total}`, "templates"],
    ["Empezados", metrics.started, "started"],
    ["Revisados", metrics.reviewed, "reviewed"],
    ["Simulacros", metrics.mockReady, "mockReady"],
    ["Nota media", metrics.average, "average"],
    ["Ejemplos", `${examplesReady} · ${memoryReady} repasos`, "examples"],
    ["Estructura", `${templateSections.length} apartados`, "structure"],
    ["Revisión", formatDate(progress.updatedAt), "revision"],
  ].forEach(([label, value, key]) => {
    const stat = createElement("span", "progress-stat");
    const strong = createElement("strong", "", value);
    strong.dataset.progressStat = key;
    stat.append(createElement("span", "progress-stat-label", label), strong);
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
    item.dataset.studyKey = `progress:template:${index + 1}`;
    const row = createElement("span", "topic-row");
    row.append(
      createElement("span", "topic-number", String(index + 1).padStart(2, "0")),
      createElement("span", "searchable-title", section.name),
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
  const personal = getPersonalTopicProgress(key, topic);
  const item = createElement("li", "topic-item progress-item");
  item.dataset.studyKey = `progress:topic:${key}`;

  const row = createElement("span", "topic-row");
  row.append(
    createElement("span", "topic-number", key),
    createElement("span", "searchable-title", topic.title),
  );

  const panel = createElement("div", "topic-materials phase-materials progress-materials");
  const meta = createElement("span", "phase-meta progress-meta");

  const chips = [];
  chips.push({
    kind: state.myTopic ? "is-done" : "is-pending",
    text: state.myTopic?.progressLabel || "Sin plantilla",
  });
  chips.push({
    kind: personal.status === "not-started" ? "is-pending" : "is-current",
    text: getProgressStatusLabel(personal.status),
    progress: true,
  });
  if (personal.score !== null) {
    chips.push({ kind: "is-current", text: `${personal.score}/10`, score: true });
  }
  if (state.fullExample) chips.push({ kind: "is-done", text: "Ejemplo completo" });
  if (state.memorySheet) chips.push({ kind: "is-done", text: "Repaso listo" });
  if (state.updatedAt) chips.push({ text: `Rev. ${formatDate(state.updatedAt)}` });

  chips.forEach(({ text, kind, progress: isProgress, score: isScore }) => {
    const chip = createElement("span", kind ? `phase-meta-chip ${kind}` : "phase-meta-chip", text);
    if (isProgress) chip.dataset.progressStatusChip = "";
    if (isScore) chip.dataset.progressScoreChip = "";
    meta.append(chip);
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
    link.rel = "noopener noreferrer";
    link.textContent = material.clickLabel || label;
    link.title = material.driveFileName || material.label || label;
    actions.append(link);
  });

  const controls = createElement("span", "progress-controls");
  const statusLabel = createElement("label", "progress-control");
  statusLabel.append(createElement("span", "", "Estado"));
  const statusSelect = document.createElement("select");
  statusSelect.className = "progress-status-select";
  statusSelect.setAttribute("aria-label", `Estado del tema ${key}`);
  getProgressStatusOptions().forEach(({ value, label }) => {
    statusSelect.append(createOption(value, label));
  });
  statusSelect.value = personal.status;
  statusLabel.append(statusSelect);

  const scoreLabel = createElement("label", "progress-control progress-score-control");
  scoreLabel.append(createElement("span", "", "Nota /10"));
  const scoreInput = document.createElement("input");
  scoreInput.className = "progress-score-input";
  scoreInput.type = "number";
  scoreInput.min = "0";
  scoreInput.max = "10";
  scoreInput.step = "0.1";
  scoreInput.inputMode = "decimal";
  scoreInput.placeholder = "—";
  scoreInput.value = personal.score ?? "";
  scoreInput.setAttribute("aria-label", `Nota personal del tema ${key} sobre 10`);
  scoreLabel.append(scoreInput);
  controls.append(statusLabel, scoreLabel);

  function persistProgress() {
    const numericScore = scoreInput.value === "" ? null : Math.max(0, Math.min(10, Number(scoreInput.value)));
    const savedScore = Number.isFinite(numericScore) ? numericScore : null;
    savePersonalTopicProgress(key, {
      status: statusSelect.value,
      score: savedScore,
    });
    const statusChip = meta.querySelector("[data-progress-status-chip]");
    if (statusChip) {
      statusChip.textContent = getProgressStatusLabel(statusSelect.value);
      statusChip.className = `phase-meta-chip ${statusSelect.value === "not-started" ? "is-pending" : "is-current"}`;
    }
    let scoreChip = meta.querySelector("[data-progress-score-chip]");
    if (savedScore === null) {
      scoreChip?.remove();
    } else {
      scoreInput.value = String(savedScore);
      if (!scoreChip) {
        scoreChip = createElement("span", "phase-meta-chip is-current");
        scoreChip.dataset.progressScoreChip = "";
        statusChip?.after(scoreChip);
      }
      scoreChip.textContent = `${savedScore}/10`;
    }
    updateProgressOverviewStats();
    writeStudyState(item);
  }

  statusSelect.addEventListener("change", persistProgress);
  scoreInput.addEventListener("change", persistProgress);

  panel.append(meta, controls, actions);
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

function formatRelatedTopics(values) {
  const topics = [...new Set((values || []).map(Number).filter(Boolean))].sort((a, b) => a - b);
  if (!topics.length) return "";
  if (topics.length === 1) return `Tema ${String(topics[0]).padStart(2, "0")}`;
  const contiguous = topics.every((topic, index) => index === 0 || topic === topics[index - 1] + 1);
  if (contiguous) {
    return `Temas ${String(topics[0]).padStart(2, "0")}–${String(topics.at(-1)).padStart(2, "0")}`;
  }
  if (topics.length <= 4) return `Temas ${topics.map((topic) => String(topic).padStart(2, "0")).join(", ")}`;
  return `${topics.length} temas relacionados`;
}

function getResourceDocumentTags(resource) {
  const rawText = [
    resource.displayTitle,
    resource.title,
    resource.section,
    resource.type,
    resource.academy,
    resource.area,
    resource.note,
    resource.sourceKind,
    resource.url,
  ].join(" ");
  const text = normalize(rawText);
  const tags = [];

  const isOfficialMurcia =
    resource.sourceKind === "official-murcia" ||
    resource.academy === "CARM/BORM" ||
    text.includes("carm.es") ||
    text.includes("borm.es") ||
    text.includes("rrhheducacion.carm.es") ||
    (text.includes("murcia") && text.includes("oficial"));
  const isOfficialOtherRegion =
    resource.officialScope === "other-ccaa" ||
    resource.sourceKind === "official-other-ccaa";
  const isOfficialState =
    resource.sourceKind === "official-state" || text.includes("boe.es");
  const isRegionalGuide = resource.sourceKind === "regional-guide";
  const isArchive = resource.sourceKind === "archive-private";
  const isPrivateStudy = resource.sourceKind === "private-study";

  if (isOfficialOtherRegion) {
    tags.push({ text: "Oficial otra CCAA", kind: "is-doc-tag is-official-other" });
  } else if (isOfficialState) {
    tags.push({ text: "Oficial estatal", kind: "is-doc-tag is-official-state" });
  } else if (isOfficialMurcia) {
    tags.push({ text: "Oficial Murcia", kind: "is-doc-tag is-official-murcia" });
  } else if (isRegionalGuide) {
    tags.push({ text: "Guía curricular", kind: "is-doc-tag is-regional-guide" });
  } else if (isArchive) {
    tags.push({ text: "Archivo", kind: "is-doc-tag is-archive" });
  } else if (isPrivateStudy) {
    tags.push({ text: "Material privado", kind: "is-doc-tag is-private" });
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

  if (!isRubric && !isPractical && !isCriteria && !isArchive && !isPrivateStudy) {
    tags.push({ text: "Referencia", kind: "is-doc-tag is-reference" });
  }

  return tags;
}

function getResourceMetaItems(resource) {
  const items = [...getResourceDocumentTags(resource)];
  const relatedTopicLabel = formatRelatedTopics(resource.relatedTopics);
  if (relatedTopicLabel) items.push({ text: relatedTopicLabel, kind: "is-related" });
  if (resource.topic && resource.topic !== "General") items.push({ text: resource.topic });
  if (resource.academy) items.push({ text: resource.academy });
  if (resource.type) items.push({ text: resource.type });
  if (resource.area) items.push({ text: resource.area });
  if (resource.officialDate) items.push({ text: resource.officialDate });
  else if (resource.publicationYear) items.push({ text: String(resource.publicationYear) });
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
  const scope = phase.analysisScope || {};

  const block = createElement("article", "topic-block trend-overview");
  const header = createElement("header", "block-header");
  header.append(createElement("p", "", phase.label), createElement("h2", "", "Lectura rápida"));

  const dashboard = createElement("div", "progress-dashboard trend-dashboard");
  [
    ["Muestra oficial", `${scope.sampleSize || totalYears} convocatorias`],
    ["Años", (scope.years || [...new Set(sources.map((source) => source.year))]).join(" · ")],
    ["Confianza", scope.confidence || "Orientativa"],
    ["Áreas críticas", trends.filter((trend) => trend.priority?.includes("Muy alta")).length],
    ["Máxima frecuencia", `${maxScore} evidencias`],
  ].forEach(([label, value]) => {
    const stat = createElement("span", "progress-stat");
    stat.append(createElement("span", "progress-stat-label", label), createElement("strong", "", value));
    dashboard.append(stat);
  });

  const note = createElement(
    "p",
    "trend-note",
    scope.note || phase.description || "Cruce de prácticos oficiales localizados.",
  );
  const body = createElement("div", "trend-overview-body");
  body.append(dashboard, note);
  block.append(header, body);
  return block;
}

function buildTrendItem(trend, index) {
  const item = createElement("li", "topic-item trend-item");
  item.dataset.studyKey = createStudyKey(currentView, "trend", trend.name);
  const row = createElement("span", "topic-row");
  row.append(
    createElement("span", "topic-number", String(index + 1).padStart(2, "0")),
    createElement("span", "searchable-title", trend.name),
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
    item.dataset.studyKey = createStudyKey(currentView, "source", source.title, source.url);
    const row = createElement("span", "topic-row");
    row.append(
      createElement("span", "topic-number", source.year || String(index + 1).padStart(2, "0")),
      createElement("span", "searchable-title", source.title),
    );

    const panel = createElement("div", "topic-materials phase-materials");
    const meta = createElement("span", "phase-meta");
    meta.append(createElement("span", "phase-meta-chip is-doc-tag is-official-murcia", "Oficial Murcia"));
    [
      { text: source.officialDate },
      { text: source.status, kind: source.statusKind ? ` is-${source.statusKind}` : "" },
      { text: source.summary || "Práctico oficial localizado" },
    ]
      .filter(({ text }) => text)
      .forEach(({ text, kind = "" }) => {
        meta.append(createElement("span", `phase-meta-chip${kind}`, text));
      });
    const link = document.createElement("a");
    link.className = "material-link";
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
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

function practiceGuideMatches(guide, query) {
  if (!query) return true;
  return normalize(
    [
      guide.name,
      guide.priority,
      guide.frequency,
      guide.whatFalls?.join(" "),
      guide.method?.join(" "),
      guide.errors?.join(" "),
      guide.example?.statement,
      guide.example?.solution,
      guide.example?.explanation,
    ].join(" "),
  ).includes(query);
}

function buildPracticeOverview(phase, guides) {
  const block = createElement("article", "topic-block practice-overview");
  const header = createElement("header", "block-header");
  header.append(createElement("p", "", phase.label), createElement("h2", "", "Cómo usar estas fichas"));

  const body = createElement("div", "practice-overview-body");
  const dashboard = createElement("div", "progress-dashboard");
  [
    ["Fichas", guides.length],
    ["Base oficial", "Murcia 2021-2025"],
    ["Autoría", phase.authorship?.createdWith || "Codex"],
    ["Carácter", "Orientativo"],
  ].forEach(([label, value]) => {
    const stat = createElement("span", "progress-stat");
    stat.append(createElement("span", "progress-stat-label", label), createElement("strong", "", value));
    dashboard.append(stat);
  });

  const notice = createElement("div", "practice-authorship");
  notice.append(
    createElement(
      "strong",
      "practice-authorship-title",
      phase.authorship?.label || "Soluciones propias realizadas con Codex",
    ),
    createElement(
      "p",
      "",
      phase.authorship?.disclaimer || "Estas soluciones no tienen carácter oficial.",
    ),
  );
  body.append(dashboard, notice);
  block.append(header, body);
  return block;
}

function buildPracticeTextSection(title, lines, className = "") {
  const section = createElement("section", className ? `practice-section ${className}` : "practice-section");
  section.append(createElement("h3", "", title));
  const content = createElement("div", "practice-lines");
  (lines || []).forEach((line, index) => {
    const row = createElement("p", "practice-line");
    row.append(
      createElement("span", "practice-line-number", String(index + 1).padStart(2, "0")),
      createElement("span", "", line),
    );
    content.append(row);
  });
  section.append(content);
  return section;
}

function buildPracticeGuide(guide, index, query) {
  const item = createElement("li", "topic-item practice-item");
  item.dataset.studyKey = createStudyKey(currentView, "guide", guide.id, guide.name);
  const details = document.createElement("details");
  details.className = "practice-guide";
  if (query) details.open = true;

  const summary = document.createElement("summary");
  summary.className = "practice-summary";
  const row = createElement("span", "topic-row");
  row.append(
    createElement("span", "topic-number", String(index + 1).padStart(2, "0")),
    createElement("span", "searchable-title", guide.name),
  );
  const meta = createElement("span", "phase-meta practice-summary-meta");
  meta.append(
    createElement("span", "phase-meta-chip is-doc-tag is-practical", guide.priority),
    createElement("span", "phase-meta-chip", guide.frequency),
    createElement("span", "phase-meta-chip is-current", "Solución Codex"),
  );
  summary.append(row, meta);

  const detail = createElement("div", "practice-detail");
  detail.append(
    buildPracticeTextSection("Qué cae", guide.whatFalls, "practice-what"),
    buildPracticeTextSection("Cómo resolverlo", guide.method, "practice-method"),
    buildPracticeTextSection("Errores típicos", guide.errors, "practice-errors"),
  );

  const example = createElement("section", "practice-section practice-example");
  example.append(createElement("h3", "", "Ejemplo resuelto"));
  example.append(createElement("p", "practice-statement", guide.example?.statement || ""));
  const solution = createElement("pre", "practice-solution");
  solution.append(createElement("code", "", guide.example?.solution || ""));
  example.append(solution, createElement("p", "practice-explanation", guide.example?.explanation || ""));

  const signature = createElement(
    "p",
    "practice-signature",
    "Solución propia realizada con Codex · No oficial",
  );
  detail.append(example, signature);
  details.append(summary, detail);
  item.append(details);
  return item;
}

function renderPracticeGuides(phase, query) {
  const allGuides = phase.practiceGuides || [];
  const guides = allGuides.filter((guide) => practiceGuideMatches(guide, query));
  const fragment = document.createDocumentFragment();
  fragment.append(buildPracticeOverview(phase, allGuides));

  const block = createElement("article", "topic-block");
  const header = createElement("header", "block-header");
  header.append(createElement("p", "", phase.label), createElement("h2", "", "Fichas por área"));
  const list = createElement("ol", "topic-list practice-list");

  if (!guides.length) {
    const item = createElement("li", "topic-item");
    const row = createElement("span", "topic-row topic-row-no-marker");
    row.append(createElement("span", "", "No hay fichas que coincidan."));
    item.append(row);
    list.append(item);
  } else {
    guides.forEach((guide, index) => list.append(buildPracticeGuide(guide, index, query)));
  }

  block.append(header, list);
  fragment.append(block);
  phaseView.replaceChildren(fragment);
  updateCount(guides.length, "fichas");
  if (emptyState) emptyState.hidden = true;
}

function buildResourceItem(resource) {
  const item = createElement("li", "topic-item");
  item.dataset.phaseResource = "";
  item.dataset.studyKey = createStudyKey(
    currentView,
    "resource",
    resource.section,
    resource.topic,
    resource.title,
    resource.url,
  );

  const marker = getResourceMarker(resource);
  const row = createElement("span", marker ? "topic-row" : "topic-row topic-row-no-marker");
  if (!marker) item.classList.add("topic-item-no-marker");
  const number = marker ? createElement("span", "topic-number phase-marker", marker) : null;
  if (number && resource.topic && resource.topic !== "General") number.title = resource.topic;
  const displayTitle = resource.displayTitle || resource.title;
  const title = createElement("span", "searchable-title", displayTitle);
  if (resource.originalTitle) title.title = `Archivo original: ${resource.originalTitle}`;
  if (number) row.append(number);
  row.append(title);

  const panel = createElement("div", "topic-materials phase-materials");
  const meta = createElement("span", "phase-meta");
  getResourceMetaItems(resource).forEach(({ text, kind }) => {
    const chip = createElement("span", kind ? `phase-meta-chip ${kind}` : "phase-meta-chip", text);
    meta.append(chip);
  });

  const openLink = document.createElement("a");
  openLink.className = "material-link";
  openLink.target = "_blank";
  openLink.rel = "noopener noreferrer";

  if (resource.hasPublicLink && resource.url) {
    openLink.href = resource.url;
    openLink.textContent = getOpenLinkText(resource);
    openLink.title = resource.originalTitle || resource.title;
    openLink.setAttribute("aria-label", `Abrir ${displayTitle}`);
  } else {
    openLink.textContent = "Pendiente";
    openLink.setAttribute("aria-disabled", "true");
  }

  panel.append(meta, openLink);
  if (resource.note && resource.sourceKind !== "archive-private") {
    panel.append(createElement("p", "phase-note", resource.note));
  }
  item.append(row, panel);
  return item;
}

function daysSince(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function buildFreshnessBand() {
  const verifiedAt = phasesData?.verifiedAt;
  const age = daysSince(verifiedAt);
  const isStale = age !== null && age > 14;
  const band = createElement("section", `freshness-band${isStale ? " is-stale" : ""}`);
  band.dataset.studyKey = "news:freshness";
  const copy = createElement("div", "freshness-copy");
  copy.append(
    createElement("p", "", isStale ? "Revisión pendiente" : "Seguimiento al día"),
    createElement(
      "strong",
      "",
      isStale
        ? `Han pasado ${age} días desde la comprobación oficial`
        : `Comprobado el ${formatDate(verifiedAt)}`,
    ),
    createElement(
      "span",
      "",
      isStale
        ? "Contrasta CARM antes de tomar decisiones sobre plazos o instancia."
        : "La web avisa automáticamente cuando esta revisión supera 14 días.",
    ),
  );
  const link = document.createElement("a");
  link.className = "material-link freshness-link";
  link.href = "https://www.carm.es/web/pagina?IDCONTENIDO=3977&IDTIPO=100&RASTRO=c798%24m";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "CARM";
  band.append(copy, link);
  return band;
}

function buildModuleContextBand() {
  const module = phasesData?.selectedModule || {};
  const band = createElement("section", "module-context-band");
  band.dataset.studyKey = "normativa:module-context";
  const header = createElement("div", "module-context-header");
  header.append(
    createElement("p", "", `Contexto ${module.planning_course || "2026/2027"}`),
    createElement("h2", "", `DAW · ${module.code || "0373"} · ${module.module || "Lenguajes de marcas"}`),
  );
  const facts = createElement("div", "module-context-facts");
  [
    ["Curso", module.course],
    ["Carga oficial", module.current_total_hours],
    ["Plan semanal", "4 h · por confirmar"],
  ].forEach(([label, value]) => {
    const fact = createElement("span", "module-context-fact");
    fact.append(createElement("span", "", label), createElement("strong", "", value));
    facts.append(fact);
  });
  const note = createElement("p", "module-context-note", module.hours_note || "");
  band.append(header, facts, note);
  return band;
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
  if (phase.practiceGuides) {
    renderPracticeGuides(phase, query);
    return;
  }

  const allResources = phase.resources || [];
  const filters = getPhaseResourceFilters(phase.id);
  const resources = allResources.filter(
    (resource) => resourceMatches(resource, query) && resourceMatchesFacetFilters(resource, filters),
  );
  const groups = groupResourcesBySection(resources);
  const fragment = document.createDocumentFragment();

  if (phase.id === "98_Novedades_y_publicaciones") fragment.append(buildFreshnessBand());
  if (phase.id === "00_Normativa_y_orden_legal") fragment.append(buildModuleContextBand());

  if (allResources.length >= 20) {
    fragment.append(buildResourceFilterBand(phase, allResources, resources.length));
  }

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

  updateTopicCount(visibleTopics, query ? visibleRubrics : 0);
  if (emptyState) emptyState.hidden = visibleTopics !== 0 || visibleRubrics !== 0;
}

function renderCurrentView() {
  if (currentView === "topics") {
    topicView.hidden = false;
    phaseView.hidden = true;
    searchInput.placeholder = "Buscar tema...";
    filterTopics();
    finalizeViewRender();
    return;
  }

  if (currentView === "progress") {
    topicView.hidden = true;
    phaseView.hidden = false;
    searchInput.placeholder = "Buscar tema...";
    renderProgressView();
    finalizeViewRender();
    return;
  }

  topicView.hidden = true;
  phaseView.hidden = false;
  const phase = getSelectedPhase();
  if (phase?.trendAreas) {
    searchInput.placeholder = "Buscar tendencia...";
  } else if (phase?.practiceGuides) {
    searchInput.placeholder = "Buscar ficha práctica...";
  } else {
    searchInput.placeholder = phase?.id === "98_Novedades_y_publicaciones"
      ? "Buscar novedad..."
      : "Buscar recurso...";
  }
  renderSelectedPhase();
  finalizeViewRender();
}

async function initializeStudyView() {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  assignStaticStudyKeys();
  setupTopicNavigation();
  renderPhasePickerOptions();
  renderCurrentView();
  await Promise.all([loadMaterials(), loadPhases()]);
  await restoreStudyState();
}

initializeStudyView();

rubricToggle?.addEventListener("click", () => {
  setRubricExpanded(rubricToggle.getAttribute("aria-expanded") !== "true");
});

phaseSelect?.addEventListener("change", () => {
  lastExplicitStudyItem = null;
  currentView = phaseSelect.value;
  renderCurrentView();
  writeStudyState();
});

phaseTrigger?.addEventListener("click", () => openPhasePicker());
phaseTrigger?.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  openPhasePicker(true);
});

phaseDialogClose?.addEventListener("click", () => closeModal(phaseDialog));
phaseDialog?.addEventListener("click", (event) => {
  if (clickedOutsideDialog(phaseDialog, event)) closeModal(phaseDialog);
});
phaseDialog?.addEventListener("close", () => {
  phaseTrigger?.setAttribute("aria-expanded", "false");
  phaseTrigger?.focus();
});

phaseOptionSearch?.addEventListener("input", filterPhasePickerOptions);
phaseOptionSearch?.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    getVisiblePhaseOptions()[0]?.focus();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeModal(phaseDialog);
  }
});

indexTrigger?.addEventListener("click", () => {
  showModal(indexDialog);
  indexTrigger.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    (indexList?.querySelector('[aria-current="true"]') || indexList?.querySelector("button"))?.focus();
  });
});
indexDialogClose?.addEventListener("click", () => closeModal(indexDialog));
indexDialog?.addEventListener("click", (event) => {
  if (clickedOutsideDialog(indexDialog, event)) closeModal(indexDialog);
});
indexDialog?.addEventListener("close", () => {
  indexTrigger?.setAttribute("aria-expanded", "false");
  indexTrigger?.focus();
});

searchInput?.addEventListener("input", () => {
  lastExplicitStudyItem = null;
  renderCurrentView();
  writeStudyState();
});

searchClear?.addEventListener("click", () => {
  searchInput.value = "";
  lastExplicitStudyItem = null;
  renderCurrentView();
  writeStudyState();
  searchInput.focus();
});

window.addEventListener("scroll", () => {
  scheduleReadingPositionUpdate();
  if (isRestoringStudyState) return;
  window.clearTimeout(scrollSaveTimer);
  scrollSaveTimer = window.setTimeout(() => writeStudyState(lastExplicitStudyItem), 140);
}, { passive: true });

window.addEventListener("resize", () => {
  scheduleReadingPositionUpdate();
  if (phaseDialog?.open) positionPhaseDialog();
});

document.addEventListener("pointerdown", (event) => {
  const item = event.target instanceof Element
    ? event.target.closest("[data-study-key]")
    : null;
  if (item) {
    lastExplicitStudyItem = item;
    writeStudyState(item);
  } else {
    lastExplicitStudyItem = null;
  }
});

window.addEventListener("wheel", () => {
  lastExplicitStudyItem = null;
}, { passive: true });

window.addEventListener("touchmove", () => {
  lastExplicitStudyItem = null;
}, { passive: true });

document.addEventListener("keydown", (event) => {
  if (["ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "].includes(event.key)) {
    lastExplicitStudyItem = null;
  }
});

document.addEventListener("toggle", (event) => {
  const item = event.target instanceof Element
    ? event.target.closest("[data-study-key]")
    : null;
  if (item) {
    lastExplicitStudyItem = item;
    writeStudyState(item);
  }
}, true);

window.addEventListener("pagehide", () => writeStudyState(lastExplicitStudyItem));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") writeStudyState(lastExplicitStudyItem);
});
