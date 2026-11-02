// dsh-purge-workbuddy :: paths
// 统一解析 WorkBuddy(国际版/CN) 的 profile 目录、安装目录、prompt 模板目录。
// 移植自 dsh-purge-community lib/host-layout.js + host.js，改写为 WorkBuddy 事实。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 插件根目录（plugin.json 所在目录）。 */
export function pluginRoot() {
  const env = (process.env.CODEBUDDY_PLUGIN_ROOT || "").trim();
  if (env) return env;
  return path.resolve(__dirname, "..");
}

function alive(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * 每份安装副本自带的目标绑定。
 * 两版（国际版 WorkBuddy AI / CN 版 WorkBuddy）并存时，hook 的运行时环境里
 * 没有 WORKBUDDY_CONFIG_DIR，靠探测顺序会选错版本。安装器在插件根写
 * target.json 把 profiele/installDir 钉死，运行时优先读它。
 */
function readBinding() {
  const f = path.join(pluginRoot(), "target.json");
  try {
    const raw = fs.readFileSync(f, "utf8");
    const j = JSON.parse(raw);
    return {
      configDir: typeof j.configDir === "string" && j.configDir.trim() ? j.configDir.trim() : "",
      installDir: typeof j.installDir === "string" && j.installDir.trim() ? j.installDir.trim() : "",
      edition: typeof j.edition === "string" ? j.edition : "",
    };
  } catch {
    return { configDir: "", installDir: "", edition: "" };
  }
}

/**
 * WorkBuddy profile 目录（= 放 settings.json / app/app-config.json 的地方）。
 * 顺序：显式环境变量 → 安装绑定 → 已知候选（国际版优先）→ 默认 ~/.workbuddy。
 */
export function configDir() {
  const explicit = (process.env.WORKBUDDY_CONFIG_DIR || "").trim();
  if (explicit) return explicit;

  const bound = readBinding().configDir;
  if (bound && alive(bound)) return bound;

  const home = os.homedir();
  const candidates = [
    path.join(home, ".workbuddy-ai"), // 国际版 WorkBuddy AI
    path.join(home, ".workbuddy"), // CN 版 WorkBuddy
  ];
  for (const c of candidates) {
    // 以 app/app-config.json 或 settings.json 的存在与否作为“活的 profile”判据
    if (alive(path.join(c, "app", "app-config.json")) || alive(path.join(c, "settings.json"))) {
      return c;
    }
  }
  return path.join(home, ".workbuddy");
}

export function appConfigPath() {
  return path.join(configDir(), "app", "app-config.json");
}

export function settingsPath() {
  return path.join(configDir(), "settings.json");
}

export function stateDir() {
  return path.join(configDir(), "dsh-purge");
}

export function backupDir() {
  return path.join(stateDir(), "backups");
}

export function auditPath() {
  return path.join(stateDir(), "audit.jsonl");
}

/**
 * WorkBuddy 安装目录（含 resources/app.asar.unpacked）。
 * 顺序：显式环境变量 → 从运行中的进程路径推断 → 已知安装位 → 注册表猜测。
 */
export function installDir() {
  const explicit = (process.env.WORKBUDDY_INSTALL_DIR || "").trim();
  if (explicit && alive(explicit)) return explicit;

  const bound = readBinding().installDir;
  if (bound && alive(bound)) return bound;

  // 从当前进程向上找：MCP server 由 WorkBuddy 主进程 spawn，argv/execPath 在安装目录内
  const seeds = [process.execPath, process.argv[1] || "", __dirname];
  for (const seed of seeds) {
    if (!seed) continue;
    let dir = path.dirname(seed);
    for (let i = 0; i < 6; i++) {
      if (alive(path.join(dir, "resources", "app.asar")) ||
          alive(path.join(dir, "resources", "app.asar.unpacked"))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  const candidates = [
    "D:\\TOOL\\workBuddyAI_outside", // 国际版实测安装位
    "D:\\TOOL\\WorkBuddy", // CN 版实测安装位
    path.join(process.env.LOCALAPPDATA || "", "Programs", "WorkBuddyAI"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "WorkBuddy"),
    "C:\\Program Files\\WorkBuddyAI",
    "C:\\Program Files\\WorkBuddy",
  ];
  for (const c of candidates) {
    if (alive(path.join(c, "resources", "app.asar"))) return c;
  }
  return "";
}

/** prompt 模板目录（nunjucks .tpl，明文在 app.asar.unpacked）。 */
export function templatesDir() {
  const install = installDir();
  if (!install) return "";
  const p = path.join(install, "resources", "app.asar.unpacked", "resources", "templates");
  return alive(p) ? p : "";
}

/** 插件自身的 rules / skills / agents 目录。 */
export function pkgRulesDir() {
  return path.join(pluginRoot(), "rules");
}

export function pkgSkillsDir() {
  return path.join(pluginRoot(), "skills");
}

export function pkgAgentsDir() {
  return path.join(pluginRoot(), "agents");
}

/** 汇总一份诊断用的路径快照。 */
export function layout() {
  return {
    pluginRoot: pluginRoot(),
    configDir: configDir(),
    appConfig: appConfigPath(),
    settings: settingsPath(),
    installDir: installDir(),
    templatesDir: templatesDir(),
    stateDir: stateDir(),
    backupDir: backupDir(),
    audit: auditPath(),
  };
}
