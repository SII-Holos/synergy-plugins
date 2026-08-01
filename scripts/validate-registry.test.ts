import { afterEach, describe, expect, test } from "bun:test"
import crypto, { subtle } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { validatePluginEntryFile } from "./validate-plugin-entry"
import { validateArtifact, validateRegistryIcon } from "./validate-registry"
import { registrySummary, type PluginEntry } from "./build-registry"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function sha256(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex")
}

function sha256Text(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex")
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      result[key] = sortKeys(item)
    }
    return result
  }
  return value
}

function baseCapabilities(manifest: any) {
  const caps = new Set<string>()
  const pt = manifest.permissions?.tools
  const pd = manifest.permissions?.data
  const fsPermission = pt?.filesystem ?? "none"

  if (fsPermission === "read") caps.add("filesystem:read")
  if (fsPermission === "write") {
    caps.add("filesystem:read")
    caps.add("filesystem:write")
  }
  if (pt?.shell ?? false) caps.add("shell")
  if (pt?.network ?? false) caps.add("network")
  if (pt?.mcp === "invoke") caps.add("mcp:invoke")
  if (pt?.mcp === "spawn") {
    caps.add("mcp:invoke")
    caps.add("mcp:spawn")
  }
  if (pt?.task) caps.add("task")
  if ((pd?.session ?? "none") === "read") caps.add("session_data")
  if ((pd?.workspace ?? "none") === "read") caps.add("workspace_data")

  const config = pd?.config ?? "plugin"
  if (config === "global") {
    caps.add("config:read")
    caps.add("config:write")
  }
  if (config === "plugin") caps.add("config:read")
  if (pd?.secrets === "own") caps.add("secrets")

  return [...caps].sort()
}

function computedHashes(manifest: any) {
  if (manifest.apiVersion === "4.0") {
    return {
      manifestHash: sha256Text(JSON.stringify(sortKeys(manifest))),
      permissionsHash: api4PermissionsHash(manifest),
    }
  }
  return {
    manifestHash: sha256Text(JSON.stringify(sortKeys(manifest))),
    permissionsHash: sha256Text(
      JSON.stringify(
        sortKeys({
          capabilities: baseCapabilities(manifest),
          permissions: manifest.permissions ?? {},
          contributes: manifest.contributes ?? {},
          lifecycle: manifest.lifecycle ?? {},
        }),
      ),
    ),
  }
}

function api4PermissionsHash(manifest: any) {
  return sha256Text(
    JSON.stringify(
      sortKeys({
        capabilities: manifest.capabilities ?? [],
        contributionRequirements: (manifest.contributions ?? [])
          .filter(
            (item: any) =>
              Boolean(item.requires?.length) ||
              item.kind === "operation" ||
              (item.kind.startsWith("ui.") && Boolean(item.component)),
          )
          .map((item: any) => ({
            kind: item.kind,
            id: item.id,
            requires: item.requires ?? [],
            ...(item.kind === "operation" ? { expose: item.expose } : {}),
            ...(item.kind.startsWith("ui.") && item.component ? { trustedComponent: true } : {}),
          })),
      }),
    ),
  )
}

function api3PermissionsHash(manifest: any) {
  return sha256Text(
    JSON.stringify(
      sortKeys({
        capabilities: manifest.capabilities,
        contributionRequirements: manifest.contributions.map((item: any) => ({
          kind: item.kind,
          id: item.id,
          requires: item.requires ?? [],
          ...(item.kind === "operation" ? { expose: item.expose } : {}),
          ...(item.kind.startsWith("ui.") && item.component ? { trustedComponent: true } : {}),
        })),
      }),
    ),
  )
}

function legacyApi3PermissionsHash(manifest: any) {
  return sha256Text(
    JSON.stringify(
      sortKeys({
        capabilities: manifest.capabilities,
        requirements: manifest.contributions.map((item: any) => ({
          kind: item.kind,
          id: item.id,
          requires: item.requires ?? [],
        })),
      }),
    ),
  )
}

async function generateKeyPair() {
  const key = (await subtle.generateKey("Ed25519" as any, true, ["sign", "verify"])) as CryptoKeyPair
  const privateRaw = await subtle.exportKey("pkcs8", key.privateKey)
  const publicRaw = await subtle.exportKey("raw", key.publicKey)
  return {
    privateKey: Buffer.from(privateRaw as ArrayBuffer).toString("hex"),
    publicKey: Buffer.from(publicRaw as ArrayBuffer).toString("hex"),
  }
}

