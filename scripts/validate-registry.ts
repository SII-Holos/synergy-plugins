import Ajv2020 from "ajv/dist/2020"
import addFormats from "ajv-formats"
import crypto from "node:crypto"
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
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
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

async function validateArtifact(entry: any, version: any) {
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
  if (signature.pluginId !== entry.id) throw new Error(`${entry.id}@${version.version}: signature pluginId mismatch`)
  if (signature.version !== version.version) throw new Error(`${entry.id}@${version.version}: signature version mismatch`)
  if (signature.payload?.tarballHash !== hash) throw new Error(`${entry.id}@${version.version}: signature tarball hash mismatch`)
  if (signature.payload?.manifestHash !== version.manifestHash) {
    throw new Error(`${entry.id}@${version.version}: signature manifest hash mismatch`)
  }
  if (signature.payload?.permissionsHash !== version.permissionsHash) {
    throw new Error(`${entry.id}@${version.version}: signature permissions hash mismatch`)
  }
}

async function validatePluginEntries() {
  const files = (await fs.readdir(pluginsDir).catch(() => [])).filter((name) => name.endsWith(".json")).sort()
  const entries = []
  for (const name of files) {
    const entry = await validatePluginEntryFile(path.join(pluginsDir, name))
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

await main()
