#!/usr/bin/env node
/**
 * scripts/fetch-typst.mjs — download the Typst compiler used by the renderer.
 *
 * The repository does not ship `resources/typst.exe` (a 50 MB binary, ignored by
 * `.gitignore`), so a fresh clone needs this step before preview/export works:
 *
 *   npm run fetch:typst              # download only if missing / wrong version
 *   npm run fetch:typst -- --force   # re-download even if it looks correct
 *   npm run fetch:typst -- --proxy http://127.0.0.1:7897   # explicit proxy
 *   npm run fetch:typst -- --no-proxy                      # ignore the environment
 *   npm run fetch:typst -- --help
 *
 * Behaviour
 *   - target    : `studio/resources/typst.exe` (override with `TYPST_DEST`)
 *   - source    : the official GitHub release asset
 *                 `typst-x86_64-pc-windows-msvc.zip` of Typst `TYPST_VERSION` (default 0.15.1)
 *   - integrity : the official archive is pinned by byte size **and** SHA-256
 *                 (`ASSET_SIZE` / `ASSET_SHA256` below): Typst publishes no `.sha256`
 *                 sidecar, so the values were computed once from the release asset and
 *                 are asserted on every download. A `TYPST_URL` override is a different
 *                 artifact and is therefore only version-checked after unpacking.
 *   - idempotent: if the local binary already reports the expected version it is
 *                 kept as-is and the script exits 0 without touching the network.
 *   - proxy     : `--proxy <url>` wins over `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`
 *                 (upper- or lower-case), CONNECT tunnelling included; `--no-proxy`
 *                 forces a direct connection. Node 22's global `fetch` ignores those
 *                 variables, so the transfer is built directly on
 *                 `node:https` + `node:net`.
 *   - offline   : `TYPST_URL` may point at a mirror, an intranet copy, or the plain
 *                 `.exe` attached to this project's own GitHub release.
 *   - unpacking : pure JavaScript (`node:zlib`), no `tar`, `unzip` or PowerShell.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import tls from "node:tls";
import https from "node:https";
import http from "node:http";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { pipeline } from "node:stream/promises";

const DEFAULT_VERSION = "0.15.1";
const UPSTREAM_REPO = "typst/typst";
/** Plain `.exe` attached to this repository's own release — no unzip step needed. */
const PROJECT_RELEASE_ASSET =
  "https://github.com/XXXXXQ-0206/prescription-master/releases/download/v1.0.0/typst-0.15.1-windows-x64.exe";
const CRLF = "\r\n";
/**
 * Fingerprint of the official `typst-x86_64-pc-windows-msvc.zip` release asset.
 * Computed once from the GitHub release (no `.sha256` sidecar is published) and
 * asserted on every download, so a tampered or silently re-uploaded archive cannot
 * replace the compiler. Update both values together with `DEFAULT_VERSION`.
 */
const ASSET_SIZE = 22463684;
const ASSET_SHA256 = "19ce3551153c2fe7ee9fa2f95208310c8f4d3209fedb699e0333faf8913f6736";

const root = path.resolve(import.meta.dirname, "..");
const dest = path.resolve(process.env.TYPST_DEST || path.join(root, "resources", "typst.exe"));
const version = process.env.TYPST_VERSION || DEFAULT_VERSION;
const versionUrl =
  `https://github.com/${UPSTREAM_REPO}/releases/download/v${version}/typst-x86_64-pc-windows-msvc.zip`;
const url = process.env.TYPST_URL || versionUrl;

const argv = process.argv.slice(2);
const force = argv.includes("--force") || argv.includes("-f");
const quiet = argv.includes("--quiet") || argv.includes("-q");
/** `--proxy <url>` (explicit) and `--no-proxy` (force direct) both beat the env. */
const proxyArg = argv.indexOf("--proxy") >= 0 ? argv[argv.indexOf("--proxy") + 1] : null;
const noProxyArg = argv.includes("--no-proxy");
if (argv.includes("--proxy") && !proxyArg) {
  console.error("✗ --proxy needs a URL, e.g. --proxy http://127.0.0.1:7897");
  process.exit(2);
}

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    fs
      .readFileSync(new URL(import.meta.url), "utf8")
      .split("*/")[0]
      .replace(/^#![^\n]*\n/, ""),
  );
  process.exit(0);
}

const log = (...args) => {
  if (!quiet) console.log(...args);
};

/* ────────────────────────────── local binary ────────────────────────────── */

/** `typst --version` output, or null when the binary is missing / not runnable. */
function localVersion() {
  if (!fs.existsSync(dest)) return null;
  try {
    return String(execFileSync(dest, ["--version"], { encoding: "utf8", timeout: 20000 })).trim();
  } catch {
    return null;
  }
}