async function importPrivateKey(hex: string) {
  return subtle.importKey("pkcs8", Buffer.from(hex, "hex"), "Ed25519" as any, false, ["sign"])
}

async function writeEntryFile(entry: unknown) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "synergy-registry-entry-"))
  const filepath = path.join(dir, "test-plugin.json")
  await fs.writeFile(filepath, JSON.stringify(entry, null, 2))
  return filepath
}

function baseEntry(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    id: "test-plugin",
    name: "test-plugin",
    description: "Test plugin",
    repo: "https://github.com/example/test-plugin",
    author: { name: "Example" },
    verified: false,
    official: false,
    keywords: ["synergy-plugin"],
    compatibility: { synergy: ">=1.0.0" },
    versions: [
      {
        version: "1.0.0",
        apiVersion: "4.0",
        compatibility: { synergy: ">=3.0.0" },
        downloadUrl: "https://example.test/test-plugin-1.0.0.synergy-plugin.tgz",
        signatureUrl: "https://example.test/test-plugin-1.0.0.synergy-plugin.tgz.sig",
        signature: {
          algorithm: "ed25519",
          signer: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        integrity: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        manifestHash: "manifest-hash",
        permissionsHash: "permissions-hash",
        runtimeMode: "process",
        permissionsSummary: [],
        tools: [],
        uiSurfaces: [],
        publishedAt: "2026-06-25T00:00:00.000Z",
      },
    ],
    yankedVersions: [],
    ...overrides,
  }
}

function artifactManifest(overrides: Record<string, unknown> = {}) {
  return {
    manifestVersion: 1,
    apiVersion: "4.0",
    id: "test-plugin",
    name: "test-plugin",
    version: "1.0.0",
    description: "Test plugin",
    compatibility: { synergy: ">=3.0.0" },
    capabilities: [],
    contributions: [],
    artifacts: { generation: "test-generation" },
    ...overrides,
  }
}

async function buildArtifact(manifest = artifactManifest()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "synergy-registry-artifact-"))
  const packageDir = path.join(root, "package")
  await fs.mkdir(path.join(packageDir, "runtime"), { recursive: true })
  await fs.writeFile(path.join(packageDir, "plugin.json"), JSON.stringify(manifest, null, 2))
  await fs.writeFile(path.join(packageDir, "runtime", "index.js"), "export default {}\n")
  await fs.writeFile(path.join(packageDir, "integrity.json"), "{}\n")
  await fs.writeFile(path.join(packageDir, "permissions.summary.json"), "[]\n")
  const tarballPath = path.join(root, "test-plugin-1.0.0.synergy-plugin.tgz")
  const result = spawnSync("tar", ["-czf", tarballPath, "-C", packageDir, "."], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(result.stderr)
  return Buffer.from(await fs.readFile(tarballPath))
}

async function signedFixture(input: { manifest?: Record<string, unknown>; payload?: Record<string, unknown> } = {}) {
  const manifest = input.manifest ?? artifactManifest()
  const artifact = await buildArtifact(manifest)
  const key = await generateKeyPair()
  const hashes = computedHashes(manifest)
  const payload = {
    tarballHash: sha256(artifact),
    ...hashes,
    ...input.payload,
  }
  const privateKey = await importPrivateKey(key.privateKey)
  const signatureRaw = await subtle.sign("Ed25519" as any, privateKey, new TextEncoder().encode(JSON.stringify(payload)))
  const signature = {
    signatureVersion: 1,
    pluginId: "test-plugin",
    version: "1.0.0",
    algorithm: "ed25519",
    signer: key.publicKey,
    signature: Buffer.from(signatureRaw as ArrayBuffer).toString("hex"),
    signedAt: Date.now(),
    payload,
  }
  return { artifact, key, signature, hashes }
}

