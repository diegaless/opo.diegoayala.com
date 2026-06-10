const root = document.documentElement;
const themeToggle = document.querySelector("[data-theme-toggle]");
const toast = document.querySelector("[data-toast]");
const searchInput = document.querySelector("[data-search]");
const countOutput = document.querySelector("[data-count]");
const emptyState = document.querySelector("[data-empty]");
const blocks = [...document.querySelectorAll("[data-block]")];
const topics = [...document.querySelectorAll("[data-topic]")];
let toastTimer;

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

function showToast(message) {
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2400);
}

setTheme(root.dataset.theme || "dark");
updateCount(topics.length);

themeToggle?.addEventListener("click", () => {
  const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
  setTheme(nextTheme);
});

searchInput?.addEventListener("input", filterTopics);

document.querySelectorAll("[data-pending]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    showToast("Tema pendiente de enlazar.");
  });
});

