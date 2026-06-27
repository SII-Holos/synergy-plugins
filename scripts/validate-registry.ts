import Ajv2020 from "ajv/dist/2020"
import addFormats from "ajv-formats"
import crypto, { subtle } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { buildRegistry } from "./build-registry"
import { validatePluginEntryFile } from "./validate-plugin-entry"

const root = path.resolve(import.meta.dir, "..")
const registryPath = path.join(root, "registry.json")
const registrySchemaPath = path.join(root, "schemas", "registry.schema.json")
const pluginsDir = path.join(root, "plugins")
const downloadTimeoutMs = Number(process.env.SYNERGY_REGISTRY_DOWNLOAD_TIMEOUT_MS ?? 900_000)
const maxIconBytes = 32 * 1024

function ajv() {
  const instance = new Ajv2020({ allErrors: true, strict: true })
  addFormats(instance)
  return instance
}

function stable(value: unknown) {
  return JSON.stringify(value, null, 2) + "\n"
}

async function validateRegistrySchema() {
  const schema = JSON.parse(await fs.readFile(registrySchemaPath, "utf8"))
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"))
  const validate = ajv().compile(schema)
  if (!validate(registry)) {
    throw new Error(`registry.json failed schema validation:\n${JSON.stringify(validate.errors, null, 2)}`)
  }
  return registry as { plugins: Array<{ id: string; entry: string }> }
}

