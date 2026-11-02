#!/usr/bin/env node
// dsh-purge-workbuddy :: selfcheck
// 移植自 dsh-purge-community lib/selfcheck.js。
// 逐项检查：安装/模板可定位、模板可写、注入段完整、配置可读写、备份可用、漂移。
import fs from "node:fs";
import path from "node:path";
import * as P from "./paths.mjs";
import { readText } from "./backup.mjs";

function chk(name, level, detail) {
  return { name, level, detail };
}

export function selfcheck() {
  const checks = [];
  const layout = P.layout();

  // 1. profile 目录
  const cfg = layout.configDir;
  checks.push(
    fs.existsSync(cfg)
      ? chk("profile", "pass", cfg)
      : chk("profile", "fail", `不存在: ${cfg}（WorkBuddy 是否启动过？）`)
  );

  // 2. app-config.json
  const ac = layout.appConfig;
  if (!fs.existsSync(ac)) {
    checks.push(chk("app-config", "warn", `不存在: ${ac}（personalization 注入面不可用）`));
  } else {
    try {
      const j = JSON.parse(fs.readFileSync(ac, "utf8"));
      checks.push(chk("app-config", "pass", `可解析；personalization=${j.personalization ? "有" : "无"}`));
    } catch (err) {
      checks.push(chk("app-config", "fail", `JSON 损坏: ${err.message}`));
    }
  }

  // 3. 安装目录 + 模板目录
  if (!layout.installDir) {
    checks.push(chk("install", "fail", "未定位 WorkBuddy 安装目录（可设 WORKBUDDY_INSTALL_DIR）"));
  } else {
    checks.push(chk("install", "pass", layout.installDir));
  }
  if (!layout.templatesDir) {
    checks.push(chk("templates", "fail", "未定位 resources/templates（宿主无明文模板 → 宿主补丁不可用）"));
  } else {
    const files = fs.readdirSync(layout.templatesDir).filter((f) => f.endsWith(".tpl"));
    checks.push(chk("templates", "pass", `${files.length} 个 .tpl`));
    // 4. 可写性
    try {
      const probe = path.join(layout.templatesDir, ".dsh-purge-write-probe");
      fs.writeFileSync(probe, "ok");
      fs.unlinkSync(probe);
      checks.push(chk("templates-writable", "pass", "可写"));
    } catch (err) {
      checks.push(chk("templates-writable", "fail", `不可写: ${err.message}（需管理员或检查 ACL）`));
    }
  }

  // 5. 注入有效性：system prompt 内联 或 customPrompt 段，任一生效即可
  const tplDir = layout.templatesDir;
  let inlineCount = 0;
  if (tplDir) {
    for (const f of fs.readdirSync(tplDir).filter((x) => x.startsWith("workbuddy-") && x.endsWith(".tpl"))) {
      const t = readText(path.join(tplDir, f)) || "";
      if (t.includes("{# dsh-purge:inline:system-prompt-inject:begin #}")) inlineCount++;
    }
  }
  const raw = readText(layout.appConfig) || "";
  const hasCp = raw.includes("<!-- dsh-purge:begin -->") && raw.includes("<!-- dsh-purge:end -->");

  if (inlineCount > 0) {
    checks.push(chk("injection", "pass", `system prompt 内联 ${inlineCount} 个模板${hasCp ? " + customPrompt" : "（customPrompt 已关闭，无冗余）"}`));
  } else if (hasCp) {
    checks.push(chk("injection", "pass", "customPrompt 注入段完整（未内联 system prompt）"));
  } else {
    checks.push(chk("injection", "warn", "两处注入通道均未生效（未 apply 或被清除）"));
  }

  // 7. 备份目录
  const bd = layout.backupDir;
  const tx = fs.existsSync(bd) ? fs.readdirSync(bd).filter((d) => fs.statSync(path.join(bd, d)).isDirectory()) : [];
  checks.push(chk("backup", tx.length ? "pass" : "warn", tx.length ? `${tx.length} 个事务` : "无备份（首次 apply 时创建）"));

  // 8. 插件资源完整
  for (const [label, dir] of [
    ["rules", P.pkgRulesDir()],
    ["skills", P.pkgSkillsDir()],
    ["agents", P.pkgAgentsDir()],
  ]) {
    const ok = fs.existsSync(dir);
    checks.push(chk(`pkg-${label}`, ok ? "pass" : "warn", ok ? dir : `缺失: ${dir}`));
  }

  const fails = checks.filter((c) => c.level === "fail");
  const warns = checks.filter((c) => c.level === "warn");
  const verdict = fails.length ? "fail" : warns.length ? "warn" : "pass";
  return {
    verdict,
    pass: checks.filter((c) => c.level === "pass").length,
    checks,
    layout,
  };
}

export default { selfcheck };
