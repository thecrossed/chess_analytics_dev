(() => {
  const STORAGE_KEY = "cookie_consent_v1";
  const CONSENT_VERSION = 1;
  const EU_UK_CH_COUNTRIES = new Set([
    "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT",
    "LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO","UK","GB","CH"
  ]);

  const TEXTS = {
    en: {
      title: "Cookie Preferences",
      message_opt_in:
        "We use necessary cookies for core features. Analytics and marketing cookies require your consent in your region.",
      message_opt_out:
        "We use cookies for site operation and analytics. You can opt out of non-essential cookies.",
      message_notice:
        "We use cookies to improve the website experience. You can manage preferences at any time.",
      accept_all: "Accept all",
      essential_only: "Essential only",
      manage: "Manage",
      save: "Save preferences",
      analytics: "Analytics cookies",
      marketing: "Marketing cookies",
      reopen: "Cookie settings"
    },
    zh: {
      title: "Cookie 设置",
      message_opt_in: "我们使用必要 Cookie 保障网站功能。在你所在地区，分析和营销 Cookie 需要你授权。",
      message_opt_out: "我们使用 Cookie 保障网站运行并进行分析。你可以随时关闭非必要 Cookie。",
      message_notice: "我们使用 Cookie 优化网站体验。你可以随时管理偏好。",
      accept_all: "全部接受",
      essential_only: "仅必要",
      manage: "管理",
      save: "保存偏好",
      analytics: "分析类 Cookie",
      marketing: "营销类 Cookie",
      reopen: "Cookie 设置"
    }
  };

  function langKey() {
    return (document.documentElement.lang || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  function t(key) {
    const pack = TEXTS[langKey()] || TEXTS.en;
    return pack[key] || TEXTS.en[key] || key;
  }

  function detectCountryCode() {
    const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
    for (const lang of langs) {
      try {
        const locale = new Intl.Locale(lang);
        if (locale.region) {
          return String(locale.region).toUpperCase();
        }
      } catch (_error) {
        const m = String(lang).match(/-([A-Za-z]{2})$/);
        if (m) return m[1].toUpperCase();
      }
    }
    return "";
  }

  function detectPolicy(countryCode) {
    if (EU_UK_CH_COUNTRIES.has(countryCode)) {
      return "opt_in";
    }
    if (countryCode === "US") {
      return "opt_out";
    }
    return "notice";
  }

  function buildInitialState(policy, countryCode) {
    if (policy === "opt_in") {
      return {
        necessary: true,
        analytics: false,
        marketing: false,
        policy,
        countryCode,
        version: CONSENT_VERSION,
        updatedAt: Date.now()
      };
    }
    return {
      necessary: true,
      analytics: true,
      marketing: false,
      policy,
      countryCode,
      version: CONSENT_VERSION,
      updatedAt: Date.now()
    };
  }

  function readStoredState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== CONSENT_VERSION) return null;
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent("cookieconsentchange", { detail: state }));
  }

  function createNode(html) {
    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    return wrap.firstElementChild;
  }

  function ensureManageButton(openModal) {
    let btn = document.getElementById("cookie-settings-open");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "cookie-settings-open";
      btn.className = "cookie-settings-open";
      btn.type = "button";
      btn.setAttribute("data-track", "false");
      document.body.appendChild(btn);
    }
    btn.textContent = t("reopen");
    btn.onclick = openModal;
  }

  function init() {
    const countryCode = detectCountryCode();
    const policy = detectPolicy(countryCode);

    let state = readStoredState();
    if (!state) {
      state = buildInitialState(policy, countryCode);
    }

    const modal = createNode(`
      <div class="cookie-modal hidden" id="cookie-modal" role="dialog" aria-modal="true">
        <div class="cookie-modal-card">
          <h3>${t("title")}</h3>
          <div class="cookie-grid">
            <label>
              <input id="cookie-analytics" type="checkbox" />
              <span>${t("analytics")}</span>
            </label>
            <label>
              <input id="cookie-marketing" type="checkbox" />
              <span>${t("marketing")}</span>
            </label>
          </div>
          <div class="cookie-actions">
            <button id="cookie-save" type="button" data-track="false">${t("save")}</button>
          </div>
        </div>
      </div>
    `);

    const bannerMessageKey = policy === "opt_in" ? "message_opt_in" : policy === "opt_out" ? "message_opt_out" : "message_notice";
    const banner = createNode(`
      <div class="cookie-banner" id="cookie-banner" role="region" aria-live="polite">
        <div class="cookie-banner-text">
          <strong>${t("title")}</strong>
          <p>${t(bannerMessageKey)}</p>
        </div>
        <div class="cookie-actions">
          <button id="cookie-accept" type="button" data-track="false">${t("accept_all")}</button>
          <button id="cookie-essential" type="button" data-track="false">${t("essential_only")}</button>
          <button id="cookie-manage" type="button" data-track="false">${t("manage")}</button>
        </div>
      </div>
    `);

    document.body.appendChild(modal);

    const analyticsInput = modal.querySelector("#cookie-analytics");
    const marketingInput = modal.querySelector("#cookie-marketing");
    const saveBtn = modal.querySelector("#cookie-save");

    const closeModal = () => modal.classList.add("hidden");
    const openModal = () => {
      analyticsInput.checked = Boolean(state.analytics);
      marketingInput.checked = Boolean(state.marketing);
      modal.classList.remove("hidden");
    };

    ensureManageButton(openModal);

    saveBtn.addEventListener("click", () => {
      state = {
        ...state,
        analytics: Boolean(analyticsInput.checked),
        marketing: Boolean(marketingInput.checked),
        updatedAt: Date.now()
      };
      saveState(state);
      closeModal();
      banner.remove();
    });

    banner.querySelector("#cookie-accept").addEventListener("click", () => {
      state = { ...state, analytics: true, marketing: true, updatedAt: Date.now() };
      saveState(state);
      banner.remove();
    });

    banner.querySelector("#cookie-essential").addEventListener("click", () => {
      state = { ...state, analytics: false, marketing: false, updatedAt: Date.now() };
      saveState(state);
      banner.remove();
    });

    banner.querySelector("#cookie-manage").addEventListener("click", () => {
      openModal();
    });

    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });

    window.cookieConsent = {
      getState: () => ({ ...state }),
      canUse: (category) => {
        if (category === "necessary") return true;
        return Boolean(state && state[category]);
      },
      openPreferences: openModal
    };

    // Show banner only if user has not made an explicit choice for this version.
    if (!readStoredState()) {
      document.body.appendChild(banner);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
