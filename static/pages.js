// Botón "Reportar enlace" de las páginas de vista previa y de error (sin JS en línea por la CSP).
document.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("[data-report]");
  if (!btn) return;
  const reason = window.prompt("¿Por qué reportas este enlace? (opcional)") ?? null;
  if (reason === null) return;
  btn.disabled = true;
  try {
    const r = await fetch("/api/v1/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: btn.dataset.report, reason }),
    });
    btn.textContent = r.ok ? "Gracias, lo revisaremos" : "No se pudo enviar el reporte";
  } catch {
    btn.textContent = "No se pudo enviar el reporte";
  }
});
