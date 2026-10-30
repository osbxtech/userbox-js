// Tests for check-contract.mjs: a drifted description must fail and name the call.
// Run with: node --test "scripts/*.test.mjs"
//
// Every fixture is a copy of the vendored contract/tenant-openapi.json with one
// change, so the tests need no network and follow the real description.

import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { allowedUrl, checkContract } from "./check-contract.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "check-contract.mjs");
const VENDORED = JSON.parse(readFileSync(join(ROOT, "contract", "tenant-openapi.json"), "utf8"));
const CALLS = JSON.parse(readFileSync(join(ROOT, "contract", "calls.json"), "utf8"));

const work = mkdtempSync(join(tmpdir(), "check-contract-test-"));
after(() => rmSync(work, { recursive: true, force: true }));

let counter = 0;
function fixture(mutate) {
  const doc = structuredClone(VENDORED);
  mutate?.(doc);
  const file = join(work, `d${counter++}.json`);
  writeFileSync(file, JSON.stringify(doc));
  return file;
}

function check(description) {
  return spawnSync(process.execPath, [SCRIPT, "--description", description], { encoding: "utf8" });
}

// The schema behind a 2xx JSON response, followed through one local $ref.
function responseSchema(doc, method, path) {
  const schema = doc.paths[path][method].responses["200"].content["application/json"].schema;
  return schema.$ref ? doc.components.schemas[schema.$ref.split("/").pop()] : schema;
}

function requestSchema(doc, method, path) {
  const schema = doc.paths[path][method].requestBody.content["application/json"].schema;
  return schema.$ref ? doc.components.schemas[schema.$ref.split("/").pop()] : schema;
}

test("SC-009: a field react reads removed from GET /v1/users/me fails and names the call", () => {
  const usersMe = CALLS.find((c) => c.package === "react" && c.operation === "GET /v1/users/me");
  const field = usersMe.reads[0];
  assert.ok(field, "calls.json must list at least one field react reads from GET /v1/users/me");
  const res = check(
    fixture((doc) => {
      const schema = responseSchema(doc, "get", "/v1/users/me");
      delete schema.properties[field];
      schema.required = (schema.required ?? []).filter((r) => r !== field);
    }),
  );
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stdout, new RegExp(`^react GET /v1/users/me: response field '${field}' not in 2xx schema$`, "m"));
});

test("a removed operation fails for every package that calls it", () => {
  const res = check(fixture((doc) => delete doc.paths["/v1/access/permissions"]));
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stdout, /^react GET \/v1\/access\/permissions: operation not in description$/m);
  assert.match(res.stdout, /^node GET \/v1\/access\/permissions: operation not in description$/m);
});

test("a new required body property fails", () => {
  const res = check(
    fixture((doc) => {
      const schema = requestSchema(doc, "post", "/v1/auth/refresh");
      schema.properties.device_id = { type: "string" };
      schema.required = [...(schema.required ?? []), "device_id"];
    }),
  );
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stdout, /^react POST \/v1\/auth\/refresh: required body property 'device_id' not sent$/m);
});

test("a new required query parameter fails", () => {
  const res = check(
    fixture((doc) => {
      doc.paths["/v1/memberships"].get.parameters.push({
        in: "query",
        name: "workspace_scope",
        required: true,
        schema: { type: "string" },
      });
    }),
  );
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stdout, /^node GET \/v1\/memberships: required query parameter 'workspace_scope' not sent$/m);
});

test("a field reached through allOf counts as present", () => {
  const usersMe = CALLS.find((c) => c.package === "react" && c.operation === "GET /v1/users/me");
  const res = check(
    fixture((doc) => {
      const schema = responseSchema(doc, "get", "/v1/users/me");
      const moved = Object.fromEntries(usersMe.reads.map((f) => [f, schema.properties[f]]));
      for (const f of usersMe.reads) delete schema.properties[f];
      doc.components.schemas.UserMeBase = { type: "object", properties: moved };
      schema.allOf = [{ $ref: "#/components/schemas/UserMeBase" }];
    }),
  );
  assert.doesNotMatch(res.stdout, /GET \/v1\/users\/me/);
});

test("an empty 2xx schema declares no field", () => {
  const doc = structuredClone(VENDORED);
  doc.paths["/v1/users/me"].get.responses["200"].content["application/json"].schema = {};
  const problems = checkContract(doc, CALLS.filter((c) => c.operation === "GET /v1/users/me"));
  assert.ok(problems.length > 0);
  assert.ok(problems.every((p) => p.startsWith("react GET /v1/users/me: response field ")));
});

test("http://example.com is refused with exit 2", () => {
  const res = check("http://example.com/openapi/tenant.json");
  assert.equal(res.status, 2);
  assert.match(res.stderr, /refused URL http:\/\/example\.com/);
  assert.equal(res.stdout, "");
});

test("only https, or http to a loopback host, is allowed", () => {
  assert.ok(allowedUrl("https://api.example.test/openapi/tenant.json"));
  assert.ok(allowedUrl("http://localhost:8000/openapi/tenant.json"));
  assert.ok(allowedUrl("http://127.0.0.1:8000/openapi/tenant.json"));
  assert.equal(allowedUrl("http://example.com/openapi/tenant.json"), null);
  assert.equal(allowedUrl("http://localhost.example.com/openapi/tenant.json"), null);
  assert.equal(allowedUrl("file:///etc/passwd"), null);
  assert.equal(allowedUrl("ftp://localhost/x"), null);
});

test("invalid JSON exits 2", () => {
  const file = join(work, "broken.json");
  writeFileSync(file, "{ not json");
  const res = check(file);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /not valid JSON/);
});

test("a missing file exits 2", () => {
  const res = check(join(work, "does-not-exist.json"));
  assert.equal(res.status, 2);
});

test("a broken $ref exits 2", () => {
  const res = check(
    fixture((doc) => {
      doc.paths["/v1/users/me"].get.responses["200"].content["application/json"].schema = {
        $ref: "#/components/schemas/Missing",
      };
    }),
  );
  assert.equal(res.status, 2);
  assert.match(res.stderr, /broken \$ref #\/components\/schemas\/Missing/);
});

test("a description fetched from a loopback URL is checked; an HTTP error exits 2", async () => {
  const body = JSON.stringify(VENDORED);
  const server = createServer((req, res) => {
    if (req.url === "/openapi/tenant.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
    } else {
      res.writeHead(503);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    // Asynchronous: the server above runs on this process's event loop.
    const run = (path) =>
      new Promise((r) =>
        execFile(process.execPath, [SCRIPT, "--description", `http://127.0.0.1:${port}${path}`], (err, stdout, stderr) =>
          r({ status: err ? err.code : 0, stdout, stderr }),
        ),
      );
    const ok = await run("/openapi/tenant.json");
    const direct = check(fixture());
    assert.equal(ok.status, direct.status);
    assert.equal(ok.stdout, direct.stdout);
    const failed = await run("/down");
    assert.equal(failed.status, 2);
    assert.match(failed.stderr, /HTTP 503/);
  } finally {
    server.close();
  }
});
