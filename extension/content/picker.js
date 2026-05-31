/**
 * Element picker: overlay, selector generation, activation lifecycle.
 */
(() => {
  const { extractValueFromElement } = PAGE_MONITOR_DOM;
  const { MSG } = PAGE_MONITOR_CONSTANTS;

  let pickerActive = false;
  let overlay = null;
  let selectorLabel = null;
  let hoveredElement = null;
  let pickerBanner = null;

  function buildRelativePath(ancestor, el) {
    if (!ancestor || !el || !ancestor.contains(el)) return null;
    if (ancestor === el) return "";

    const parts = [];
    let current = el;
    while (current && current !== ancestor) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) return null;

      const siblings = Array.from(parent.children).filter(
        (s) => s.tagName === current.tagName
      );

      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        parts.unshift(`${tag}:nth-of-type(${idx})`);
      } else {
        parts.unshift(tag);
      }

      current = parent;
    }

    return parts.join(" > ");
  }

  function getUniqueClassSelector(node) {
    if (!node || node.classList.length === 0) return null;

    for (const cls of node.classList) {
      const sel = `.${CSS.escape(cls)}`;
      if (document.querySelectorAll(sel).length === 1) {
        return sel;
      }
    }

    const fullClass = Array.from(node.classList)
      .map((c) => `.${CSS.escape(c)}`)
      .join("");
    if (fullClass && document.querySelectorAll(fullClass).length === 1) {
      return fullClass;
    }

    return null;
  }

  function findAnchorById(el) {
    let current = el.parentElement;
    while (current && current !== document.documentElement) {
      if (current.id) return current;
      current = current.parentElement;
    }
    return null;
  }

  function findAnchorByClass(el) {
    let current = el.parentElement;
    while (current && current !== document.documentElement) {
      if (getUniqueClassSelector(current)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function generateSelector(el) {
    if (el.id) {
      return `#${CSS.escape(el.id)}`;
    }

    const ownClassSelector = getUniqueClassSelector(el);
    if (ownClassSelector) return ownClassSelector;

    const idAnchor = findAnchorById(el);
    if (idAnchor) {
      const path = buildRelativePath(idAnchor, el);
      if (path) return `#${CSS.escape(idAnchor.id)} > ${path}`;
      return `#${CSS.escape(idAnchor.id)}`;
    }

    const classAnchor = findAnchorByClass(el);
    if (classAnchor) {
      const anchorSel = getUniqueClassSelector(classAnchor);
      const path = buildRelativePath(classAnchor, el);
      if (anchorSel && path) return `${anchorSel} > ${path}`;
      if (anchorSel) return anchorSel;
    }

    return null;
  }

  function createOverlay() {
    overlay = document.createElement("div");
    overlay.id = "__pcm-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      pointerEvents: "none",
      border: "2px solid #6366f1",
      backgroundColor: "rgba(99, 102, 241, 0.12)",
      borderRadius: "4px",
      zIndex: "2147483646",
      transition: "all 0.15s ease",
      display: "none",
    });
    document.body.appendChild(overlay);

    selectorLabel = document.createElement("div");
    selectorLabel.id = "__pcm-label";
    Object.assign(selectorLabel.style, {
      position: "fixed",
      pointerEvents: "none",
      backgroundColor: "#6366f1",
      color: "#fff",
      padding: "3px 8px",
      borderRadius: "4px",
      fontSize: "11px",
      fontFamily: "'Inter', system-ui, sans-serif",
      fontWeight: "600",
      zIndex: "2147483647",
      display: "none",
      maxWidth: "400px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
    });
    document.body.appendChild(selectorLabel);
  }

  function updateOverlay(el) {
    if (!overlay || !selectorLabel) return;
    const rect = el.getBoundingClientRect();
    Object.assign(overlay.style, {
      top: rect.top + "px",
      left: rect.left + "px",
      width: rect.width + "px",
      height: rect.height + "px",
      display: "block",
    });
    selectorLabel.textContent = generateSelector(el);
    Object.assign(selectorLabel.style, {
      top: Math.max(0, rect.top - 26) + "px",
      left: rect.left + "px",
      display: "block",
    });
  }

  function hideOverlay() {
    if (overlay) overlay.style.display = "none";
    if (selectorLabel) selectorLabel.style.display = "none";
  }

  function destroyOverlay() {
    overlay?.remove();
    selectorLabel?.remove();
    overlay = null;
    selectorLabel = null;
  }

  function ensurePickerStyles() {
    if (document.getElementById("__pcm-styles")) return;
    const style = document.createElement("style");
    style.id = "__pcm-styles";
    style.textContent = `
      @keyframes __pcm-slideDown {
        from { opacity:0; transform: translateX(-50%) translateY(-20px); }
        to   { opacity:1; transform: translateX(-50%) translateY(0); }
      }
      @keyframes __pcm-fadeIn {
        from { opacity:0; transform: translateY(20px); }
        to   { opacity:1; transform: translateY(0); }
      }
      @keyframes __pcm-progress {
        from { width: 100%; }
        to   { width: 0%; }
      }
    `;
    document.head.appendChild(style);
  }

  function showPickerBanner() {
    pickerBanner = document.createElement("div");
    pickerBanner.id = "__pcm-banner";
    pickerBanner.innerHTML = `
      <span style="margin-right:8px">🎯</span>
      <span><strong>Page Monitor</strong> — Click any element to monitor it. Press <kbd style="
        background:#374151;padding:2px 6px;border-radius:3px;font-size:11px;
        border:1px solid #4b5563;font-family:monospace
      ">Esc</kbd> to cancel.</span>
    `;
    Object.assign(pickerBanner.style, {
      position: "fixed",
      top: "12px",
      left: "50%",
      transform: "translateX(-50%)",
      backgroundColor: "#1e1b4b",
      color: "#e0e7ff",
      padding: "10px 20px",
      borderRadius: "10px",
      fontSize: "13px",
      fontFamily: "'Inter', system-ui, sans-serif",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      boxShadow: "0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.3)",
      animation: "__pcm-slideDown 0.3s ease",
      pointerEvents: "none",
    });
    document.body.appendChild(pickerBanner);
    ensurePickerStyles();
  }

  function removePickerBanner() {
    pickerBanner?.remove();
    pickerBanner = null;
  }

  function onMouseMove(e) {
    if (!pickerActive) return;
    const target = e.target;
    if (
      target === overlay ||
      target === selectorLabel ||
      target.id?.startsWith("__pcm")
    ) {
      return;
    }
    hoveredElement = target;
    updateOverlay(target);
  }

  function onMouseClick(e) {
    if (!pickerActive) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const el = hoveredElement;
    if (!el) return;

    const selector = generateSelector(el);
    const value = extractValueFromElement(el);

    chrome.runtime.sendMessage({
      type: MSG.ELEMENT_PICKED,
      payload: {
        selector,
        value,
        url: window.location.href,
        pageTitle: document.title,
      },
    });

    deactivatePicker();
  }

  function onKeyDown(e) {
    if (!pickerActive) return;
    if (e.key === "Escape") {
      e.preventDefault();
      deactivatePicker();
    }
  }

  function activatePicker() {
    if (pickerActive) return;
    pickerActive = true;
    createOverlay();
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onMouseClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.body.style.cursor = "crosshair";
    showPickerBanner();
  }

  function deactivatePicker() {
    if (!pickerActive) return;
    pickerActive = false;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onMouseClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.body.style.cursor = "";
    hideOverlay();
    destroyOverlay();
    hoveredElement = null;
    removePickerBanner();
  }

  globalThis.PageMonitorPicker = {
    activatePicker,
    deactivatePicker,
  };
})();