async function download(url: string) {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(downloadTimeoutMs) })
      if (!response.ok) throw new Error(`status ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2_000))
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`GET ${url} failed after 3 attempts (${downloadTimeoutMs}ms each): ${message}`)
}

function sha256(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex")
}

function tarList(filepath: string) {
  const result = spawnSync("tar", ["-tzf", filepath], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(`Failed to list ${filepath}: ${result.stderr}`)
  return result.stdout
    .split("\n")
    .map((item) => item.replace(/^\.\//, "").replace(/\/$/, ""))
    .filter(Boolean)
}

function extractTar(filepath: string, outDir: string) {
  const result = spawnSync("tar", ["-xzf", filepath, "-C", outDir], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(`Failed to extract ${filepath}: ${result.stderr}`)
}

async function readJson(filepath: string) {
  return JSON.parse(await fs.readFile(filepath, "utf8"))
}

function validateSvgIconContent(pluginId: string, svg: string) {
  const forbidden = [
    { pattern: /<\s*script\b/i, label: "<script>" },
    { pattern: /<\s*foreignObject\b/i, label: "<foreignObject>" },
    { pattern: /<\s*image\b/i, label: "<image>" },
    { pattern: /\son[a-z]+\s*=/i, label: "event handlers" },
    { pattern: /\b(?:href|xlink:href)\s*=/i, label: "href references" },
    { pattern: /\bsrc\s*=\s*["']\s*(?:https?:|data:|javascript:)/i, label: "external or executable URLs" },
    { pattern: /@import\b/i, label: "CSS imports" },
    { pattern: /url\(\s*["']?(?:https?:|data:|javascript:)/i, label: "external CSS URLs" },
  ]
  if (!/<svg[\s>]/i.test(svg)) throw new Error(`${pluginId}: icon must be an SVG document`)
  for (const item of forbidden) {
    if (item.pattern.test(svg)) throw new Error(`${pluginId}: icon SVG cannot contain ${item.label}`)
  }
}

export async function validateRegistryIcon(entry: any, registryRoot = root) {
  if (!entry.icon) return
  if (entry.icon.type === "lucide") return
  if (entry.icon.type !== "registry-svg") throw new Error(`${entry.id}: unsupported icon type`)

  const expected = `icons/${entry.id}.svg`
  if (entry.icon.path !== expected) throw new Error(`${entry.id}: icon path must be ${expected}`)

  const iconPath = path.join(registryRoot, entry.icon.path)
  const stat = await fs.stat(iconPath).catch(() => null)
  if (!stat?.isFile()) throw new Error(`${entry.id}: icon file is missing: ${entry.icon.path}`)
  if (stat.size > maxIconBytes) throw new Error(`${entry.id}: icon SVG exceeds ${maxIconBytes} bytes`)

  validateSvgIconContent(entry.id, await fs.readFile(iconPath, "utf8"))
}

async function verifyEd25519(input: { publicKeyHex: string; signatureHex: string; payload: unknown }) {
  const publicKey = await subtle.importKey(
    "raw",
    Buffer.from(input.publicKeyHex, "hex"),
    "Ed25519" as any,
    false,
    ["verify"],
  )
  return subtle.verify(
    "Ed25519" as any,
    publicKey,
    Buffer.from(input.signatureHex, "hex"),
    new TextEncoder().encode(JSON.stringify(input.payload)),
  )
}

export async function validateArtifact(entry: any, version: any) {
  const artifact = await download(version.downloadUrl)
  const hash = sha256(artifact)
  if (version.integrity !== `sha256-${hash}`) {
    throw new Error(`${entry.id}@${version.version}: integrity mismatch`)
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "synergy-plugin-registry-"))
  const tarballPath = path.join(tmp, `${entry.id}-${version.version}.synergy-plugin.tgz`)
  await fs.writeFile(tarballPath, artifact)

  const files = new Set(tarList(tarballPath))
  for (const required of ["plugin.json", "runtime/index.js", "integrity.json", "permissions.summary.json"]) {
    if (!files.has(required)) throw new Error(`${entry.id}@${version.version}: missing ${required}`)
  }

  extractTar(tarballPath, tmp)
  const manifest = await readJson(path.join(tmp, "plugin.json"))
  if (manifest.name !== entry.id) throw new Error(`${entry.id}@${version.version}: manifest name mismatch`)
  if (manifest.version !== version.version) throw new Error(`${entry.id}@${version.version}: manifest version mismatch`)

  const signatureRaw = await download(version.signatureUrl)
  const signature = JSON.parse(signatureRaw.toString("utf8"))
  if (version.signature?.algorithm !== "ed25519") throw new Error(`${entry.id}@${version.version}: unsupported signature algorithm`)
  if (version.signature?.signer !== signature.signer) throw new Error(`${entry.id}@${version.version}: signature signer mismatch`)
  if (signature.algorithm !== "ed25519") throw new Error(`${entry.id}@${version.version}: signature metadata algorithm mismatch`)
  if (signature.pluginId !== entry.id) throw new Error(`${entry.id}@${version.version}: signature pluginId mismatch`)
  if (signature.version !== version.version) throw new Error(`${entry.id}@${version.version}: signature version mismatch`)
  if (signature.payload?.tarballHash !== hash) throw new Error(`${entry.id}@${version.version}: signature tarball hash mismatch`)
  if (signature.payload?.manifestHash !== version.manifestHash) {
    throw new Error(`${entry.id}@${version.version}: signature manifest hash mismatch`)
  }
  if (signature.payload?.permissionsHash !== version.permissionsHash) {
    throw new Error(`${entry.id}@${version.version}: signature permissions hash mismatch`)
  }
  const valid = await verifyEd25519({
    publicKeyHex: version.signature.signer,
    signatureHex: signature.signature,
    payload: signature.payload,
  })
  if (!valid) throw new Error(`${entry.id}@${version.version}: signature verification failed`)
}

async function validatePluginEntries() {
  const files = (await fs.readdir(pluginsDir).catch(() => [])).filter((name) => name.endsWith(".json")).sort()
  const entries = []
  for (const name of files) {
    const entry = await validatePluginEntryFile(path.join(pluginsDir, name))
    await validateRegistryIcon(entry)
    for (const version of entry.versions) await validateArtifact(entry, version)
    entries.push(entry)
  }
  return entries
}

async function main() {
  const registry = await validateRegistrySchema()
  const entries = await validatePluginEntries()
  const ids = new Set(entries.map((entry) => entry.id))

  for (const summary of registry.plugins) {
    if (!ids.has(summary.id)) throw new Error(`registry.json references missing entry ${summary.entry}`)
    if (summary.entry !== `plugins/${summary.id}.json`) throw new Error(`registry.json entry path mismatch for ${summary.id}`)
  }

  const generated = stable(await buildRegistry())
  const current = await fs.readFile(registryPath, "utf8")
  if (current !== generated) throw new Error("registry.json summary drift. Run `bun run build-registry`.")

  console.log(`OK registry.json (${entries.length} plugin entries)`)
}

if (import.meta.main) await main()
