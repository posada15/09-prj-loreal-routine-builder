/* ============================================================
   L'Oréal Smart Routine & Product Advisor
   ============================================================ */

/* —— Config —— */
const WORKER_URL = "https://lorealworker.posada15.workers.dev";
const STORAGE_KEY = "loreal-selected-products";

const SYSTEM_PROMPT = `You are L'Oréal's personal beauty advisor. You help users build
skincare, haircare, makeup, fragrance, and grooming routines using the products they
have selected. You may also answer general questions about those categories.
When the user asks about current product information, reviews, launches, or ingredient
news, use your web search tool to find accurate, up-to-date information and cite the
sources. Keep answers warm, concise, and structured. If the user asks something outside
beauty or their selected routine, gently steer back to beauty topics.`;

/* —— DOM refs —— */
const categoryFilter    = document.getElementById("categoryFilter");
const productSearch     = document.getElementById("productSearch");
const productsContainer = document.getElementById("productsContainer");
const chatForm          = document.getElementById("chatForm");
const chatWindow        = document.getElementById("chatWindow");
const userInput         = document.getElementById("userInput");
const sendBtn           = document.getElementById("sendBtn");
const selectedList      = document.getElementById("selectedProductsList");
const generateBtn       = document.getElementById("generateRoutine");
const clearAllBtn       = document.getElementById("clearAllBtn");
const langToggle        = document.getElementById("langToggle");

/* —— State —— */
let allProducts = [];
let selectedIds = new Set();          // Set<string>
let conversationHistory = [];         // [{ role, content }]
let isBusy = false;

/* ============================================================
   Boot
   ============================================================ */
(async function init() {
  productsContainer.innerHTML =
    `<div class="placeholder-message">Loading products…</div>`;

  try {
    allProducts = await loadProducts();
  } catch (err) {
    productsContainer.innerHTML =
      `<div class="placeholder-message">Sorry, products couldn't be loaded.</div>`;
    console.error(err);
    return;
  }

  selectedIds = loadSelectedFromStorage();
  renderProducts();
  renderSelected();
  bindEvents();
})();

/* ============================================================
   Data
   ============================================================ */
async function loadProducts() {
  const response = await fetch("products.json");
  if (!response.ok) throw new Error(`products.json ${response.status}`);
  const data = await response.json();
  /* FIX #1 — Normalize numeric IDs to strings so they match
     card.dataset.id and localStorage values. */
  return data.products.map((p) => ({ ...p, id: String(p.id) }));
}

function getVisibleProducts() {
  const category = categoryFilter.value;
  const query = productSearch.value.trim().toLowerCase();

  return allProducts.filter((p) => {
    const matchesCategory = category === "all" || p.category === category;
    const matchesQuery =
      !query ||
      p.name.toLowerCase().includes(query) ||
      p.brand.toLowerCase().includes(query) ||
      p.description.toLowerCase().includes(query) ||
      p.category.toLowerCase().includes(query);
    return matchesCategory && matchesQuery;
  });
}

/* ============================================================
   Rendering — products
   ============================================================ */
function renderProducts() {
  const products = getVisibleProducts();

  if (products.length === 0) {
    productsContainer.innerHTML =
      `<div class="placeholder-message">
        No products match your search. Try a different keyword or category.
      </div>`;
    return;
  }

  productsContainer.innerHTML = products
    .map((product) => {
      const isSelected = selectedIds.has(product.id);
      return `
      <div
        class="product-card${isSelected ? " selected" : ""}"
        data-id="${escapeHtml(product.id)}"
        role="button"
        tabindex="0"
        aria-pressed="${isSelected}"
        aria-label="${escapeHtml(product.name)} — click to ${
          isSelected ? "remove from" : "add to"
        } selection"
      >
        <span class="select-badge" aria-hidden="true">
          <i class="fa-solid fa-check"></i>
        </span>
        <img src="${escapeHtml(product.image)}" alt="" loading="lazy" />
        <div class="product-info">
          <span class="product-category">${escapeHtml(product.category)}</span>
          <h3>${escapeHtml(product.name)}</h3>
          <p class="product-brand">${escapeHtml(product.brand)}</p>
          <button
            type="button"
            class="desc-toggle"
            aria-expanded="false"
            data-desc-toggle="${escapeHtml(product.id)}"
          >
            <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
            Description
          </button>
          <div class="product-desc" id="desc-${escapeHtml(product.id)}">
            ${escapeHtml(product.description)}
          </div>
        </div>
      </div>`;
    })
    .join("");
}

