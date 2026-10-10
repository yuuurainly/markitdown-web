const PYODIDE_PACKAGES = [
  "micropip",
  "lxml",
  "pandas",
  "requests",
  "beautifulsoup4",
  "charset-normalizer",
  "pillow",
  "cryptography",
  "xlrd",
];

const PURE_WHEELS = [
  "markitdown-0.1.8-py3-none-any.whl",
];

const MAX_FILE_BYTES = 50 * 1024 * 1024;

const state = {
  ready: false,
  busy: false,
  pyodide: null,
  markdown: "",
  fileName: "",
  fileSize: 0,
};

const elements = {
  status: document.getElementById("runtimeStatus"),
  statusLabel: document.getElementById("runtimeStatusLabel"),
  dropZone: document.getElementById("dropZone"),
  fileInput: document.getElementById("fileInput"),
  chooseButton: document.getElementById("chooseButton"),
  resetButton: document.getElementById("resetButton"),
  emptyState: document.getElementById("emptyState"),
  loadingState: document.getElementById("loadingState"),
  errorState: document.getElementById("errorState"),
  errorMessage: document.getElementById("errorMessage"),
  retryButton: document.getElementById("retryButton"),
  resultView: document.getElementById("resultView"),
  resultFileName: document.getElementById("resultFileName"),
  resultFileInfo: document.getElementById("resultFileInfo"),
  copyButton: document.getElementById("copyButton"),
  downloadButton: document.getElementById("downloadButton"),
  newFileButton: document.getElementById("newFileButton"),
  previewView: document.getElementById("previewView"),
  markdownView: document.getElementById("markdownView"),
  toast: document.getElementById("toast"),
};

function setStatus(stateName, label) {
  elements.status.dataset.state = stateName;
  elements.statusLabel.textContent = label;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  const digits = index === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[index]}`;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 2400);
}

function showOnlyView(view) {
  elements.emptyState.hidden = view !== "empty";
  elements.loadingState.hidden = view !== "loading";
  elements.errorState.hidden = view !== "error";
  elements.resultView.hidden = view !== "result";
}

function setBusy(isBusy) {
  state.busy = isBusy;
  elements.chooseButton.disabled = isBusy || !state.ready;
  elements.dropZone.classList.toggle("is-disabled", isBusy || !state.ready);
  if (isBusy) {
    setStatus("busy", "正在转换");
    showOnlyView("loading");
  } else if (state.ready) {
    setStatus("ready", "转换器已就绪");
  }
}

function resetResult() {
  state.markdown = "";
  state.fileName = "";
  state.fileSize = 0;
  elements.fileInput.value = "";
  elements.markdownView.value = "";
  elements.previewView.replaceChildren();
  elements.resultView.hidden = true;
  elements.resetButton.hidden = true;
  showOnlyView("empty");
}

function showError(message) {
  elements.errorMessage.textContent = message;
  elements.resultView.hidden = true;
  elements.loadingState.hidden = true;
  elements.emptyState.hidden = true;
  elements.errorState.hidden = false;
  elements.resetButton.hidden = true;
  if (state.ready) {
    setStatus("ready", "转换器已就绪");
  }
}

function setActiveTab(view) {
  const isPreview = view === "preview";
  document.getElementById("previewTab").classList.toggle("is-active", isPreview);
  document
    .getElementById("markdownTab")
    .classList.toggle("is-active", !isPreview);
  document.getElementById("previewTab").setAttribute("aria-selected", String(isPreview));
  document
    .getElementById("markdownTab")
    .setAttribute("aria-selected", String(!isPreview));
  elements.previewView.hidden = !isPreview;
  elements.markdownView.hidden = isPreview;
}

function renderMarkdown(markdown) {
  if (window.marked && window.DOMPurify) {
    const rendered = window.marked.parse(markdown, {
      gfm: true,
      breaks: false,
    });
    elements.previewView.innerHTML = window.DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true },
    });
  } else {
    elements.previewView.textContent = markdown;
  }
  elements.markdownView.value = markdown;
}

function renderResult(markdown, elapsedMs) {
  state.markdown = markdown;
  renderMarkdown(markdown);
  const elapsed = `${(elapsedMs / 1000).toFixed(1)} 秒`;
  elements.resultFileName.textContent = state.fileName;
  elements.resultFileInfo.textContent = `${formatBytes(state.fileSize)} · ${elapsed}`;
  elements.resetButton.hidden = false;
  showOnlyView("result");
  setActiveTab("preview");
}

async function copyMarkdown() {
  if (!state.markdown) {
    return;
  }
  try {
    await navigator.clipboard.writeText(state.markdown);
    showToast("已复制 Markdown");
  } catch {
    const selection = document.createElement("textarea");
    selection.value = state.markdown;
    selection.style.position = "fixed";
    selection.style.opacity = "0";
    document.body.appendChild(selection);
    selection.select();
    document.execCommand("copy");
    selection.remove();
    showToast("已复制 Markdown");
  }
}

function downloadMarkdown() {
  if (!state.markdown) {
    return;
  }
  const baseName = state.fileName.replace(/\.[^.]+$/, "") || "converted";
  const blob = new Blob([state.markdown], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseName}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function convertFile(file) {
  if (!file) {
    return;
  }
  if (!state.ready) {
    showToast("转换器仍在准备中");
    return;
  }
  if (state.busy) {
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showError(`文件超过 ${formatBytes(MAX_FILE_BYTES)} 上限。`);
    return;
  }

  state.fileName = file.name;
  state.fileSize = file.size;
  elements.errorState.hidden = true;
  setBusy(true);
  const startedAt = performance.now();

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    state.pyodide.globals.set("_file_bytes", bytes);
    state.pyodide.globals.set("_file_name", file.name);
    const markdown = await state.pyodide.runPythonAsync(
      "convert_file(_file_bytes, _file_name)",
    );
    if (!markdown || !markdown.trim()) {
      throw new Error("没有从文件中提取到可转换的内容。");
    }
    setBusy(false);
    renderResult(markdown, performance.now() - startedAt);
  } catch (error) {
    setBusy(false);
    showError(error?.message || String(error));
  }
}

function bindEvents() {
  elements.chooseButton.addEventListener("click", () => {
    elements.fileInput.click();
  });

  elements.fileInput.addEventListener("change", () => {
    const file = elements.fileInput.files?.[0];
    if (file) {
      convertFile(file);
    }
  });

  elements.resetButton.addEventListener("click", resetResult);
  elements.newFileButton.addEventListener("click", () => {
    resetResult();
    elements.fileInput.click();
  });
  elements.retryButton.addEventListener("click", () => {
    resetResult();
    if (!state.ready) {
      window.location.reload();
    } else {
      elements.fileInput.click();
    }
  });
  elements.copyButton.addEventListener("click", copyMarkdown);
  elements.downloadButton.addEventListener("click", downloadMarkdown);

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.view);
    });
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (state.ready && !state.busy) {
        elements.dropZone.classList.add("is-dragging");
      }
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("is-dragging");
    });
  });

  elements.dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      convertFile(file);
    }
  });
}

async function initRuntime() {
  elements.chooseButton.disabled = true;
  elements.dropZone.classList.add("is-disabled");
  setStatus("loading", "正在准备转换器");

  try {
    const pyodide = await loadPyodide({
      indexURL: "./pyodide/",
      stdout: () => {},
      stderr: () => {},
    });
    await pyodide.loadPackage(PYODIDE_PACKAGES);

    const manifest = await fetch("./wheels/manifest.json").then((response) => {
      if (!response.ok) {
        throw new Error("无法读取浏览器依赖清单。");
      }
      return response.json();
    });
    const wheelNames = [...manifest, ...PURE_WHEELS];
    const wheelUrls = wheelNames.map(
      (name) => new URL(`./wheels/${name}`, window.location.href).href,
    );
    await pyodide.runPythonAsync(`
