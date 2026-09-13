import { BRAND } from "./brand-config.js";

const applyBrand = () => {
  const root = document.documentElement;
  root.style.setProperty("--brand-primary", BRAND.primary);
  root.style.setProperty("--brand-primary-dark", BRAND.primaryDark);
  root.style.setProperty("--brand-primary-soft", BRAND.primarySoft);
  root.style.setProperty("--brand-accent", BRAND.accent);
  root.style.setProperty("--brand-bg", BRAND.background);
  document.title = `${BRAND.productName} — ${BRAND.companyName}`;
  document.querySelectorAll(".brand-logo").forEach((node) => {
    node.textContent = BRAND.monogram;
    node.setAttribute("aria-label", BRAND.companyName);
  });
  document.querySelectorAll(".login-group-name").forEach(
    (node) => (node.textContent = BRAND.companyName),
  );
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyBrand, { once: true });
} else {
  applyBrand();
}
