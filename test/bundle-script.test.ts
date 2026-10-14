import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const script = fileURLToPath(new URL("../scripts/build-local-bundle.mjs", import.meta.url))

describe("local bundle arguments", () => {
  for (const flag of ["--unknown", "--toString", "language"]) {
    it(`rejects an unsupported pin ${flag} before building or fetching`, () => {
      const result = spawnSync(process.execPath, [script, flag, "1.0.0"], {
        encoding: "utf8",
        timeout: 5000
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("unknown pin")
    })
  }

  for (const args of [["--language"], ["--language", "--state", "6.7.6"]]) {
    it(`rejects a missing version: ${args.join(" ")}`, () => {
      const result = spawnSync(process.execPath, [script, ...args], {
        encoding: "utf8",
        timeout: 5000
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("missing version for --language")
    })
  }
})
