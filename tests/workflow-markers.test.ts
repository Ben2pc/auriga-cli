import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MARKER_SCHEMA,
  workflowStartMarker,
  WORKFLOW_HEADER_RE,
  workflowEndMarker,
  hashBlock,
  parseMarkers,
  composeMarkedFile,
  hasAurigaHeader,
} from "../src/workflow-markers.js";

// A minimal marked file built the way the installer writes one.
function marked(blockBody: string, userRegion = ""): string {
  return composeMarkedFile({ blockBody, userRegion });
}

describe("workflow-markers — constants", () => {
  test("schema is v1 and the START marker carries it", () => {
    assert.equal(MARKER_SCHEMA, "v1");
    for (const lang of ["en", "zh-CN"]) {
      const m = workflowStartMarker(lang);
      assert.ok(m.includes("AURIGA:WORKFLOW:v1 START"));
      assert.ok(m.startsWith("<!--"));
      assert.ok(m.trimEnd().endsWith("-->"));
    }
  });

  test("START marker prose is language-aware; unknown lang falls back to en", () => {
    assert.match(workflowStartMarker("en"), /Managed block/);
    assert.match(workflowStartMarker("zh-CN"), /受管区块/);
    assert.equal(workflowStartMarker("fr"), workflowStartMarker("en"));
    assert.equal(workflowStartMarker(), workflowStartMarker("en"));
  });

  test("END marker embeds the given hash", () => {
    const m = workflowEndMarker("abc123");
    assert.ok(m.includes("AURIGA:WORKFLOW:v1 END"));
    assert.ok(m.includes("sha256=abc123"));
  });
});

describe("workflow-markers — hashBlock", () => {
  test("deterministic 16-char lowercase hex", () => {
    const h = hashBlock("# auriga Workflow (v1.9.0)\n");
    assert.match(h, /^[0-9a-f]{16}$/);
    assert.equal(h, hashBlock("# auriga Workflow (v1.9.0)\n"));
  });

  test("different block body → different hash", () => {
    assert.notEqual(hashBlock("a\n"), hashBlock("b\n"));
  });
});

describe("workflow-markers — parseMarkers", () => {
  test("content with no markers → unmarked", () => {
    assert.equal(parseMarkers("# My notes\nstuff\n").kind, "unmarked");
  });

  test("a well-formed marked file → marked, with body / userRegion / endHash", () => {
    const file = marked("# auriga Workflow (v1.9.0)\nbody\n", "## 我的规则\n");
    const p = parseMarkers(file);
    assert.equal(p.kind, "marked");
    if (p.kind !== "marked") return;
    assert.equal(p.blockBody, "# auriga Workflow (v1.9.0)\nbody\n");
    assert.equal(p.userRegion, "## 我的规则\n");
    assert.equal(p.prefix, "");
    assert.match(p.endHash ?? "", /^[0-9a-f]{16}$/);
  });

  test("only a START marker → malformed", () => {
    assert.equal(parseMarkers(`${workflowStartMarker()}\nbody\n`).kind, "malformed");
  });

  test("only an END marker → malformed", () => {
    assert.equal(parseMarkers(`${workflowEndMarker("deadbeefcafe0123")}\nbody\n`).kind, "malformed");
  });

  test("END appears before START → malformed", () => {
    const file = `${workflowEndMarker("deadbeefcafe0123")}\nbody\n${workflowStartMarker()}\n`;
    assert.equal(parseMarkers(file).kind, "malformed");
  });
});

describe("workflow-markers — composeMarkedFile round-trip", () => {
  test("compose → parse preserves block body and user region byte-for-byte", () => {
    const body = "# auriga Workflow (v1.9.0)\nline2\nline3\n";
    const userRegion = "## 工程规则\n- 用 pnpm\n";
    const p = parseMarkers(composeMarkedFile({ blockBody: body, userRegion }));
    assert.equal(p.kind, "marked");
    if (p.kind !== "marked") return;
    assert.equal(p.blockBody, body);
    assert.equal(p.userRegion, userRegion);
  });

  test("END marker hash matches hashBlock of the block body", () => {
    const body = "# auriga Workflow (v1.9.0)\n";
    const p = parseMarkers(composeMarkedFile({ blockBody: body, userRegion: "" }));
    assert.equal(p.kind, "marked");
    if (p.kind !== "marked") return;
    assert.equal(p.endHash, hashBlock(body));
  });

  test("lang selects the START marker prose; parse is unaffected", () => {
    const body = "b\n";
    const en = composeMarkedFile({ blockBody: body, lang: "en" });
    const zh = composeMarkedFile({ blockBody: body, lang: "zh-CN" });
    assert.match(en.split("\n")[0], /Managed block/);
    assert.match(zh.split("\n")[0], /受管区块/);
    // Different prose, identical structure — both parse to the same block.
    for (const file of [en, zh]) {
      const p = parseMarkers(file);
      assert.equal(p.kind, "marked");
      if (p.kind !== "marked") return;
      assert.equal(p.blockBody, body);
    }
  });

  test("a prefix before the START marker is preserved", () => {
    const file = composeMarkedFile({
      prefix: "lead\n",
      blockBody: "b\n",
      userRegion: "tail\n",
    });
    const p = parseMarkers(file);
    assert.equal(p.kind, "marked");
    if (p.kind !== "marked") return;
    assert.equal(p.prefix, "lead\n");
  });
});

describe("workflow-markers — hasAurigaHeader", () => {
  test("English workflow header → true", () => {
    assert.equal(hasAurigaHeader("# auriga Workflow (v1.9.0)\n\n1. ...\n"), true);
  });

  test("Chinese workflow header → true", () => {
    assert.equal(hasAurigaHeader("# auriga 工作流 (v1.9.0)\n\n1. ...\n"), true);
  });

  test("foreign content → false", () => {
    assert.equal(hasAurigaHeader("# My hand-written notes\nstuff\n"), false);
  });

  test("WORKFLOW_HEADER_RE matches both languages", () => {
    assert.match("# auriga Workflow (v1.9.0)", WORKFLOW_HEADER_RE);
    assert.match("# auriga 工作流 (v2.0.1)", WORKFLOW_HEADER_RE);
  });
});