/* ============================================================
   Rendering — selected
   ============================================================ */
function renderSelected() {
  const items = allProducts.filter((p) => selectedIds.has(p.id));

  if (items.length === 0) {
    selectedList.innerHTML = "";
    generateBtn.disabled = true;
    clearAllBtn.hidden = true;
    return;
  }

  selectedList.innerHTML = items
    .map(
      (p) => `
      <div class="selected-chip">
        <span>${escapeHtml(p.name)}</span>
        <button
          type="button"
          class="chip-remove"
          data-remove="${escapeHtml(p.id)}"
          aria-label="Remove ${escapeHtml(p.name)}"
        >
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>`
    )
    .join("");

  generateBtn.disabled = false;
  clearAllBtn.hidden = false;
}

/* ============================================================
   Events
   ============================================================ */
function bindEvents() {
  categoryFilter.addEventListener("change", renderProducts);
  productSearch.addEventListener("input", debounce(renderProducts, 150));

  productsContainer.addEventListener("click", (e) => {
    const toggleBtn = e.target.closest("[data-desc-toggle]");
    if (toggleBtn) {
      e.stopPropagation();
      toggleDescription(toggleBtn);
      return;
    }
    const card = e.target.closest(".product-card");
    if (card) toggleProductSelection(card);
  });

  productsContainer.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const card = e.target.closest(".product-card");
      if (card && !e.target.closest("button")) {
        e.preventDefault();
        toggleProductSelection(card);
      }
    }
  });

  selectedList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    const id = String(btn.dataset.remove);
    selectedIds.delete(id);
    persist();
    renderSelected();
    updateCardSelectedState(id, false);
  });

  clearAllBtn.addEventListener("click", () => {
    selectedIds.clear();
    persist();
    renderSelected();
    document
      .querySelectorAll(".product-card.selected")
      .forEach((c) => updateCardSelectedState(c.dataset.id, false));
  });

  generateBtn.addEventListener("click", handleGenerateRoutine);
  chatForm.addEventListener("submit", handleChatSubmit);
  langToggle.addEventListener("click", toggleDirection);
}

/* ============================================================
   Selection
   ============================================================ */
function toggleProductSelection(card) {
  const id = String(card.dataset.id);
  const isSelected = selectedIds.has(id);

  if (isSelected) selectedIds.delete(id);
  else selectedIds.add(id);

  updateCardSelectedState(id, !isSelected);
  persist();
  renderSelected();
}

/* FIX #3 — Direct dataset.id comparison (no CSS.escape needed) */
function updateCardSelectedState(id, selected) {
  const targetId = String(id);
  const card = [...productsContainer.querySelectorAll(".product-card")]
    .find((c) => c.dataset.id === targetId);
  if (!card) return;
  card.classList.toggle("selected", selected);
  card.setAttribute("aria-pressed", selected ? "true" : "false");
}

function toggleDescription(btn) {
  const card = btn.closest(".product-card");
  const isOpen = card.classList.toggle("expanded");
  btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  btn.innerHTML = isOpen
    ? `<i class="fa-solid fa-circle-info" aria-hidden="true"></i> Hide`
    : `<i class="fa-solid fa-circle-info" aria-hidden="true"></i> Description`;
}

/* ============================================================
   Persistence
   ============================================================ */
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...selectedIds]));
  } catch (e) {
    /* localStorage may be unavailable */
  }
}

/* FIX #2 — Coerce every stored ID to a string so legacy numeric
   entries from earlier sessions still match. */
function loadSelectedFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(
      arr.filter((id) => id != null).map((id) => String(id))
    );
  } catch (e) {
    return new Set();
  }
}

/* ============================================================
   Generate routine
   ============================================================ */
async function handleGenerateRoutine() {
  if (isBusy) return;

  const selected = allProducts.filter((p) => selectedIds.has(p.id));
  if (selected.length === 0) {
    appendAssistantMessage(
      "Please select at least one product first so I can build your routine."
    );
    return;
  }

  const productPayload = selected.map((p) => ({
    name: p.name,
    brand: p.brand,
    category: p.category,
    description: p.description,
  }));

  const userMessage =
    "Create a personalized beauty routine using ONLY these products. " +
    "Organize it into morning and evening (if applicable), explain the role " +
    "of each product in the routine, and note any ordering or usage tips. " +
    "Selected products:\n" +
    JSON.stringify(productPayload, null, 2);

  appendUserMessage("✨ Generate my routine with the selected products.");
  conversationHistory.push({ role: "user", content: userMessage });

  await callAdvisorAndRender();
}