import micropip

await micropip.install(${JSON.stringify(wheelUrls)}, deps=False)
`);
    await pyodide.runPythonAsync(`
import io
import mimetypes
import sys
import types

magika = types.ModuleType("magika")

class _MagikaOutput:
    label = "unknown"
    is_text = False
    mime_type = "application/octet-stream"
    extensions = []

class _MagikaPrediction:
    output = _MagikaOutput()

class _MagikaResult:
    status = "error"
    prediction = _MagikaPrediction()

class Magika:
    def identify_stream(self, stream):
        return _MagikaResult()

magika.Magika = Magika
sys.modules["magika"] = magika

pdfplumber = types.ModuleType("pdfplumber")

def _disabled_pdfplumber(*args, **kwargs):
    raise RuntimeError("pdfplumber is disabled in the browser build")

pdfplumber.open = _disabled_pdfplumber
sys.modules["pdfplumber"] = pdfplumber

from markitdown import MarkItDown
from markitdown._stream_info import StreamInfo

_converter = MarkItDown()

def convert_file(data, filename):
    if hasattr(data, "to_py"):
        raw = bytes(data.to_py())
    else:
        raw = bytes(data)

    mimetype, _ = mimetypes.guess_type(filename)
    extension = None
    if "." in filename:
        extension = "." + filename.rsplit(".", 1)[-1].lower()

    result = _converter.convert_stream(
        io.BytesIO(raw),
        stream_info=StreamInfo(
            extension=extension,
            mimetype=mimetype,
            filename=filename,
        ),
    )
    return result.markdown or ""
`);

    state.pyodide = pyodide;
    state.ready = true;
    elements.chooseButton.disabled = false;
    elements.dropZone.classList.remove("is-disabled");
    setStatus("ready", "转换器已就绪");
  } catch (error) {
    setStatus("error", "转换器加载失败");
    showError(error?.message || String(error));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  resetResult();
  initRuntime();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
