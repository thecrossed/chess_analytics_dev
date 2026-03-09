const LANG_STORAGE_KEY = "chess_analytics_lang";
const SUPPORTED_LANGS = ["en", "fr", "zh", "es", "sv"];
const LANG_LABELS = {
  en: "English",
  fr: "Français",
  zh: "中文",
  es: "Español",
  sv: "Svenska"
};

const TRANSLATIONS = {
  en: {
    lang_selector_label: "Language",
    nav_account: "Account",
    nav_logout: "Log Out",
    nav_back_home: "Back to Home",
    nav_back_login: "Back to Login",
    login_title: "User Login",
    login_hint: "Sign in to use the analytics dashboard.",
    login_username: "Username",
    login_password: "Password",
    login_button: "Log In",
    login_guest: "Login as Guest",
    login_create_account: "Create Account",
    login_forgot_password: "Forgot Password?",
    register_title: "Create Account",
    register_hint: "Register a new account to use Chess Data Stats.",
    register_username: "Username",
    register_email: "Email",
    register_password: "Password (min 12, upper/lower/number/symbol)",
    register_button: "Create Account",
    forgot_title: "Forgot Password",
    forgot_hint: "Request a reset email, then set a new password.",
    forgot_username: "Username",
    forgot_request_button: "Request Reset Email",
    forgot_token: "Reset Token",
    forgot_new_password: "New Password (min 12, upper/lower/number/symbol)",
    forgot_reset_button: "Reset Password",
    account_title: "Account",
    account_hint: "Set or update your email for password reset.",
    account_email: "Email",
    account_save: "Save Email",
    home_title: "Chess Data Stats",
    home_hint: "Add one or more usernames and choose a date range (max 120 days).",
    home_platform: "Platform",
    home_range: "Range (days)",
    home_default_mode: "Default mode",
    home_optional_exact_range: "Optional: exact date range",
    home_from: "From",
    home_to: "To",
    home_date_override_hint: "If both dates are set, they override Range.",
    home_game_types: "Game Types",
    home_bullet: "Bullet",
    home_blitz: "Blitz",
    home_rapid: "Rapid",
    home_add: "Add",
    home_upload_csv: "Upload CSV",
    home_csv_hint: "CSV: one username per line or comma-separated.",
    home_generate: "Generate Stats Page",
    stats_title: "Game Stats",
    stats_loading: "Loading data...",
    stats_username: "Username",
    stats_games: "Games",
    stats_breakdown: "Breakdown",
    stats_win_rate: "Win Rate",
    stats_avg_duration: "Avg Game Duration",
    stats_rating_change: "Rating Change (Range)",
    stats_last_played: "Last Played",
    stats_download_csv: "Download CSV",
    stats_download_raw: "Download Raw Data",
    stats_raw_preview: "Raw Data Preview",
    stats_raw_preview_hint: "Preview raw games first, then choose whether to download.",
    stats_raw_platform: "Platform",
    stats_raw_game_type: "Game Type",
    stats_raw_result: "Result",
    stats_raw_played_at: "Played At (UTC)",
    stats_raw_duration_ms: "Duration Ms",
    stats_raw_rating_diff: "Rating Diff",
    stats_raw_rating: "Rating",
    auth_signed_in_as: "Signed in as {username}",
    msg_logging_in: "Logging in...",
    msg_login_failed: "Login failed. Check username/password.",
    msg_account_locked_wait: "This account is temporarily locked. Try again in {wait}s.",
    msg_account_locked_later: "This account is temporarily locked. Please try again later.",
    msg_rate_limited_wait: "Too many attempts. Try again in {wait}s.",
    msg_rate_limited_later: "Too many attempts. Please try again later.",
    msg_payload_too_large: "Request too large. Please shorten input and retry.",
    msg_logging_guest: "Logging in as guest...",
    msg_guest_login_failed: "Guest login failed: {status}{detail}",
    msg_creating_account: "Creating account...",
    msg_username_exists: "This username already exists.",
    msg_email_exists: "This email is already registered.",
    msg_email_required: "Email is required.",
    msg_invalid_email: "Please enter a valid email address.",
    msg_invalid_username: "Username must be 3-32 chars: letters, numbers, _ or -.",
    msg_register_failed: "Register failed.",
    msg_account_created_redirect: "Account created. Redirecting to login...",
    msg_requesting_reset_email: "Requesting reset email...",
    msg_request_reset_failed: "Failed to request reset email.",
    msg_reset_service_not_configured: "Reset email service is not configured yet. Please contact support.",
    msg_reset_token_ready: "Reset token ready: {token}. Now set a new password below.",
    msg_reset_email_sent_if_exists: "If the account exists, reset instructions have been sent to email.",
    msg_resetting_password: "Resetting password...",
    msg_reset_token_invalid: "Reset token is invalid or expired.",
    msg_password_reset_failed: "Password reset failed.",
    msg_password_reset_success_redirect: "Password reset successful. Redirecting to login...",
    msg_saving_email: "Saving email...",
    msg_email_in_use: "This email is already used by another account.",
    msg_save_email_failed: "Failed to save email ({error}).",
    msg_email_saved: "Email saved: {email}",
    msg_password_too_short: "Password must be at least 12 characters.",
    msg_password_too_weak: "Password is too common. Choose a stronger one.",
    msg_password_missing_uppercase: "Password must include at least one uppercase letter.",
    msg_password_missing_lowercase: "Password must include at least one lowercase letter.",
    msg_password_missing_number: "Password must include at least one number.",
    msg_password_missing_symbol: "Password must include at least one symbol.",
    app_remove: "Remove",
    app_more_usernames: "+{count} more usernames",
    alert_invalid_username_format: "Invalid username format: 2-30 characters, letters/numbers/_/- only.",
    alert_no_usernames_csv: "No usernames found in CSV.",
    alert_csv_imported: "CSV imported: {added} added, {invalid} invalid.",
    alert_csv_read_failed: "Failed to read CSV: {error}",
    alert_add_user_first: "Please add at least one username first.",
    alert_select_game_type: "Please select at least one game type (Bullet/Blitz/Rapid).",
    alert_select_both_dates_or_empty: "Please select both From and To dates, or leave both empty.",
    alert_invalid_date_selection: "Invalid date selection.",
    alert_from_after_to: "From date cannot be after To date.",
    alert_max_120_days: "Range cannot exceed 120 days. You entered {days} days.",
    stats_no_usernames: "No usernames received. Please go back to the home page and add accounts.",
    stats_users_loading: "{count} users total on {platform} ({types}), loading...",
    stats_completed_progress: "Completed {finished}/{total} ({platform}, {types})",
    stats_completed_range: "Completed {finished}/{total}. Range: {range} ({platform}, {types}).",
    stats_load_failed: "Load failed: {error}",
    stats_unknown_error: "Unknown error",
    stats_result_win: "Win",
    stats_result_loss: "Loss",
    stats_result_draw: "Draw",
    stats_result_unknown: "Unknown"
  },
  fr: {
    lang_selector_label: "Langue",
    nav_account: "Compte",
    nav_logout: "Se déconnecter",
    nav_back_home: "Retour à l'accueil",
    nav_back_login: "Retour à la connexion",
    login_title: "Connexion utilisateur",
    login_hint: "Connectez-vous pour utiliser le tableau de bord.",
    login_username: "Nom d'utilisateur",
    login_password: "Mot de passe",
    login_button: "Se connecter",
    login_guest: "Connexion invité",
    login_create_account: "Créer un compte",
    login_forgot_password: "Mot de passe oublié ?",
    register_title: "Créer un compte",
    register_hint: "Créez un compte pour utiliser Chess Data Stats.",
    register_username: "Nom d'utilisateur",
    register_email: "E-mail",
    register_password: "Mot de passe (min 12, maj/min/chiffre/symbole)",
    register_button: "Créer un compte",
    forgot_title: "Mot de passe oublié",
    forgot_hint: "Demandez un e-mail de réinitialisation puis définissez un nouveau mot de passe.",
    forgot_username: "Nom d'utilisateur",
    forgot_request_button: "Demander l'e-mail",
    forgot_token: "Jeton de réinitialisation",
    forgot_new_password: "Nouveau mot de passe (min 12, maj/min/chiffre/symbole)",
    forgot_reset_button: "Réinitialiser le mot de passe",
    account_title: "Compte",
    account_hint: "Définissez ou mettez à jour votre e-mail pour la réinitialisation.",
    account_email: "E-mail",
    account_save: "Enregistrer l'e-mail",
    home_title: "Chess Data Stats",
    home_hint: "Ajoutez des utilisateurs et choisissez une plage de dates (max 120 jours).",
    home_platform: "Plateforme",
    home_range: "Plage (jours)",
    home_default_mode: "Mode par défaut",
    home_optional_exact_range: "Optionnel : plage exacte",
    home_from: "De",
    home_to: "À",
    home_date_override_hint: "Si les deux dates sont définies, elles remplacent la plage.",
    home_game_types: "Types de parties",
    home_bullet: "Bullet",
    home_blitz: "Blitz",
    home_rapid: "Rapide",
    home_add: "Ajouter",
    home_upload_csv: "Importer CSV",
    home_csv_hint: "CSV : un nom d'utilisateur par ligne ou séparé par des virgules.",
    home_generate: "Générer la page de stats",
    stats_title: "Statistiques des parties",
    stats_loading: "Chargement des données...",
    stats_username: "Nom d'utilisateur",
    stats_games: "Parties",
    stats_breakdown: "Répartition",
    stats_win_rate: "Taux de victoire",
    stats_avg_duration: "Durée moyenne",
    stats_rating_change: "Variation Elo (période)",
    stats_last_played: "Dernière partie",
    stats_download_csv: "Télécharger CSV",
    stats_download_raw: "Télécharger les données brutes",
    stats_raw_preview: "Aperçu des données brutes",
    stats_raw_preview_hint: "Prévisualisez d'abord les parties brutes, puis choisissez de télécharger.",
    stats_raw_platform: "Plateforme",
    stats_raw_game_type: "Type de partie",
    stats_raw_result: "Résultat",
    stats_raw_played_at: "Joué le (UTC)",
    stats_raw_duration_ms: "Durée ms",
    stats_raw_rating_diff: "Diff. Elo",
    stats_raw_rating: "Elo"
  },
  zh: {
    lang_selector_label: "语言",
    nav_account: "账号",
    nav_logout: "退出登录",
    nav_back_home: "返回首页",
    nav_back_login: "返回登录",
    login_title: "用户登录",
    login_hint: "登录后使用数据看板。",
    login_username: "用户名",
    login_password: "密码",
    login_button: "登录",
    login_guest: "游客登录",
    login_create_account: "创建账号",
    login_forgot_password: "忘记密码？",
    register_title: "创建账号",
    register_hint: "注册新账号以使用 Chess Data Stats。",
    register_username: "用户名",
    register_email: "邮箱",
    register_password: "密码（至少12位，含大小写/数字/符号）",
    register_button: "创建账号",
    forgot_title: "忘记密码",
    forgot_hint: "先申请重置邮件，再设置新密码。",
    forgot_username: "用户名",
    forgot_request_button: "发送重置邮件",
    forgot_token: "重置令牌",
    forgot_new_password: "新密码（至少12位，含大小写/数字/符号）",
    forgot_reset_button: "重置密码",
    account_title: "账号",
    account_hint: "设置或更新用于重置密码的邮箱。",
    account_email: "邮箱",
    account_save: "保存邮箱",
    home_title: "Chess Data Stats",
    home_hint: "添加用户名并选择日期范围（最多120天）。",
    home_platform: "平台",
    home_range: "范围（天）",
    home_default_mode: "默认模式",
    home_optional_exact_range: "可选：精确日期范围",
    home_from: "开始",
    home_to: "结束",
    home_date_override_hint: "如果两个日期都填写，将覆盖范围天数。",
    home_game_types: "对局类型",
    home_bullet: "超快棋",
    home_blitz: "快棋",
    home_rapid: "慢棋",
    home_add: "添加",
    home_upload_csv: "上传 CSV",
    home_csv_hint: "CSV：每行一个用户名，或逗号分隔。",
    home_generate: "生成统计页面",
    stats_title: "对局统计",
    stats_loading: "加载数据中...",
    stats_username: "用户名",
    stats_games: "对局数",
    stats_breakdown: "分类",
    stats_win_rate: "胜率",
    stats_avg_duration: "平均时长",
    stats_rating_change: "等级分变化（范围）",
    stats_last_played: "最近对局",
    stats_download_csv: "下载 CSV",
    stats_download_raw: "下载原始数据",
    stats_raw_preview: "原始数据预览",
    stats_raw_preview_hint: "先查看原始对局数据，再决定是否下载。",
    stats_raw_platform: "平台",
    stats_raw_game_type: "对局类型",
    stats_raw_result: "结果",
    stats_raw_played_at: "对局时间 (UTC)",
    stats_raw_duration_ms: "时长毫秒",
    stats_raw_rating_diff: "等级分变化",
    stats_raw_rating: "等级分"
  },
  es: {
    lang_selector_label: "Idioma",
    nav_account: "Cuenta",
    nav_logout: "Cerrar sesión",
    nav_back_home: "Volver al inicio",
    nav_back_login: "Volver al inicio de sesión",
    login_title: "Inicio de sesión",
    login_hint: "Inicia sesión para usar el panel.",
    login_username: "Usuario",
    login_password: "Contraseña",
    login_button: "Entrar",
    login_guest: "Entrar como invitado",
    login_create_account: "Crear cuenta",
    login_forgot_password: "¿Olvidaste tu contraseña?",
    register_title: "Crear cuenta",
    register_hint: "Registra una cuenta para usar Chess Data Stats.",
    register_username: "Usuario",
    register_email: "Correo",
    register_password: "Contraseña (mín 12, may/min/número/símbolo)",
    register_button: "Crear cuenta",
    forgot_title: "Olvidé mi contraseña",
    forgot_hint: "Solicita un correo de restablecimiento y define una nueva contraseña.",
    forgot_username: "Usuario",
    forgot_request_button: "Solicitar correo",
    forgot_token: "Token de restablecimiento",
    forgot_new_password: "Nueva contraseña (mín 12, may/min/número/símbolo)",
    forgot_reset_button: "Restablecer contraseña",
    account_title: "Cuenta",
    account_hint: "Configura o actualiza tu correo para restablecer contraseña.",
    account_email: "Correo",
    account_save: "Guardar correo",
    home_title: "Chess Data Stats",
    home_hint: "Agrega usuarios y elige un rango de fechas (máx. 120 días).",
    home_platform: "Plataforma",
    home_range: "Rango (días)",
    home_default_mode: "Modo predeterminado",
    home_optional_exact_range: "Opcional: rango exacto",
    home_from: "Desde",
    home_to: "Hasta",
    home_date_override_hint: "Si completas ambas fechas, reemplazan el rango.",
    home_game_types: "Tipos de partida",
    home_bullet: "Bullet",
    home_blitz: "Blitz",
    home_rapid: "Rapid",
    home_add: "Agregar",
    home_upload_csv: "Subir CSV",
    home_csv_hint: "CSV: un usuario por línea o separado por comas.",
    home_generate: "Generar página de estadísticas",
    stats_title: "Estadísticas",
    stats_loading: "Cargando datos...",
    stats_username: "Usuario",
    stats_games: "Partidas",
    stats_breakdown: "Desglose",
    stats_win_rate: "Tasa de victoria",
    stats_avg_duration: "Duración media",
    stats_rating_change: "Cambio de rating (rango)",
    stats_last_played: "Última partida",
    stats_download_csv: "Descargar CSV",
    stats_download_raw: "Descargar datos crudos",
    stats_raw_preview: "Vista previa de datos crudos",
    stats_raw_preview_hint: "Primero revisa las partidas crudas y luego decide si descargar.",
    stats_raw_platform: "Plataforma",
    stats_raw_game_type: "Tipo de partida",
    stats_raw_result: "Resultado",
    stats_raw_played_at: "Jugado en (UTC)",
    stats_raw_duration_ms: "Duración ms",
    stats_raw_rating_diff: "Cambio de rating",
    stats_raw_rating: "Rating"
  },
  sv: {
    lang_selector_label: "Språk",
    nav_account: "Konto",
    nav_logout: "Logga ut",
    nav_back_home: "Tillbaka till startsidan",
    nav_back_login: "Tillbaka till inloggning",
    login_title: "Användarinloggning",
    login_hint: "Logga in för att använda analyspanelen.",
    login_username: "Användarnamn",
    login_password: "Lösenord",
    login_button: "Logga in",
    login_guest: "Logga in som gäst",
    login_create_account: "Skapa konto",
    login_forgot_password: "Glömt lösenord?",
    register_title: "Skapa konto",
    register_hint: "Registrera ett konto för att använda Chess Data Stats.",
    register_username: "Användarnamn",
    register_email: "E-post",
    register_password: "Lösenord (min 12, versaler/gemener/siffra/symbol)",
    register_button: "Skapa konto",
    forgot_title: "Glömt lösenord",
    forgot_hint: "Begär ett återställningsmail och ange nytt lösenord.",
    forgot_username: "Användarnamn",
    forgot_request_button: "Begär återställningsmail",
    forgot_token: "Återställningstoken",
    forgot_new_password: "Nytt lösenord (min 12, versaler/gemener/siffra/symbol)",
    forgot_reset_button: "Återställ lösenord",
    account_title: "Konto",
    account_hint: "Ange eller uppdatera din e-post för lösenordsåterställning.",
    account_email: "E-post",
    account_save: "Spara e-post",
    home_title: "Chess Data Stats",
    home_hint: "Lägg till användare och välj datumintervall (max 120 dagar).",
    home_platform: "Plattform",
    home_range: "Intervall (dagar)",
    home_default_mode: "Standardläge",
    home_optional_exact_range: "Valfritt: exakt datumintervall",
    home_from: "Från",
    home_to: "Till",
    home_date_override_hint: "Om båda datumen anges ersätter de intervallet.",
    home_game_types: "Partityper",
    home_bullet: "Bullet",
    home_blitz: "Blitz",
    home_rapid: "Rapid",
    home_add: "Lägg till",
    home_upload_csv: "Ladda upp CSV",
    home_csv_hint: "CSV: ett användarnamn per rad eller kommaseparerat.",
    home_generate: "Skapa statistiksida",
    stats_title: "Spelstatistik",
    stats_loading: "Laddar data...",
    stats_username: "Användarnamn",
    stats_games: "Partier",
    stats_breakdown: "Uppdelning",
    stats_win_rate: "Vinstprocent",
    stats_avg_duration: "Genomsnittlig speltid",
    stats_rating_change: "Ratingändring (intervall)",
    stats_last_played: "Senast spelad",
    stats_download_csv: "Ladda ner CSV",
    stats_download_raw: "Ladda ner rådata",
    stats_raw_preview: "Förhandsgranskning av rådata",
    stats_raw_preview_hint: "Visa först råpartier och välj sedan om du vill ladda ner.",
    stats_raw_platform: "Plattform",
    stats_raw_game_type: "Partityp",
    stats_raw_result: "Resultat",
    stats_raw_played_at: "Spelad vid (UTC)",
    stats_raw_duration_ms: "Varaktighet ms",
    stats_raw_rating_diff: "Ratingförändring",
    stats_raw_rating: "Rating"
  }
};

