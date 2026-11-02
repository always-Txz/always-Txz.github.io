// dsh-purge-workbuddy :: backup
// 原子写 + 带时间戳备份 + 可回滚事务。
// 移植自 dsh-purge-community lib/atomic-files.js、rollback-transaction.js、remove-tree.js。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as P from "./paths.mjs";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** 原子写：先写临时文件再 rename，避免半截文件。 */
export function writeAtomic(file, content) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

export function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * 为一批文件建一个备份事务目录。
 * 返回 { id, dir, entries:[{file, existed, backupPath, sha256}] }
 */
export function createTransaction(files) {
  const id = `${stamp()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(P.backupDir(), id);
  ensureDir(dir);

  const entries = files.map((file, i) => {
    const rel = `${String(i).padStart(3, "0")}-${path.basename(file)}`;
    const dest = path.join(dir, rel);
    if (fs.existsSync(file)) {
      const buf = fs.readFileSync(file);
      fs.writeFileSync(dest, buf);
      return { file, existed: true, backupPath: dest, sha256: sha256(buf), size: buf.length };
    }
    return { file, existed: false, backupPath: null, sha256: null, size: 0 };
  });

  const manifest = {
    id,
    createdAt: new Date().toISOString(),
    configDir: P.configDir(),
    installDir: P.installDir(),
    entries,
  };
  writeAtomic(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { id, dir, entries, manifest };
}

/** 回滚一个事务：existed 的还原原字节，原本不存在的删掉（若被创建过）。 */
export function rollback(transactionId) {
  const dir = path.join(P.backupDir(), transactionId);
  const manifestPath = path.join(dir, "manifest.json");
  const raw = readText(manifestPath);
  if (!raw) throw new Error(`backup not found: ${transactionId}`);
  const manifest = JSON.parse(raw);

  const done = [];
  const failed = [];
  for (const e of manifest.entries) {
    try {
      if (e.existed) {
        const buf = fs.readFileSync(e.backupPath);
        writeAtomic(e.file, buf);
        done.push(`${e.file} (restored)`);
      } else if (fs.existsSync(e.file)) {
        fs.unlinkSync(e.file);
        done.push(`${e.file} (removed)`);
      } else {
        done.push(`${e.file} (no-op)`);
      }
    } catch (err) {
      failed.push(`${e.file}: ${err.message}`);
    }
  }
  return { transactionId, restored: done, failed };
}

export function listTransactions() {
  const base = P.backupDir();
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const manifest = readText(path.join(base, d.name, "manifest.json"));
      let info = { id: d.name, files: 0, createdAt: null };
      if (manifest) {
        try {
          const m = JSON.parse(manifest);
          info.files = m.entries.length;
          info.createdAt = m.createdAt;
        } catch {
          /* ignore */
        }
      }
      return info;
    })
    .sort((a, b) => (a.id < b.id ? 1 : -1));
}

export function prune(keep = 20) {
  const all = listTransactions();
  const drop = all.slice(keep);
  for (const t of drop) {
    try {
      fs.rmSync(path.join(P.backupDir(), t.id), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  return { kept: all.length - drop.length, removed: drop.map((t) => t.id) };
}

export function logAudit(event, detail) {
  const line = JSON.stringify({ at: new Date().toISOString(), event, detail }) + "\n";
  ensureDir(path.dirname(P.auditPath()));
  fs.appendFileSync(P.auditPath(), line, "utf8");
}
