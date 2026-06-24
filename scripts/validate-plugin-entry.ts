import Ajv2020 from "ajv/dist/2020"
import addFormats from "ajv-formats"
import fs from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const schemaPath = path.join(root, "schemas", "plugin-entry.schema.json")

function ajv() {
  const instance = new Ajv2020({ allErrors: true, strict: true })
  addFormats(instance)
  return instance
}

function formatErrors(errors: unknown) {
  return JSON.stringify(errors, null, 2)
}

export async function validatePluginEntryFile(filepath: string) {
  const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"))
  const entry = JSON.parse(await fs.readFile(filepath, "utf8"))
  const validate = ajv().compile(schema)
  if (!validate(entry)) {
    throw new Error(`${filepath} failed schema validation:\n${formatErrors(validate.errors)}`)
  }

  const filename = path.basename(filepath, ".json")
  if (entry.id !== filename) throw new Error(`${filepath}: id must match file name`)
  if (entry.name !== entry.id) throw new Error(`${filepath}: name must match canonical id`)

  const seen = new Set<string>()
  for (const version of entry.versions) {
    if (seen.has(version.version)) throw new Error(`${filepath}: duplicate version ${version.version}`)
    seen.add(version.version)
  }

  return entry
}

if (import.meta.main) {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error("Usage: bun run scripts/validate-plugin-entry.ts plugins/<plugin-id>.json")
    process.exit(1)
  }

  for (const file of files) {
    await validatePluginEntryFile(path.resolve(file))
    console.log(`OK ${file}`)
  }
}
