import assert from "node:assert/strict";
import test from "node:test";

import {
  validateFixtures,
  validateScenario,
} from "../scripts/video_scenario.mjs";

const validStepByAction = {
  goto: { path: "/demo" },
  click: { selector: "#submit" },
  fill: { selector: "#title", value: "Demo" },
  type: { selector: "#title", value: "Demo" },
  press: { selector: "#title", key: "Enter" },
  hover: { selector: "#menu" },
  check: { selector: "#enabled" },
  uncheck: { selector: "#enabled" },
  select: { selector: "#track", value: "productivity" },
  wait: { durationMs: 100 },
  waitFor: { selector: "#result" },
  assertText: { selector: "#result", text: "Done" },
  assertUrl: { pattern: "/complete" },
  screenshot: { name: "complete" },
};

function scenario(step) {
  return { name: "Fixture demo", steps: [step] };
}

test("accepts every documented action with its required fields", () => {
  for (const [action, fields] of Object.entries(validStepByAction)) {
    assert.equal(
      validateScenario(scenario({ action, ...fields })).steps[0].action,
      action,
    );
  }
});

test("rejects every documented action when a required field is omitted", () => {
  for (const [action, fields] of Object.entries(validStepByAction)) {
    for (const field of Object.keys(fields)) {
      const incomplete = { action, ...fields };
      delete incomplete[field];
      assert.throws(
        () => validateScenario(scenario(incomplete)),
        new RegExp(
          action === "goto"
            ? "either url or path is required"
            : `${field} is required|${field} must`,
        ),
      );
    }
  }
});

test("rejects undefined coercion and invalid timing values", () => {
  assert.throws(
    () =>
      validateScenario(
        scenario({ action: "fill", selector: "#title", value: undefined }),
      ),
    /value is required/,
  );
  assert.throws(
    () =>
      validateScenario(scenario({ action: "assertUrl", pattern: undefined })),
    /pattern is required/,
  );
  assert.throws(
    () => validateScenario(scenario({ action: "wait", durationMs: -1 })),
    /durationMs must be/,
  );
  assert.throws(
    () =>
      validateScenario(
        scenario({ action: "click", selector: "#submit", timeoutMs: 0 }),
      ),
    /timeoutMs must be/,
  );
});

test("validates scenario and viewport shape before browser startup", () => {
  assert.throws(
    () => validateScenario({ name: "Empty", steps: [] }),
    /steps must be a non-empty array/,
  );
  assert.throws(
    () =>
      validateScenario({
        name: "Bad viewport",
        viewport: { width: 0, height: 900 },
        steps: [{ action: "wait", durationMs: 1 }],
      }),
    /width must be a positive integer/,
  );
});

test("validates fixture routes without coercion or ambiguous bodies", () => {
  assert.throws(
    () => validateFixtures({ routes: [{}] }),
    /url must be a non-empty string/,
  );
  assert.throws(
    () =>
      validateFixtures({
        routes: [{ url: "**/api", json: {}, body: "duplicate" }],
      }),
    /use only one/,
  );
  assert.deepEqual(
    validateFixtures({ routes: [{ url: "**/api", json: { ok: true } }] })
      .routes[0].json,
    {
      ok: true,
    },
  );
  assert.equal(
    validateFixtures({ routes: [{ url: "**/api", json: null }] }).routes[0]
      .json,
    null,
  );
});
