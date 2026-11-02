#!/usr/bin/env node
// dsh-purge-workbuddy :: MCP server (零依赖 stdio JSON-RPC)
// 暴露 WorkBuddy 可调用的 purge 工具面：status / apply / revert / enable / backup / selfcheck / diagnose
// 协议：JSON-RPC 2.0 over stdio，逐行（\n 分隔）。兼容 MCP 2024-11-05 initialize / tools/list / tools/call。
import readline from "node:readline";
import * as P from "../lib/paths.mjs";
import * as patch from "../lib/patch.mjs";
import { listTransactions, prune } from "../lib/backup.mjs";
import { selfcheck } from "../lib/selfcheck.mjs";

const SERVER_INFO = { name: "dsh-purge-workbuddy", version: "1.6.67-wb.1" };
const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "purge_status",
    description: "查询 dsh-purge 在 WorkBuddy 的生效状态：补丁开关、模板命中数、配置注入、路径布局、漂移检测。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "purge_apply",
    description:
      "按当前开关应用全部补丁（宿主 prompt 模板 + personalization.customPrompt）。幂等；改前自动建备份事务。dryRun=true 只预演不落盘。",
    inputSchema: {
      type: "object",
      properties: {
        dryRun: { type: "boolean", description: "只预演，不写文件" },
        only: { type: "array", items: { type: "string" }, description: "只应用指定补丁 id" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "purge_revert",
    description: "还原：关闭全部补丁，模板从备份事务还原，customPrompt 摘掉注入段（用户自写内容保留）。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "purge_enable",
    description: "开关单个补丁（不立即应用；随后调用 purge_apply 生效）。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "补丁 id，见 purge_status.patches[].id" },
        on: { type: "boolean", description: "true=启用 false=关闭" },
      },
      required: ["id", "on"],
      additionalProperties: false,
    },
  },
  {
    name: "purge_backup",
    description: "列出/清理备份事务。action=list 列出；action=prune 只保留最近 keep 个。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "prune"] },
        keep: { type: "number", description: "prune 保留数量，默认 20" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "purge_selfcheck",
    description: "自检：路径可写性、模板可定位、注入段完整性、备份可用性、升级后漂移。返回 pass/warn/fail 清单。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "purge_diagnose",
    description: "深度诊断：列出所有模板文件与各补丁命中明细，便于排查“升级后失效”。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function textResult(obj) {
  return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}

function call(name, args = {}) {
  switch (name) {
    case "purge_status":
      return textResult(patch.status());
    case "purge_apply": {
      const r = patch.apply({ dryRun: !!args.dryRun, only: args.only });
      return textResult({ ...r, status: patch.status() });
    }
    case "purge_revert":
      return textResult({ ...patch.revertAll(), status: patch.status() });
    case "purge_enable":
      return textResult({ ok: true, flags: patch.enable(args.id, args.on), note: "调用 purge_apply 生效" });
    case "purge_backup": {
      const action = args.action || "list";
      if (action === "prune") return textResult(prune(typeof args.keep === "number" ? args.keep : 20));
      return textResult({ transactions: listTransactions() });
    }
    case "purge_selfcheck":
      return textResult(selfcheck());
    case "purge_diagnose": {
      const st = patch.status();
      return textResult({
        layout: st.layout,
        patches: st.patches,
        templateHits: st.patches
          .filter((p) => p.id !== "custom-prompt")
          .map((p) => ({ id: p.id, appliedFiles: p.appliedFiles, totalFiles: p.totalFiles })),
      });
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  const raw = line.trim();
  if (!raw) return;
  let req;
  try {
    req = JSON.parse(raw);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  const id = req.id === undefined ? null : req.id;

  try {
    switch (req.method) {
      case "initialize":
        send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        });
        break;
      case "notifications/initialized":
        // 通知无需响应
        break;
      case "ping":
        send({ jsonrpc: "2.0", id, result: {} });
        break;
      case "tools/list":
        send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
        break;
      case "tools/call": {
        const name = req.params?.name;
        const args = req.params?.arguments || {};
        try {
          const r = call(name, args);
          send({ jsonrpc: "2.0", id, result: r });
        } catch (err) {
          send({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true },
          });
        }
        break;
      }
      default:
        if (id !== null) {
          send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${req.method}` } });
        }
    }
  } catch (err) {
    send({ jsonrpc: "2.0", id, error: { code: -32603, message: err.message } });
  }
});

rl.on("close", () => process.exit(0));

// 启动即自检一次，把结论写 stderr（不污染 stdio 协议流）
try {
  const s = selfcheck();
  process.stderr.write(`[dsh-purge-workbuddy] MCP ready; selfcheck ${s.verdict} (${s.pass}/${s.checks.length} pass)\n`);
} catch {
  /* ignore */
}
