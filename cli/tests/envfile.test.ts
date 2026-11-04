import { describe, expect, it } from "vitest";

import { mergeEnv, parseEnv } from "../src/envfile.js";

describe("parseEnv", () => {
  it("reads plain, quoted and exported values and skips comments", () => {
    const env = parseEnv('# c\nA=1\nexport B="two"\nC=\'3\'\nnot a line\n');
    expect(Object.fromEntries(env)).toEqual({ A: "1", B: "two", C: "3" });
  });
});

describe("mergeEnv", () => {
  it("keeps existing values, fills empty ones and appends the rest", () => {
    const r = mergeEnv("OTHER=x\nUSERBOX_API_KEY=old\nAPP_ORIGIN=\n", {
      USERBOX_API_KEY: "new",
      APP_ORIGIN: "http://localhost:3000",
      USERBOX_TENANT_ID: "t",
    });
    expect(r.kept).toEqual(["USERBOX_API_KEY"]);
    expect(r.added).toEqual(["APP_ORIGIN", "USERBOX_TENANT_ID"]);
    expect(r.text).toBe(
      "OTHER=x\nUSERBOX_API_KEY=old\nAPP_ORIGIN=http://localhost:3000\n\n# Userbox (written by `userbox init`)\nUSERBOX_TENANT_ID=t\n",
    );
  });

  it("replaces a forced key in place", () => {
    const r = mergeEnv("USERBOX_API_KEY=old\n", { USERBOX_API_KEY: "new" }, new Set(["USERBOX_API_KEY"]));
    expect(r.replaced).toEqual(["USERBOX_API_KEY"]);
    expect(r.text).toBe("USERBOX_API_KEY=new\n");
  });

  it("writes a fresh file", () => {
    expect(mergeEnv("", { A: "1" }).text).toBe("# Userbox (written by `userbox init`)\nA=1\n");
  });
});
