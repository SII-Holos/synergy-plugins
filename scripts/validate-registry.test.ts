import { afterEach, describe, expect, test } from "bun:test"
import crypto, { subtle } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { validatePluginEntryFile } from "./validate-plugin-entry"
import { validateArtifact, validateRegistryIcon } from "./validate-registry"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function sha256(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex")
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
    schemaVersion: 1,
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
        downloadUrl: "https://example.test/test-plugin-1.0.0.synergy-plugin.tgz",
        signatureUrl: "https://example.test/test-plugin-1.0.0.synergy-plugin.tgz.sig",
        signature: {
          algorithm: "ed25519",
          signer: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        integrity: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        manifestHash: "manifest-hash",
        permissionsHash: "permissions-hash",
        risk: "low",
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

async function buildArtifact() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "synergy-registry-artifact-"))
  const packageDir = path.join(root, "package")
  await fs.mkdir(path.join(packageDir, "runtime"), { recursive: true })
  await fs.writeFile(path.join(packageDir, "plugin.json"), JSON.stringify({ name: "test-plugin", version: "1.0.0" }))
  await fs.writeFile(path.join(packageDir, "runtime", "index.js"), "export default {}\n")
  await fs.writeFile(path.join(packageDir, "integrity.json"), "{}\n")
  await fs.writeFile(path.join(packageDir, "permissions.summary.json"), "[]\n")
  const tarballPath = path.join(root, "test-plugin-1.0.0.synergy-plugin.tgz")
  const result = spawnSync("tar", ["-czf", tarballPath, "-C", packageDir, "."], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(result.stderr)
  return Buffer.from(await fs.readFile(tarballPath))
}

async function signedFixture() {
  const artifact = await buildArtifact()
  const key = await generateKeyPair()
  const payload = {
    tarballHash: sha256(artifact),
    manifestHash: "manifest-hash",
    permissionsHash: "permissions-hash",
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
  return { artifact, key, signature }
}

describe("plugin entry schema", () => {
  test("accepts an entry with registry-reviewed signature metadata", async () => {
    const filepath = await writeEntryFile(baseEntry())
    await expect(validatePluginEntryFile(filepath)).resolves.toMatchObject({ id: "test-plugin" })
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
    const { artifact, key, signature } = await signedFixture()
    globalThis.fetch = async (url) => {
      const target = String(url)
      if (target.endsWith(".sig")) return new Response(JSON.stringify(signature))
      return new Response(artifact)
    }

    await expect(
      validateArtifact({ id: "test-plugin" }, {
        ...baseEntry().versions[0],
        integrity: `sha256-${sha256(artifact)}`,
        signature: { algorithm: "ed25519", signer: key.publicKey },
      }),
    ).resolves.toBeUndefined()
  })

  test("rejects a signature whose signer does not match the registry entry", async () => {
    const { artifact, signature } = await signedFixture()
    globalThis.fetch = async (url) => {
      const target = String(url)
      if (target.endsWith(".sig")) return new Response(JSON.stringify(signature))
      return new Response(artifact)
    }

    await expect(
      validateArtifact({ id: "test-plugin" }, {
        ...baseEntry().versions[0],
        integrity: `sha256-${sha256(artifact)}`,
        signature: {
          algorithm: "ed25519",
          signer: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      }),
    ).rejects.toThrow("signature signer mismatch")
  })
})
