const root = document.documentElement;
const themeToggle = document.querySelector("[data-theme-toggle]");
const searchInput = document.querySelector("[data-search]");
const countOutput = document.querySelector("[data-count]");
const emptyState = document.querySelector("[data-empty]");
const blocks = [...document.querySelectorAll("[data-block]")];
const topics = [...document.querySelectorAll("[data-topic]")];
const materialsUrl = "data/materials.json";

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
  countOutput.textContent = visible === 1 ? "1 tema" : `${visible} temas`;
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

setTheme(root.dataset.theme || "dark");
updateCount(topics.length);
loadMaterials();

themeToggle?.addEventListener("click", () => {
  const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
  setTheme(nextTheme);
});

searchInput?.addEventListener("input", filterTopics);
