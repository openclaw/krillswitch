const root = document.documentElement;
const search = document.querySelector("[data-search-input]");
const links = [...document.querySelectorAll("[data-search]")];
const toggle = document.querySelector("[data-theme-toggle]");
const navToggle = document.querySelector("[data-nav-toggle]");

search?.addEventListener("input", () => {
  const query = search.value.trim().toLowerCase();
  for (const link of links)
    link.hidden = Boolean(query) && !link.dataset.search.includes(query);
});

toggle?.addEventListener("click", () => {
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("ks-theme", next);
  } catch {}
});

navToggle?.addEventListener("click", () =>
  document.body.classList.toggle("nav-open"),
);
document
  .querySelector("main")
  ?.addEventListener("click", () => document.body.classList.remove("nav-open"));
