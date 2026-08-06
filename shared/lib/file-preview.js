let pdfJsLibraryPromise = null;

async function getPdfJsLibrary() {
  if (!pdfJsLibraryPromise) {
    pdfJsLibraryPromise = import("https://esm.sh/pdfjs-dist@4.10.38/build/pdf.mjs").then((module) => {
      module.GlobalWorkerOptions.workerSrc = "https://esm.sh/pdfjs-dist@4.10.38/build/pdf.worker.mjs";
      return module;
    });
  }
  return pdfJsLibraryPromise;
}

export async function renderPdfFirstPage(url, canvas) {
  const pdfjsLib = await getPdfJsLibrary();
  const loadingTask = pdfjsLib.getDocument({ url, disableFontFace: true });
  const pdf = await loadingTask.promise;
  try {
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const targetWidth = 96;
    const viewport = page.getViewport({ scale: targetWidth / baseViewport.width });
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("PDF preview canvas is unavailable.");
    await page.render({
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
      background: "white",
    }).promise;
    page.cleanup?.();
  } finally {
    await pdf.destroy?.();
  }
}
