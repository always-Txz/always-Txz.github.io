#!/usr/bin/env node
// dsh-purge-workbuddy :: CLI
// 用法：
//   node lib/cli.mjs status [--json]
//   node lib/cli.mjs apply  [--dry-run] [--only id1,id2] [--json]
//   node lib/cli.mjs revert [--json]
//   node lib/cli.mjs enable <id> <on|off>
//   node lib/cli.mjs patches
//   node lib/cli.mjs selfcheck
//   node lib/cli.mjs backup [list|prune --keep N]
//   node lib/cli.mjs install [--cn|--intl] [--dry-run]   ← 调 scripts/install.ps1
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as P from "./paths.mjs";
import * as patch from "./patch.mjs";
import { listTransactions, prune } from "./backup.mjs";
import { selfcheck } from "./selfcheck.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const cmd = argv[0] || "status";
const flags = {
  json: argv.includes("--json"),
  dryRun: argv.includes("--dry-run"),
};
const onlyArg = argv.find((a) => a.startsWith("--only"));
const only = onlyArg ? (onlyArg.split("=")[1] || argv[argv.indexOf(onlyArg) + 1] || "").split(",").filter(Boolean) : undefined;
const keepArg = argv.indexOf("--keep");
const keep = keepArg >= 0 ? Number(argv[keepArg + 1]) : 20;

function print(obj, human) {
  if (flags.json) {
    console.log(JSON.stringify(obj, null, 2));
    return;
  }
  if (human) {
    console.log(human);
    return;
  }
  console.log(JSON.stringify(obj, null, 2));
}

switch (cmd) {
  case "status": {
    const st = patch.status();
    const lines = [
      "── dsh-purge-workbuddy status ─────────────────────────────",
      `profile      : ${st.layout.configDir}`,
      `app-config   : ${st.layout.appConfig}`,
      `install      : ${st.layout.installDir}`,
      `templates    : ${st.layout.templatesDir}  (${st.tplFiles} .tpl)`,
      `backups      : ${st.layout.backupDir}`,
      `consistent   : ${st.consistent}${st.drift.length ? `  DRIFT=${st.drift.join(",")}` : ""}`,
      "",
      "补丁:",
      ...st.patches.map(
        (p) =>
          `  ${p.enabled ? "[on ]" : "[off]"} ${p.id.padEnd(22)} ` +
          (p.id === "custom-prompt" ? `effective=${p.effective}` : `${p.appliedFiles}/${p.totalFiles} 模板`)
      ),
    ];
    print(st, lines.join("\n"));
    break;
  }
  case "apply": {
    const r = patch.apply({ dryRun: flags.dryRun, only });
    const st = patch.status();
    print({ ...r, status: st }, [
      `apply ${r.ok ? "OK" : "PARTIAL"}${flags.dryRun ? " (dry-run)" : ""}`,
      ...r.actions.map((a) => `  ${JSON.stringify(a)}`),
      `consistent=${st.consistent}`,
    ].join("\n"));
    if (!r.ok) process.exitCode = 1;
    break;
  }
  case "revert": {
    const r = patch.revertAll();
    print(r, [
      `revert ${r.ok ? "OK" : "PARTIAL"}`,
      `  restored: ${r.restored.length}`,
      ...r.restored.map((f) => `    ${f}`),
      r.failed.length ? `  failed: ${r.failed.join("; ")}` : "",
      `  appConfig: ${JSON.stringify(r.appConfig)}`,
    ].filter(Boolean).join("\n"));
    break;
  }
  case "enable": {
    const id = argv[1];
    const on = (argv[2] || "").toLowerCase();
    if (!id || !["on", "off", "true", "false", "1", "0"].includes(on)) {
      console.error("usage: cli.mjs enable <patch-id> <on|off>");
      process.exit(2);
    }
    const res = patch.enable(id, ["on", "true", "1"].includes(on));
    print({ ok: true, flags: res, note: "接着跑 apply 生效" }, `flags: ${JSON.stringify(res)}\n接着跑: node lib/cli.mjs apply`);
    break;
  }
  case "patches": {
    const list = patch.patchList();
    print(list, [
      "可用补丁:",
      ...list.map((p) => `  ${p.default ? "[默认开]" : "[默认关]"} ${p.id.padEnd(24)} ${p.title}\n      ${p.desc}`),
    ].join("\n"));
    break;
  }
  case "selfcheck": {
    const s = selfcheck();
    print(s, [
      `selfcheck: ${s.verdict}  (${s.pass}/${s.checks.length} pass)`,
      ...s.checks.map((c) => `  [${c.level.padEnd(4)}] ${c.name.padEnd(22)} ${c.detail}`),
    ].join("\n"));
    if (s.verdict === "fail") process.exitCode = 1;
    break;
  }
  case "backup": {
    const sub = argv[1] || "list";
    if (sub === "prune") {
      const r = prune(keep);
      print(r, `kept=${r.kept} removed=${r.removed.length}`);
    } else {
      const list = listTransactions();
      print({ transactions: list }, ["备份事务:", ...list.map((t) => `  ${t.id}  files=${t.files}  ${t.createdAt}`)].join("\n"));
    }
    break;
  }
  case "paths": {
    print(P.layout(), Object.entries(P.layout()).map(([k, v]) => `${k.padEnd(13)}: ${v}`).join("\n"));
    break;
  }
  case "install": {
    const ps1 = path.join(P.pluginRoot(), "scripts", "install.ps1");
    const args = ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1];
    if (argv.includes("--cn")) args.push("-Cn");
    if (argv.includes("--dry-run")) args.push("-DryRun");
    try {
      execFileSync("pwsh", args, { stdio: "inherit" });
    } catch (err) {
      console.error(`install failed: ${err.message}`);
      process.exitCode = 1;
    }
    break;
  }
  default:
    console.error(`unknown command: ${cmd}`);
    console.error("命令: status | apply | revert | enable | patches | selfcheck | backup | paths | install");
    process.exit(2);
}
