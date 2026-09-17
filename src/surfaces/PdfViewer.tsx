import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  RotateCcw,
} from "../chrome/icons";
import { basename, readBinaryFile } from "../lib/fs";
import { watchFile } from "../lib/fileWatch";
import "./PdfViewer.css";

GlobalWorkerOptions.workerSrc = workerUrl;

type LoadState =
  | { status: "loading" }
  | { status: "ready"; path: string; document: PDFDocumentProxy }
  | { status: "error"; message: string };

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const clampZoom = (value: number) => Math.min(4, Math.max(0.25, value));

/** Local bytes stay in the app; document actions and scripts are never executed. */
export default function PdfViewer({
  path,
  active,
}: {
  path: string;
  active: boolean;
}) {
  const [revision, setRevision] = useState(0);
  const [request, setRequest] = useState<{
    path: string;
    revision: number;
  } | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const renderedScale = useRef(1);

  // Unvisited/restored hidden tabs do not read or parse their documents.
  useEffect(() => {
    if (active)
      setRequest((previous) =>
        previous?.path === path && previous.revision === revision
          ? previous
          : { path, revision },
      );
  }, [active, path, revision]);

  useEffect(() => {
    setPage(1);
    setZoom("fit");
  }, [path]);

  useEffect(() => {
    if (!request) return;
    let disposed = false;
    let loading: PDFDocumentLoadingTask | undefined;
    setState({ status: "loading" });
    setRenderError(null);
    void (async () => {
      const bytes = await readBinaryFile(request.path);
      if (disposed) return;
      const assets = new URL("pdfjs/", document.baseURI).href;
      loading = getDocument({
        data: bytes,
        cMapUrl: `${assets}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assets}standard_fonts/`,
        wasmUrl: `${assets}wasm/`,
        iccUrl: `${assets}iccs/`,
        useWasm: false,
        // The low-level canvas API doesn't load PDF.js's scripting sandbox.
        enableXfa: false,
        maxImageSize: 32 * 1024 * 1024,
      });
      const pdf = await loading.promise;
      if (disposed) return;
      setPage((current) => Math.min(current, pdf.numPages));
      setState({ status: "ready", path: request.path, document: pdf });
    })().catch((error: unknown) => {
      if (!disposed) setState({ status: "error", message: message(error) });
    });
    return () => {
      disposed = true;
      void loading?.destroy().catch(() => {});
    };
  }, [request]);

  useEffect(() => {
    let timer = 0;
    const stop = watchFile(path, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setRevision((value) => value + 1), 100);
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [path]);

  useEffect(() => {
    if (!active || !viewport.current) return;
    const host = viewport.current;
    const measure = () => {
      const next = { width: host.clientWidth, height: host.clientHeight };
      setArea((previous) =>
        previous.width === next.width && previous.height === next.height
          ? previous
          : next,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    measure();
    return () => observer.disconnect();
  }, [active, state.status]);

  useEffect(() => {
    if (
      !active ||
      state.status !== "ready" ||
      state.path !== path ||
      !canvasHost.current ||
      area.width <= 0 ||
      area.height <= 0
    )
      return;
    let disposed = false;
    let render: RenderTask | undefined;
    const host = canvasHost.current;
    setRendering(true);
    setRenderError(null);
    void (async () => {
      const pdfPage = await state.document.getPage(page);
      if (disposed) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      const scale =
        zoom === "fit"
          ? Math.max(
              0.05,
              Math.min(
                (area.width - 32) / natural.width,
                (area.height - 32) / natural.height,
              ),
            )
          : zoom;
      renderedScale.current = scale;
      const size = pdfPage.getViewport({ scale });
      const density = Math.min(
        window.devicePixelRatio || 1,
        2,
        8192 / size.width,
        8192 / size.height,
        Math.sqrt((16 * 1024 * 1024) / (size.width * size.height)),
      );
      // Each render owns a fresh canvas, so cancellation cannot overwrite a newer page.
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(size.width * density));
      canvas.height = Math.max(1, Math.floor(size.height * density));
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
      canvas.setAttribute("role", "img");
      canvas.setAttribute(
        "aria-label",
        `Page ${page} of ${state.document.numPages}`,
      );
      render = pdfPage.render({
        canvas,
        viewport: size,
        transform: [density, 0, 0, density, 0, 0],
      });
      await render.promise;
      if (!disposed) {
        host.replaceChildren(canvas);
        setRendering(false);
      }
    })().catch((error: unknown) => {
      if (!disposed) {
        setRenderError(message(error));
        setRendering(false);
      }
    });
    return () => {
      disposed = true;
      render?.cancel();
    };
  }, [active, state, path, page, zoom, area]);

  const reload = () => setRevision((value) => value + 1);
  if (
    state.status === "loading" ||
    (state.status === "ready" && state.path !== path)
  )
    return (
      <div role="status" className="pdf-viewer-message">
        Opening {basename(path)}…
      </div>
    );
  if (state.status === "error")
    return (
      <div className="pdf-viewer-message" role="alert">
        <AlertCircle size={20} />
        <strong>Could not open PDF</strong>
        <p>{state.message}</p>
        <button onClick={reload}>Retry</button>
      </div>
    );

  return (
    <section
      className="pdf-viewer"
      aria-label={`PDF viewer: ${basename(path)}`}
    >
      <div
        className="pdf-viewer-toolbar"
        role="toolbar"
        aria-label="PDF controls"
      >
        <button
          aria-label="Previous PDF page"
          disabled={page <= 1}
          onClick={() => setPage((value) => value - 1)}
        >
          <ChevronLeft size={15} />
        </button>
        <span className="pdf-viewer-page-count">
          Page {page} of {state.document.numPages}
        </span>
        <button
          aria-label="Next PDF page"
          disabled={page >= state.document.numPages}
          onClick={() => setPage((value) => value + 1)}
        >
          <ChevronRight size={15} />
        </button>
        <span className="pdf-viewer-toolbar-spacer" />
        <button
          aria-label="Zoom out PDF"
          onClick={() =>
            setZoom(
              clampZoom((zoom === "fit" ? renderedScale.current : zoom) / 1.2),
            )
          }
        >
          <Minus size={14} />
        </button>
        <button
          className="pdf-viewer-fit"
          aria-label="Fit PDF page"
          title="Fit page"
          onClick={() => setZoom("fit")}
        >
          {zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}
        </button>
        <button
          aria-label="Zoom in PDF"
          onClick={() =>
            setZoom(
              clampZoom((zoom === "fit" ? renderedScale.current : zoom) * 1.2),
            )
          }
        >
          <Plus size={14} />
        </button>
        <button aria-label="Reload PDF" onClick={reload}>
          <RotateCcw size={14} />
        </button>
      </div>
      {renderError ? (
        <div className="pdf-viewer-render-error" role="alert">
          {renderError} <button onClick={reload}>Retry</button>
        </div>
      ) : null}
      <div ref={viewport} className="pdf-viewer-viewport" aria-busy={rendering}>
        <div ref={canvasHost} className="pdf-viewer-canvas" />
      </div>
    </section>
  );
}