describe("plugin entry schema", () => {
  test("accepts an entry with registry-reviewed signature metadata", async () => {
    const filepath = await writeEntryFile(baseEntry())
    await expect(validatePluginEntryFile(filepath)).resolves.toMatchObject({ id: "test-plugin" })
  })

  test("rejects legacy risk fields in registry v2", async () => {
    const entry = baseEntry({
      versions: [{ ...baseEntry().versions[0], risk: "high" }],
    })
    await expect(validatePluginEntryFile(await writeEntryFile(entry))).rejects.toThrow("failed schema validation")
  })

  test("rejects entries missing version signature metadata", async () => {
    const entry = baseEntry({
      versions: [
        {
          ...baseEntry().versions[0],
          signature: undefined,
        },
      ],
    })
    const filepath = await writeEntryFile(entry)
    await expect(validatePluginEntryFile(filepath)).rejects.toThrow("failed schema validation")
  })

  test("rejects bad signer shapes", async () => {
    const entry = baseEntry({
      versions: [
        {
          ...baseEntry().versions[0],
          signature: { algorithm: "ed25519", signer: "not-a-key" },
        },
      ],
    })
    const filepath = await writeEntryFile(entry)
    await expect(validatePluginEntryFile(filepath)).rejects.toThrow("failed schema validation")
  })

  test("accepts lucide and registry SVG icon metadata", async () => {
    await expect(validatePluginEntryFile(await writeEntryFile(baseEntry({ icon: { type: "lucide", name: "image" } })))).resolves.toMatchObject({
      icon: { type: "lucide", name: "image" },
    })
    await expect(
      validatePluginEntryFile(
        await writeEntryFile(baseEntry({ icon: { type: "registry-svg", path: "icons/test-plugin.svg" } })),
      ),
    ).resolves.toMatchObject({ icon: { type: "registry-svg", path: "icons/test-plugin.svg" } })
  })

  test("rejects invalid icon metadata", async () => {
    const filepath = await writeEntryFile(baseEntry({ icon: { type: "registry-svg", path: "../icon.svg" } }))
    await expect(validatePluginEntryFile(filepath)).rejects.toThrow("failed schema validation")
  })
})

describe("registry v2 default candidates", () => {
  test("keeps API3 history but selects only a non-yanked API4 version", () => {
    const entry = baseEntry({
      versions: [
        { ...baseEntry().versions[0], version: "3.9.0", apiVersion: "3.0", publishedAt: "2026-07-01T00:00:00.000Z" },
        { ...baseEntry().versions[0], version: "4.0.0", apiVersion: "4.0", publishedAt: "2026-07-02T00:00:00.000Z" },
      ],
    }) as PluginEntry
    expect(registrySummary(entry)).toMatchObject({
      latestVersion: "4.0.0",
      apiVersion: "4.0",
    })
  })

  test("does not expose API3 history as a default install candidate", () => {
    const entry = baseEntry({
      versions: [{ ...baseEntry().versions[0], apiVersion: "3.0" }],
    }) as PluginEntry
    expect(registrySummary(entry)).not.toHaveProperty("latestVersion")
  })
})

describe("registry icon validation", () => {
  async function registryWithIcon(content: string, pluginId = "test-plugin") {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "synergy-registry-icon-"))
    await fs.mkdir(path.join(dir, "icons"), { recursive: true })
    await fs.writeFile(path.join(dir, "icons", `${pluginId}.svg`), content)
    return dir
  }

  test("accepts a safe registry SVG icon", async () => {
    const dir = await registryWithIcon('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#111" d="M8 8h48v48H8z"/></svg>')
    await expect(
      validateRegistryIcon({ id: "test-plugin", icon: { type: "registry-svg", path: "icons/test-plugin.svg" } }, dir),
    ).resolves.toBeUndefined()
  })

  test("rejects icon paths that do not match the plugin id", async () => {
    const dir = await registryWithIcon('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"/>')
    await expect(
      validateRegistryIcon({ id: "test-plugin", icon: { type: "registry-svg", path: "icons/other-plugin.svg" } }, dir),
    ).rejects.toThrow("icon path must be icons/test-plugin.svg")
  })

  test("rejects unsafe SVG content", async () => {
    const dir = await registryWithIcon('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    await expect(
      validateRegistryIcon({ id: "test-plugin", icon: { type: "registry-svg", path: "icons/test-plugin.svg" } }, dir),
    ).rejects.toThrow("icon SVG cannot contain <script>")
  })
})