const found = localVersion();
if (!force && found && found.includes(version)) {
  log(`✓ ${path.relative(process.cwd(), dest)} already present — ${found}`);
  log("  (use --force to re-download)");
  process.exit(0);
}
if (!force && found) {
  console.warn(
    `⚠ existing ${path.relative(process.cwd(), dest)} reports "${found}", expected Typst ${version} — replacing`,
  );
}

/* ──────────────────────────────── proxy ─────────────────────────────────── */

/** Proxy URL to use for a target, honouring --proxy / --no-proxy then NO_PROXY. Returns null for direct. */
function proxyFor(target) {
  if (noProxyArg) return null;
  if (proxyArg) {
    try {
      return new URL(proxyArg);
    } catch {
      throw new Error(`invalid --proxy URL: ${proxyArg}`);
    }
  }
  const noProxy = String(process.env.NO_PROXY || process.env.no_proxy || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const host = target.hostname;
  const bypassed = noProxy.some((entry) => {
    if (entry === "*") return true;
    const suffix = entry.replace(/^\./, "");
    return host === suffix || host.endsWith(`.${suffix}`);
  });
  if (bypassed) return null;
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  const raw = target.protocol === "https:" ? httpsProxy || httpProxy : httpProxy || httpsProxy;
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    throw new Error(`invalid proxy URL: ${raw}`);
  }
}

/** Minimal CONNECT-tunnelling agent so `https.request` works through an HTTP proxy. */
class ProxyAgent extends https.Agent {
  constructor(proxy) {
    super({ keepAlive: false });
    this.proxy = proxy;
  }

  createConnection(options, callback) {
    const target = `${options.host}:${options.port || 443}`;
    const { hostname, port } = this.proxy;
    const socket = net.connect(Number(port || 80), hostname);
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      callback(err);
    };
    socket.once("error", fail);
    socket.once("connect", () => {
      const credentials = this.proxy.username
        ? Buffer.from(
            `${decodeURIComponent(this.proxy.username)}:${decodeURIComponent(this.proxy.password)}`,
          ).toString("base64")
        : null;
      const auth = credentials ? `Proxy-Authorization: Basic ${credentials}${CRLF}` : "";
      socket.write(`CONNECT ${target} HTTP/1.1${CRLF}Host: ${target}${CRLF}${auth}${CRLF}`);
      let head = "";
      const onData = (chunk) => {
        head += chunk.toString("latin1");
        if (!head.includes(CRLF + CRLF)) return;
        socket.removeListener("data", onData);
        socket.removeListener("error", fail);
        const status = Number(head.slice(0, head.indexOf(CRLF)).split(" ")[1]);
        if (status !== 200) {
          fail(new Error(`proxy ${hostname}:${port} refused CONNECT (${head.split(CRLF)[0]})`));
          return;
        }
        settled = true;
        callback(null, tls.connect({ socket, servername: options.host }));
      };
      socket.on("data", onData);
    });
  }
}

/* ─────────────────────────────── download ──────────────────────────────── */

/** GET with redirect handling; resolves to the final response (body stream). */
function get(target, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) {
      reject(new Error(`too many redirects while fetching ${target.href}`));
      return;
    }
    const proxy = proxyFor(target);
    const mod = target.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: target.pathname + target.search,
        headers: {
          "user-agent": "prescription-master/fetch-typst",
          accept: "application/octet-stream",
        },
        ...(proxy ? { agent: new ProxyAgent(proxy) } : {}),
      },
      (res) => {
        const { statusCode, headers } = res;
        if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
          res.resume();
          resolve(get(new URL(headers.location, target), redirects + 1));
          return;
        }
        if (statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${statusCode} ${res.statusMessage || ""} for ${target.href}`));
          return;
        }
        resolve({ res, via: proxy ? `${proxy.protocol}//${proxy.host}` : "direct" });
      },
    );
    req.setTimeout(60000, () => req.destroy(new Error("connection timed out after 60 s")));
    req.on("error", reject);
    req.end();
  });
}

/* ──────────────────────────────── unzip ────────────────────────────────── */

