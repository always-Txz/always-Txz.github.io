#!/usr/bin/env node
// dsh-purge-workbuddy :: SessionStart 修复器
// 场景：WorkBuddy 升级会整体覆盖 resources/app.asar.unpacked，模板补丁丢失。
// 本脚本在每次会话启动时检查漂移，漂移即重打；任何异常都 exit 0（绝不影响启动）。
//
// 等价 dsh-purge-community 的 lib/reapply.js（升级后自动重打）+ lib/settle-policy.js（fail-open）。
// 注意：本文件位于 hooks/dist/，插件 lib/ 在 ../../lib/。
import * as patch from "../../lib/patch.mjs";

try {
  const st = patch.status();
  const flags = patch.getFlags();
  const wanted = Object.keys(flags).filter((k) => flags[k]);

  // 无任何补丁被启用 → 什么都不做（尊重用户关闭）
  if (!wanted.length) {
    process.stderr.write("[dsh-purge] SessionStart: all patches disabled, skip\n");
    process.exit(0);
  }

  // 漂移：启用但没有生效
  const drifting = st.patches.filter((p) => p.enabled && !p.effective).map((p) => p.id);
  if (!drifting.length) {
    process.stderr.write("[dsh-purge] SessionStart: no drift\n");
    process.exit(0);
  }

  const r = patch.apply({ only: drifting });
  process.stderr.write(
    `[dsh-purge] SessionStart: repaired ${drifting.join(",")} -> ${r.ok ? "ok" : "partial"} (touched ${r.touched.length})\n`
  );

  // 修复后仍不一致 → 记一次诊断，不阻塞
  const after = patch.status();
  if (!after.consistent) {
    process.stderr.write(`[dsh-purge] SessionStart: still drifting ${after.drift.join(",")}\n`);
  }
  process.exit(0);
} catch (err) {
  process.stderr.write(`[dsh-purge] SessionStart: fail-open (${err && err.message})\n`);
  process.exit(0);
}