describe("artifact validation", () => {
  test("verifies artifact integrity and Ed25519 signature with the registry signer", async () => {
    const { artifact, key, signature, hashes } = await signedFixture()
    globalThis.fetch = async (url) => {
      const target = String(url)
      if (target.endsWith(".sig")) return new Response(JSON.stringify(signature))
      return new Response(artifact)
    }

    await expect(
      validateArtifact({ id: "test-plugin" }, {
        ...baseEntry().versions[0],
        integrity: `sha256-${sha256(artifact)}`,
        manifestHash: hashes.manifestHash,
        permissionsHash: hashes.permissionsHash,
        signature: { algorithm: "ed25519", signer: key.publicKey },
      }),
    ).resolves.toBeUndefined()
  })

  test("uses the API3 manifest id when name is a display label", async () => {
    const manifest = artifactManifest({
      apiVersion: "3.0",
      id: "test-plugin",
      name: "Test Plugin",
      capabilities: [{ id: "shell.execute" }],
      contributions: [
        {
          kind: "operation",
          id: "configure",
          requires: ["shell.execute"],
          expose: ["tool"],
        },
        {
          kind: "ui.workbenchPanel",
          id: "settings",
          requires: [],
          component: { entry: "ui/index.js", export: "Settings" },
        },
      ],
    })
    const permissionsHash = api3PermissionsHash(manifest)
    const { artifact, key, signature, hashes } = await signedFixture({
      manifest,
      payload: {
        permissionsHash,
      },
    })
    globalThis.fetch = async (url) => {
      const target = String(url)
      if (target.endsWith(".sig")) return new Response(JSON.stringify(signature))
      return new Response(artifact)
    }

    await expect(
      validateArtifact({ id: "test-plugin" }, {
        ...baseEntry().versions[0],
        apiVersion: "3.0",
        compatibility: { synergy: ">=3.0.0" },
        integrity: `sha256-${sha256(artifact)}`,
        manifestHash: hashes.manifestHash,
        permissionsHash,
        signature: { algorithm: "ed25519", signer: key.publicKey },
      }),
    ).resolves.toBeUndefined()
  })

  test("retains validation for historical API3 permissions hashes", async () => {
    const manifest = artifactManifest({
      apiVersion: "3.0",
      id: "test-plugin",
      name: "Test Plugin",
      capabilities: [{ id: "shell.execute" }],
      contributions: [
        {
          kind: "cli.command",
          id: "setup",
          requires: ["shell.execute"],
        },
      ],
    })
    const permissionsHash = legacyApi3PermissionsHash(manifest)
    const { artifact, key, signature, hashes } = await signedFixture({
      manifest,
      payload: {
        permissionsHash,
      },
    })
    globalThis.fetch = async (url) => {
      const target = String(url)
      if (target.endsWith(".sig")) return new Response(JSON.stringify(signature))
      return new Response(artifact)
    }

    await expect(
      validateArtifact({ id: "test-plugin" }, {
        ...baseEntry().versions[0],
        apiVersion: "3.0",
        compatibility: { synergy: ">=3.0.0" },
        integrity: `sha256-${sha256(artifact)}`,
        manifestHash: hashes.manifestHash,
        permissionsHash,
        signature: { algorithm: "ed25519", signer: key.publicKey },
      }),
    ).resolves.toBeUndefined()
  })

  test("rejects a signature whose signer does not match the registry entry", async () => {
    const { artifact, signature, hashes } = await signedFixture()
    globalThis.fetch = async (url) => {
      const target = String(url)
      if (target.endsWith(".sig")) return new Response(JSON.stringify(signature))
      return new Response(artifact)
    }

    await expect(
      validateArtifact({ id: "test-plugin" }, {
        ...baseEntry().versions[0],
        integrity: `sha256-${sha256(artifact)}`,
        manifestHash: hashes.manifestHash,
        permissionsHash: hashes.permissionsHash,
        signature: {
          algorithm: "ed25519",
          signer: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      }),
    ).rejects.toThrow("signature signer mismatch")
  })

  test("rejects a permissions hash that does not match the artifact manifest", async () => {
    const { artifact, key, signature, hashes } = await signedFixture({
      manifest: artifactManifest({
        permissions: {
          tools: {
            invoke: true,
            filesystem: "read",
            network: false,
            shell: false,
            mcp: "none",
            task: { agents: ["planner"], maxRuntimeMs: 30000 },
          },
        },
      }),
      payload: { permissionsHash: "old-permissions-hash" },
    })
    globalThis.fetch = async (url) => {
      const target = String(url)
      if (target.endsWith(".sig")) return new Response(JSON.stringify(signature))
      return new Response(artifact)
    }

    await expect(
      validateArtifact({ id: "test-plugin" }, {
        ...baseEntry().versions[0],
        integrity: `sha256-${sha256(artifact)}`,
        manifestHash: hashes.manifestHash,
        permissionsHash: "old-permissions-hash",
        signature: { algorithm: "ed25519", signer: key.publicKey },
      }),
    ).rejects.toThrow("permissions hash mismatch")
  })
})