/** Extract a single entry (matched by basename) out of an in-memory ZIP archive. */
function readZipEntry(buf, basename) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP archive (end-of-central-directory record not found)");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("corrupt ZIP: bad central-directory entry");
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    if (path.posix.basename(name).toLowerCase() === basename.toLowerCase() && !name.endsWith("/")) {
      if (compSize === 0xffffffff) throw new Error("ZIP64 archives are not supported");
      if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error("corrupt ZIP: bad local file header");
      const dataStart = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
      const raw = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return raw;
      if (method === 8) return zlib.inflateRawSync(raw);
      throw new Error(`unsupported ZIP compression method ${method}`);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${basename} not found inside the archive`);
}

/* ─────────────────────────────── guidance ──────────────────────────────── */

function manualInstructions(reason) {
  const relativeDest = path.relative(root, dest);
  console.error("");
  console.error(`✗ ${reason}`);
  console.error("");
  console.error("  How to obtain the Typst runtime manually (any one of these):");
  console.error("");
  console.error("  A. Behind a proxy — point the script at it explicitly:");
  console.error("       PowerShell : $env:HTTPS_PROXY='http://127.0.0.1:7897'; npm run fetch:typst -- --force");
  console.error("       cmd        : set HTTPS_PROXY=http://127.0.0.1:7897 && npm run fetch:typst -- --force");
  console.error("");
  console.error("  B. Download the official archive and unpack it yourself:");
  console.error(`       ${versionUrl}`);
  console.error(`       then copy the typst.exe it contains to ${relativeDest}`);
  console.error("");
  console.error("  C. Use the plain .exe attached to this project's GitHub release (no unzip needed):");
  console.error(`       ${PROJECT_RELEASE_ASSET}`);
  console.error(`       then save it as ${relativeDest}`);
  console.error("");
  console.error("  D. A local mirror or intranet copy:");
  console.error("       set TYPST_URL=https://<mirror>/typst-x86_64-pc-windows-msvc.zip && npm run fetch:typst -- --force");
  console.error("");
  console.error(`  Verify with: ${relativeDest} --version   (expect "typst ${version}")`);
  console.error("  Then render the templates: node scripts/render-all.mjs");
  console.error("");
}

/* ──────────────────────────────── main ─────────────────────────────────── */

const tmp = `${dest}.download`;
try {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  log(`↓ ${url}`);
  const { res, via } = await get(new URL(url));
  const total = Number(res.headers["content-length"] || 0);
  const mb = (n) => (n / 1024 / 1024).toFixed(1);
  let seen = 0;
  let nextMark = 0;
  res.on("data", (chunk) => {
    seen += chunk.length;
    if (quiet) return;
    const pct = total ? Math.floor((seen / total) * 100) : 0;
    if (pct < nextMark) return;
    nextMark = pct + 10;
    const progress = total ? `${pct}% ${mb(seen)} MB / ${mb(total)} MB` : `${mb(seen)} MB`;
    process.stdout.write(`\r  ${progress} (via ${via})   `);
  });
  await pipeline(res, fs.createWriteStream(tmp));
  if (!quiet) process.stdout.write("\n");
  const buf = fs.readFileSync(tmp);
  if (buf.length < 1024 * 1024) {
    throw new Error(`downloaded payload is suspiciously small (${buf.length} bytes)`);
  }

  // Integrity: the official archive is pinned by size + SHA-256. An overridden
  // TYPST_URL points at a different artifact, so it is only version-checked below.
  if (url === versionUrl) {
    const sha256 = createHash("sha256").update(buf).digest("hex");
    if (buf.length !== ASSET_SIZE || sha256 !== ASSET_SHA256) {
      throw new Error(
        `integrity check failed for the official archive\n` +
          `      expected ${ASSET_SIZE} bytes, sha256 ${ASSET_SHA256}\n` +
          `      received ${buf.length} bytes, sha256 ${sha256}`,
      );
    }
    log(`  ✓ sha256 ${sha256.slice(0, 16)}… matches the pinned official asset`);
  } else if (!quiet) {
    console.log("  note: TYPST_URL is overridden — the pinned official sha256 does not apply");
  }

  let binary;
  const magic = buf.subarray(0, 2).toString("latin1");
  if (magic === "MZ") {
    log(`  payload is a raw executable (${mb(buf.length)} MB)`);
    binary = buf;
  } else if (magic === "PK") {
    log(`  archive is ${mb(buf.length)} MB, extracting typst.exe…`);
    binary = readZipEntry(buf, "typst.exe");
  } else {
    throw new Error("payload is neither a ZIP archive nor a Windows executable (a login or error page?)");
  }
  if (binary.length < 10 * 1024 * 1024) {
    throw new Error(`extracted typst.exe looks truncated (${binary.length} bytes)`);
  }

  fs.rmSync(dest, { force: true });
  fs.writeFileSync(dest, binary);
  fs.rmSync(tmp, { force: true });

  const reported = localVersion();
  if (!reported || !reported.includes(version)) {
    throw new Error(`downloaded binary reports "${reported || "nothing"}", expected Typst ${version}`);
  }
  log(`✓ ${path.relative(root, dest)} — ${reported} (${mb(binary.length)} MB)`);
} catch (err) {
  fs.rmSync(tmp, { force: true });
  manualInstructions(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
