(() => {
  const root = document.documentElement,
    member = root.dataset.member === "yes",
    system = matchMedia("(prefers-color-scheme: dark)");
  let preference = root.dataset.serverTheme || "system";
  if (!member) {
    try {
      preference = localStorage.getItem("ataberk-theme") || preference;
    } catch {}
  }
  if (!["light", "dark", "system"].includes(preference)) preference = "system";
  function apply() {
    root.dataset.theme =
      preference === "system"
        ? system.matches
          ? "dark"
          : "light"
        : preference;
    const button = document.querySelector(".theme-toggle");
    if (button) {
      button.setAttribute(
        "aria-label",
        root.dataset.theme === "dark" ? "Açık görünümü aç" : "Koyu görünümü aç",
      );
      button.textContent = root.dataset.theme === "dark" ? "☀" : "◐";
    }
  }
  apply();
  system.addEventListener("change", () => {
    if (preference === "system") apply();
  });
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    document
      .querySelector(".theme-toggle")
      ?.addEventListener("click", async () => {
        const value = root.dataset.theme === "dark" ? "light" : "dark";
        if (member) {
          try {
            const r = await fetch("/api/tema", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-csrf-token":
                  document.querySelector("[name=csrf-token]").content,
              },
              body: JSON.stringify({ theme: value }),
            });
            if (!r.ok) throw Error();
          } catch {
            document.querySelector(".theme-toggle").title =
              "Görünüm kaydedilemedi. Tekrar deneyin.";
            return;
          }
        } else {
          try {
            localStorage.setItem("ataberk-theme", value);
          } catch {}
        }
        preference = value;
        apply();
      });
  });
})();
