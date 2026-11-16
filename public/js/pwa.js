(() => {
  if ("serviceWorker" in navigator)
    window.addEventListener("load", () =>
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {}),
    );
  let prompt;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    prompt = e;
    const button = document.getElementById("install-app");
    if (button) button.hidden = false;
  });
  document.addEventListener("DOMContentLoaded", () =>
    document
      .getElementById("install-app")
      ?.addEventListener("click", async () => {
        if (!prompt) return;
        await prompt.prompt();
        await prompt.userChoice;
        prompt = null;
        document.getElementById("install-app").hidden = true;
      }),
  );
})();