/* ============================================================
   Chat submit
   ============================================================ */
async function handleChatSubmit(e) {
  e.preventDefault();
  if (isBusy) return;

  const text = userInput.value.trim();
  if (!text) return;

  userInput.value = "";
  appendUserMessage(text);
  conversationHistory.push({ role: "user", content: text });

  await callAdvisorAndRender();
}

/* ============================================================
   Worker call
   ============================================================ */
async function callAdvisorAndRender() {
  isBusy = true;
  generateBtn.disabled = true;
  sendBtn.disabled = true;
  userInput.disabled = true;

  const loadingEl = appendLoadingMessage();

  try {
    const { text, citations } = await callWorker(conversationHistory);

    conversationHistory.push({ role: "assistant", content: text });
    loadingEl.remove();
    appendAssistantMessage(text, citations);
  } catch (err) {
    console.error(err);
    loadingEl.remove();
    appendAssistantMessage(
      "Sorry — I had trouble reaching the advisor. Please try again in a moment."
    );
  } finally {
    isBusy = false;
    generateBtn.disabled = selectedIds.size === 0;
    sendBtn.disabled = false;
    userInput.disabled = false;
    userInput.focus();
  }
}

async function callWorker(messages) {
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    }),
  });

  if (!res.ok) throw new Error(`Worker responded ${res.status}`);

  const data = await res.json();

  /* 1) Preferred contract from our Worker */
  if (typeof data.text === "string") {
    return { text: data.text, citations: normalizeCitations(data.citations) };
  }

  /* 2) Raw OpenAI Responses API shape */
  if (Array.isArray(data.output)) {
    const msg = data.output.find((o) => o.type === "message");
    const part = msg?.content?.find((c) => c.type === "output_text");
    return {
      text: part?.text || "No response received.",
      citations: normalizeCitations(part?.annotations),
    };
  }

  /* 3) Chat Completions shape */
  if (data.choices?.[0]?.message?.content) {
    return {
      text: data.choices[0].message.content,
      citations: normalizeCitations(data.choices[0].message.annotations),
    };
  }

  /* 4) Plain text */
  if (typeof data === "string") {
    return { text: data, citations: [] };
  }

  return {
    text: "Sorry, I couldn't generate a response right now.",
    citations: [],
  };
}

function normalizeCitations(annotations) {
  if (!Array.isArray(annotations)) return [];
  return annotations
    .filter((a) => a && a.url)
    .map((a) => ({ url: a.url, title: a.title || a.url }));
}

/* ============================================================
   Chat rendering
   ============================================================ */
function appendUserMessage(text) {
  const el = document.createElement("div");
  el.className = "chat-message user";
  el.textContent = text;
  chatWindow.appendChild(el);
  scrollChatToBottom();
}

function appendAssistantMessage(text, citations = []) {
  const el = document.createElement("div");
  el.className = "chat-message assistant";
  el.innerHTML = renderMarkdown(text);

  if (citations.length > 0) {
    const citeWrap = document.createElement("div");
    citeWrap.className = "citations";
    citeWrap.innerHTML =
      `<strong>Sources</strong><ol>` +
      citations
        .map(
          (c) =>
            `<li><a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
              c.title
            )}</a></li>`
        )
        .join("") +
      `</ol>`;
    el.appendChild(citeWrap);
  }

  chatWindow.appendChild(el);
  scrollChatToBottom();
}

function appendLoadingMessage() {
  const el = document.createElement("div");
  el.className = "chat-message assistant loading";
  el.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span>`;
  chatWindow.appendChild(el);
  scrollChatToBottom();
  return el;
}

function scrollChatToBottom() {
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function renderMarkdown(text) {
  const escaped = escapeHtml(text);
  const withBold = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const withItalic = withBold.replace(
    /(^|[^*])\*(?!\*)(.+?)\*(?!\*)/g,
    "$1<em>$2</em>"
  );
  return withItalic
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, "<br>"))
    .join("<br><br>");
}

/* ============================================================
   RTL toggle
   ============================================================ */
function toggleDirection() {
  const html = document.documentElement;
  const isRTL = html.getAttribute("dir") === "rtl";
  html.setAttribute("dir", isRTL ? "ltr" : "rtl");
  html.setAttribute("lang", isRTL ? "en" : "ar");
  langToggle.textContent = isRTL ? "ع" : "EN";
  langToggle.setAttribute(
    "aria-label",
    isRTL ? "Switch to Arabic (RTL)" : "Switch to English (LTR)"
  );
}

/* ============================================================
   Helpers
   ============================================================ */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}