function getStoredLanguage() {
  const lang = localStorage.getItem(LANG_STORAGE_KEY);
  return SUPPORTED_LANGS.includes(lang) ? lang : "en";
}

function translateKey(lang, key) {
  const langPack = TRANSLATIONS[lang] || TRANSLATIONS.en;
  return langPack[key] || TRANSLATIONS.en[key] || key;
}

function formatTemplate(value, params) {
  if (!params) {
    return value;
  }
  return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (_all, key) => {
    return Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : "";
  });
}

function applyTranslations(lang) {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    el.textContent = translateKey(lang, key);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!key) return;
    el.setAttribute("placeholder", translateKey(lang, key));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (!key) return;
    el.textContent = translateKey(lang, key);
  });
}

function injectLanguageSelector(lang) {
  const wrap = document.createElement("div");
  wrap.className = "lang-corner";

  const label = document.createElement("label");
  label.setAttribute("for", "lang-select");
  label.className = "lang-corner-label";
  label.textContent = translateKey(lang, "lang_selector_label");

  const select = document.createElement("select");
  select.id = "lang-select";
  select.className = "lang-corner-select";

  SUPPORTED_LANGS.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = LANG_LABELS[value];
    if (value === lang) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  select.addEventListener("change", () => {
    const next = select.value;
    localStorage.setItem(LANG_STORAGE_KEY, next);
    applyTranslations(next);
    label.textContent = translateKey(next, "lang_selector_label");
    window.dispatchEvent(new CustomEvent("languagechange", { detail: { lang: next } }));
  });

  wrap.appendChild(label);
  wrap.appendChild(select);
  document.body.appendChild(wrap);
}

const currentLanguage = getStoredLanguage();
applyTranslations(currentLanguage);
injectLanguageSelector(currentLanguage);

window.i18n = {
  getLanguage: getStoredLanguage,
  t(key, params) {
    const lang = getStoredLanguage();
    return formatTemplate(translateKey(lang, key), params);
  }
};
