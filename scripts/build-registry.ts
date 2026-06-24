import fs from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const pluginsDir = path.join(root, "plugins")
const registryPath = path.join(root, "registry.json")

type PluginEntry = {
  id: string
  name: string
  description: string
  repo: string
  author: { name: string; email?: string; url?: string }
  verified: boolean
  official: boolean
  keywords: string[]
  versions: Array<{
    version: string
    risk: "low" | "medium" | "high"
    runtimeMode: "in-process" | "worker" | "process"
    tools: string[]
    uiSurfaces: string[]
    publishedAt: string
  }>
}

function latestVersion(entry: PluginEntry) {
  return [...entry.versions].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0]
}

async function readEntries() {
  const names = (await fs.readdir(pluginsDir).catch(() => [])).filter((name) => name.endsWith(".json")).sort()
  const entries: PluginEntry[] = []
  for (const name of names) {
    const raw = await fs.readFile(path.join(pluginsDir, name), "utf8")
    entries.push(JSON.parse(raw) as PluginEntry)
  }
  return entries
}

export async function buildRegistry() {
  const entries = await readEntries()
  const summaries = entries.map((entry) => {
    const latest = latestVersion(entry)
    if (!latest) throw new Error(`Plugin ${entry.id} has no versions`)
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      repo: entry.repo,
      entry: `plugins/${entry.id}.json`,
      author: entry.author,
      verified: entry.verified,
      official: entry.official,
      keywords: [...entry.keywords].sort(),
      latestVersion: latest.version,
      updatedAt: latest.publishedAt,
      risk: latest.risk,
      runtimeMode: latest.runtimeMode,
      tools: [...latest.tools].sort(),
      uiSurfaces: [...latest.uiSurfaces].sort(),
    }
  })

  const updatedAt =
    summaries.length > 0
      ? summaries.map((plugin) => plugin.updatedAt).sort((a, b) => Date.parse(b) - Date.parse(a))[0]
      : "2026-06-25T00:00:00.000Z"

  return {
    schemaVersion: 1,
    updatedAt,
    plugins: summaries,
  }
}

function stable(value: unknown) {
  return JSON.stringify(value, null, 2) + "\n"
}

if (import.meta.main) {
  const check = process.argv.includes("--check")
  const next = stable(await buildRegistry())
  if (check) {
    const current = await fs.readFile(registryPath, "utf8").catch(() => "")
    if (current !== next) {
      console.error("registry.json is out of date. Run `bun run build-registry`.")
      process.exit(1)
    }
  } else {
    await fs.writeFile(registryPath, next)
    console.log("Updated registry.json")
  }
}
