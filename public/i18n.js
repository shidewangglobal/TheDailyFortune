(() => {
  const LANG_KEY = "daily_fortune_lang";
  const CACHE_PREFIX = "daily_fortune_i18n_cache_";
  const DEFAULT_LANG = "vi";
  const FALLBACK_LANG = "en";
  const KEY_CACHE_PREFIX = "daily_fortune_i18n_key_cache_";
  const RUNTIME_I18N_KEYS = [
    "dashboard.daily.viewingDate",
    "dashboard.focusHour.auto",
    "dashboard.forecast.focus.default",
    "dashboard.forecast.lunarDay",
    "dashboard.forecast.lunarMonth",
    "dashboard.forecast.belongsTo",
    "dashboard.cung.daiAn",
    "dashboard.cung.luuLien",
    "dashboard.cung.tocHy",
    "dashboard.cung.xichKhau",
    "dashboard.cung.tieuCat",
    "dashboard.cung.khongVong",
    "dashboard.branch.ty",
    "dashboard.branch.suu",
    "dashboard.branch.dan",
    "dashboard.branch.mao",
    "dashboard.branch.thin",
    "dashboard.branch.ty2",
    "dashboard.branch.ngo",
    "dashboard.branch.mui",
    "dashboard.branch.than",
    "dashboard.branch.dau",
    "dashboard.branch.tuat",
    "dashboard.branch.hoi",
    "dashboard.usage.unlimitedMode",
    "dashboard.usage.unlimited",
    "dashboard.usage.limited",
    "dashboard.owner.codeLabel",
    "dashboard.owner.profileRef",
    "dashboard.owner.tempOther",
    "dashboard.owner.birthYear.gateTitle",
    "dashboard.energy.birthYear.hint",
    "dashboard.energy.quote.partial.high",
    "dashboard.energy.quote.partial.mid",
    "dashboard.energy.quote.partial.low",
    "dashboard.energy.quote.avoidClose",
    "dashboard.energy.quote.steadyProgress",
    "dashboard.energy.quote.routine",
    "dashboard.stem.giap",
    "dashboard.stem.at",
    "dashboard.stem.binh",
    "dashboard.stem.dinh",
    "dashboard.stem.mau",
    "dashboard.stem.ky",
    "dashboard.stem.canh",
    "dashboard.stem.tan",
    "dashboard.stem.nham",
    "dashboard.stem.quy"
  ];
  const SUPPORTED = [
    { code: "vi", label: "Tiếng Việt (Vietnamese)" },
    { code: "en", label: "English" },
    { code: "hi", label: "हिन्दी (Hindi)" },
    { code: "zh", label: "中文 (Chinese)" },
    { code: "ja", label: "日本語 (Japanese)" },
    { code: "ko", label: "한국어 (Korean)" },
    { code: "th", label: "ไทย (Thai)" },
    { code: "id", label: "Bahasa Indonesia (Indonesian)" },
    { code: "ms", label: "Bahasa Melayu (Malay)" },
    { code: "tl", label: "Filipino (Tagalog)" },
    { code: "fr", label: "Français (French)" },
    { code: "de", label: "Deutsch (German)" },
    { code: "es", label: "Español (Spanish)" },
    { code: "pt", label: "Português (Portuguese)" },
    { code: "it", label: "Italiano (Italian)" },
    { code: "ru", label: "Русский (Russian)" },
    { code: "ar", label: "العربية (Arabic)" },
    { code: "tr", label: "Türkçe (Turkish)" },
    { code: "nl", label: "Nederlands (Dutch)" },
    { code: "pl", label: "Polski (Polish)" },
  ];
  const dictionaries = {};
  let currentLang = DEFAULT_LANG;
  let mutationTimer = null;
  let observer = null;
  let isTranslating = false;
  let pendingTranslateRequest = false;
  let observerSuppressed = 0;

  function normalizeLang(lang) {
    const raw = String(lang || "").trim().toLowerCase();
    if (!raw) return DEFAULT_LANG;
    const exact = SUPPORTED.find((x) => x.code === raw);
    if (exact) return exact.code;
    const short = raw.split(/[-_]/)[0];
    const fallback = SUPPORTED.find((x) => x.code === short);
    return fallback ? fallback.code : DEFAULT_LANG;
  }

  function getLanguage() {
    if (currentLang) return currentLang;
    try {
      const saved = localStorage.getItem(LANG_KEY);
      currentLang = normalizeLang(saved || navigator.language || DEFAULT_LANG);
      return currentLang;
    } catch (_) {
      currentLang = DEFAULT_LANG;
      return currentLang;
    }
  }

  function setLanguage(lang, opts = {}) {
    currentLang = normalizeLang(lang);
    // #region agent log
    fetch('http://127.0.0.1:7721/ingest/40683a09-4bbd-4ee6-8c85-c52ade641def',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b669db'},body:JSON.stringify({sessionId:'b669db',runId:'lang-switch',hypothesisId:'H1',location:'public/i18n.js:setLanguage',message:'language_selected',data:{requested:lang,normalized:currentLang},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    try {
      localStorage.setItem(LANG_KEY, currentLang);
    } catch (_) {}
    if (!opts.silent) {
      Promise.resolve(runTranslationPipeline(document)).then(() => {
        window.dispatchEvent(new CustomEvent("df:lang-changed", { detail: { lang: currentLang } }));
      });
    }
    return currentLang;
  }

  function withObserverSuppressed(fn) {
    observerSuppressed += 1;
    try {
      return fn();
    } finally {
      observerSuppressed = Math.max(0, observerSuppressed - 1);
    }
  }

  async function ensureDictionary(lang) {
    const code = normalizeLang(lang);
    if (dictionaries[code]) return dictionaries[code];
    try {
      const r = await fetch(`/i18n/locales/${code}.json`, { credentials: "same-origin" });
      if (r.ok) {
        dictionaries[code] = await r.json().catch(() => ({}));
      } else {
        dictionaries[code] = {};
      }
    } catch (_) {
      dictionaries[code] = {};
    }
    try {
      const keyCache = JSON.parse(localStorage.getItem(KEY_CACHE_PREFIX + code) || "{}");
      if (keyCache && typeof keyCache === "object") {
        dictionaries[code] = { ...(dictionaries[code] || {}), ...keyCache };
      }
    } catch (_) {}
    return dictionaries[code];
  }

  async function fillMissingKeysByTranslation(lang, keys) {
    const code = normalizeLang(lang);
    if (code === DEFAULT_LANG || !keys.length) return;
    await Promise.all([ensureDictionary(code), ensureDictionary(DEFAULT_LANG)]);
    const cur = dictionaries[code] || {};
    const vi = dictionaries[DEFAULT_LANG] || {};
    const missing = [];
    const keyOrder = [];
    keys.forEach((k) => {
      if (!k) return;
      if (cur[k]) return;
      if (!vi[k]) return;
      missing.push(String(vi[k]));
      keyOrder.push(k);
    });
    if (!missing.length) return;
    try {
      const r = await fetch("/api/i18n/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          target_language: code,
          source_language: "vi",
          texts: missing,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j || !j.ok || !Array.isArray(j.translations)) return;
      keyOrder.forEach((k, i) => {
        const translated = j.translations[i];
        if (typeof translated === "string" && translated.trim()) cur[k] = translated;
      });
      dictionaries[code] = cur;
      try {
        localStorage.setItem(KEY_CACHE_PREFIX + code, JSON.stringify(cur));
      } catch (_) {}
      // #region agent log
      fetch('http://127.0.0.1:7721/ingest/40683a09-4bbd-4ee6-8c85-c52ade641def',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b669db'},body:JSON.stringify({sessionId:'b669db',runId:'lang-switch',hypothesisId:'H2',location:'public/i18n.js:fillMissingKeysByTranslation',message:'translated_missing_keys',data:{lang:code,count:keyOrder.length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    } catch (_) {}
  }

  function template(str, params) {
    if (!params) return str;
    return String(str).replace(/\{(\w+)\}/g, (_, k) => (params[k] == null ? `{${k}}` : String(params[k])));
  }

  function t(key, params) {
    const lang = getLanguage();
    const cur = dictionaries[lang] || {};
    const fb = dictionaries[FALLBACK_LANG] || {};
    const vi = dictionaries[DEFAULT_LANG] || {};
    if (
      lang !== DEFAULT_LANG &&
      cur[key] == null &&
      vi[key] != null
    ) {
      // #region agent log
      fetch('http://127.0.0.1:7721/ingest/40683a09-4bbd-4ee6-8c85-c52ade641def',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b669db'},body:JSON.stringify({sessionId:'b669db',runId:'lang-switch',hypothesisId:'H15',location:'public/i18n.js:t',message:'fallback_to_vi_for_non_vi_lang',data:{lang,key,hasFallback:fb[key]!=null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    }
    const value =
      lang === DEFAULT_LANG
        ? (cur[key] ?? vi[key] ?? key)
        : (cur[key] ?? vi[key] ?? fb[key] ?? key);
    if (value === key) {
      // #region agent log
      fetch('http://127.0.0.1:7721/ingest/40683a09-4bbd-4ee6-8c85-c52ade641def',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b669db'},body:JSON.stringify({sessionId:'b669db',runId:'lang-switch',hypothesisId:'H2',location:'public/i18n.js:t',message:'missing_key_fallback_to_raw_key',data:{lang,key},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    }
    return template(value, params);
  }

  async function applyTranslations(root = document) {
    const lang = getLanguage();
    await Promise.all([ensureDictionary(lang), ensureDictionary(FALLBACK_LANG), ensureDictionary(DEFAULT_LANG)]);
    const scoped = root || document;
    const keys = [];
    scoped.querySelectorAll("[data-i18n]").forEach((el) => keys.push(el.getAttribute("data-i18n") || ""));
    scoped.querySelectorAll("[data-i18n-html]").forEach((el) => keys.push(el.getAttribute("data-i18n-html") || ""));
    scoped.querySelectorAll("[data-i18n-placeholder]").forEach((el) => keys.push(el.getAttribute("data-i18n-placeholder") || ""));
    scoped.querySelectorAll("[data-i18n-title]").forEach((el) => keys.push(el.getAttribute("data-i18n-title") || ""));
    scoped.querySelectorAll("[data-i18n-aria]").forEach((el) => keys.push(el.getAttribute("data-i18n-aria") || ""));
    keys.push(...RUNTIME_I18N_KEYS);
    await fillMissingKeysByTranslation(lang, keys.filter(Boolean));
    scoped.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      el.textContent = t(key);
    });
    scoped.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n-html");
      if (!key) return;
      el.innerHTML = t(key);
    });
    scoped.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (!key) return;
      el.setAttribute("placeholder", t(key));
    });
    scoped.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (!key) return;
      el.setAttribute("title", t(key));
    });
    scoped.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const key = el.getAttribute("data-i18n-aria");
      if (!key) return;
      el.setAttribute("aria-label", t(key));
    });
    document.documentElement.setAttribute("lang", lang);
  }

  function getCacheKey(lang, pageKey) {
    return `${CACHE_PREFIX}${lang}_${pageKey}`;
  }

  function getPageKey() {
    return (location.pathname || "/").replace(/[^\w]/g, "_");
  }

  function collectTranslatableElements(root = document.body) {
    if (!root) return [];
    const selector = "h1,h2,h3,h4,h5,h6,p,label,button,a,th,td,span,li,option,strong,em,.subtitle,.status,.note";
    const list = Array.from(root.querySelectorAll(selector));
    return list.filter((el) => {
      if (!el || !el.textContent) return false;
      if (el.closest("[data-no-translate='1']")) return false;
      if (el.closest("script,style")) return false;
      if (el.hasAttribute("data-i18n") || el.hasAttribute("data-i18n-html")) return false;
      const txt = el.textContent.trim();
      if (!txt) return false;
      if (/^[\d\s\W_]+$/.test(txt)) return false;
      if (txt.length > 400) return false;
      return true;
    });
  }

  async function translateTexts(texts, targetLang) {
    if (!texts.length || targetLang === DEFAULT_LANG) return texts;
    try {
      const r = await fetch("/api/i18n/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          target_language: targetLang,
          source_language: "auto",
          texts,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j || !j.ok || !Array.isArray(j.translations)) return texts;
      if (j.translations.length !== texts.length) return texts;
      return j.translations.map((x) => (typeof x === "string" && x.trim() ? x : ""));
    } catch (_) {
      return texts;
    }
  }

  async function autoTranslatePage(root = document.body) {
    const lang = getLanguage();
    if (!root) return;
    const strictMode = document.body && document.body.getAttribute("data-i18n-strict") === "1";
    if (strictMode) return;
    if (lang === DEFAULT_LANG) {
      // Restore original source text when user switches back to default language.
      const nodesDefault = collectTranslatableElements(root);
      withObserverSuppressed(() => {
        nodesDefault.forEach((el) => {
          const src = el.getAttribute("data-i18n-src");
          if (src && el.textContent !== src) el.textContent = src;
          if (src) el.removeAttribute("data-i18n-translated-lang");
        });
      });
      return;
    }
    const pageKey = getPageKey();
    const nodes = collectTranslatableElements(root);
    if (!nodes.length) return;
    const sourceTexts = nodes.map((el) => {
      const fromAttr = el.getAttribute("data-i18n-src");
      if (fromAttr && fromAttr.trim()) return fromAttr.trim();
      const current = (el.textContent || "").trim();
      if (current) el.setAttribute("data-i18n-src", current);
      return current;
    });
    const unique = [];
    const mapIndex = new Map();
    sourceTexts.forEach((txt) => {
      if (!mapIndex.has(txt)) {
        mapIndex.set(txt, unique.length);
        unique.push(txt);
      }
    });
    const cacheKey = getCacheKey(lang, pageKey);
    let cache = {};
    try {
      cache = JSON.parse(localStorage.getItem(cacheKey) || "{}") || {};
    } catch (_) {
      cache = {};
    }
    const need = unique.filter((txt) => !cache[txt]);
    if (need.length) {
      const chunkSize = 80;
      for (let i = 0; i < need.length; i += chunkSize) {
        const chunk = need.slice(i, i + chunkSize);
        const translated = await translateTexts(chunk, lang);
        chunk.forEach((src, idx) => {
          const dst = translated[idx];
          if (dst && dst.trim()) cache[src] = dst;
        });
      }
      try {
        localStorage.setItem(cacheKey, JSON.stringify(cache));
      } catch (_) {}
    }
    withObserverSuppressed(() => {
      nodes.forEach((el, idx) => {
      const src = sourceTexts[idx];
      if (!src) return;
      const translated = cache[src];
      if (translated && translated.trim()) {
        if (el.textContent !== translated) el.textContent = translated;
        el.setAttribute("data-i18n-translated-lang", lang);
      }
    });
    });
  }

  function scheduleAutoTranslatePage() {
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      runTranslationPipeline(document.body);
    }, 200);
  }

  async function runTranslationPipeline(root) {
    if (isTranslating) {
      pendingTranslateRequest = true;
      return;
    }
    isTranslating = true;
    try {
      // #region agent log
      fetch('http://127.0.0.1:7721/ingest/40683a09-4bbd-4ee6-8c85-c52ade641def',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b669db'},body:JSON.stringify({sessionId:'b669db',runId:'lang-switch',hypothesisId:'H3',location:'public/i18n.js:runTranslationPipeline',message:'pipeline_start',data:{lang:getLanguage(),strictMode:!!(document.body&&document.body.getAttribute('data-i18n-strict')==='1')},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      await applyTranslations(document);
      await autoTranslatePage(root || document.body);
      // #region agent log
      fetch('http://127.0.0.1:7721/ingest/40683a09-4bbd-4ee6-8c85-c52ade641def',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b669db'},body:JSON.stringify({sessionId:'b669db',runId:'lang-switch',hypothesisId:'H3',location:'public/i18n.js:runTranslationPipeline',message:'pipeline_done',data:{lang:getLanguage()},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    } finally {
      isTranslating = false;
      if (pendingTranslateRequest) {
        pendingTranslateRequest = false;
        scheduleAutoTranslatePage();
      }
    }
  }

  function ensureLanguageDropdown() {
    const host = document.querySelector("[data-lang-dropdown-host]");
    if (!host) return null;
    host.setAttribute("data-no-translate", "1");
    let select = host.querySelector("select[data-lang-select]");
    if (!select) {
      const wrap = document.createElement("label");
      wrap.style.display = "inline-flex";
      wrap.style.alignItems = "center";
      wrap.style.gap = "6px";
      wrap.style.fontSize = "12px";
      wrap.style.color = "var(--muted, #cdb8e7)";
      wrap.innerHTML = `<span data-i18n="lang.label">Language</span>`;
      select = document.createElement("select");
      select.setAttribute("data-lang-select", "1");
      select.style.borderRadius = "999px";
      select.style.padding = "6px 10px";
      select.style.border = "1px solid rgba(255,255,255,.24)";
      select.style.background = "rgba(0,0,0,.24)";
      select.style.color = "#fff";
      select.style.fontSize = "12px";
      SUPPORTED.forEach((lang) => {
        const opt = document.createElement("option");
        opt.value = lang.code;
        opt.textContent = `${lang.label} (${lang.code})`;
        select.appendChild(opt);
      });
      wrap.appendChild(select);
      host.appendChild(wrap);
    }
    select.value = getLanguage();
    select.addEventListener("change", () => setLanguage(select.value));
    return select;
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
      if (observerSuppressed > 0) return;
      const lang = getLanguage();
      const strictMode = document.body && document.body.getAttribute("data-i18n-strict") === "1";
      if (strictMode) return;
      if (isTranslating) {
        pendingTranslateRequest = true;
        return;
      }
      scheduleAutoTranslatePage();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  async function init() {
    await ensureDictionary(DEFAULT_LANG);
    await ensureDictionary(FALLBACK_LANG);
    ensureLanguageDropdown();
    await runTranslationPipeline(document.body);
    window.dispatchEvent(new CustomEvent("df:lang-changed", { detail: { lang: getLanguage() } }));
    startObserver();
  }

  window.DFI18n = {
    supportedLanguages: SUPPORTED,
    t,
    getLanguage,
    setLanguage,
    applyTranslations,
    ensureDictionary,
    autoTranslatePage,
    init,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
