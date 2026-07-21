const ACTION_FIELDS = {
  click: ["selector"],
  fill: ["selector", "value"],
  type: ["selector", "value"],
  press: ["selector", "key"],
  hover: ["selector"],
  check: ["selector"],
  uncheck: ["selector"],
  select: ["selector", "value"],
  wait: ["durationMs"],
  waitFor: ["selector"],
  assertText: ["selector", "text"],
  assertUrl: ["pattern"],
  screenshot: ["name"],
};

const STRING_FIELDS = new Set(["selector", "key", "text", "pattern", "name"]);

function fail(location, message) {
  throw new Error(`${location}: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasDefined(object, field) {
  return Object.hasOwn(object, field) && object[field] !== undefined;
}

function hasValue(object, field) {
  return hasDefined(object, field) && object[field] !== null;
}

function requireString(object, field, location, { allowEmpty = false } = {}) {
  if (
    !hasValue(object, field) ||
    typeof object[field] !== "string" ||
    (!allowEmpty && object[field].length === 0)
  ) {
    fail(
      location,
      `${field} must be ${allowEmpty ? "a string" : "a non-empty string"}`,
    );
  }
}

function requireFiniteNumber(
  object,
  field,
  location,
  { minimum = 0, required = false } = {},
) {
  if (!hasValue(object, field)) {
    if (required) fail(location, `${field} is required`);
    return;
  }
  if (
    typeof object[field] !== "number" ||
    !Number.isFinite(object[field]) ||
    object[field] < minimum
  ) {
    fail(location, `${field} must be a finite number >= ${minimum}`);
  }
}

function validateStep(step, index) {
  const location = `scenario.steps[${index}]`;
  if (!isObject(step)) fail(location, "step must be an object");
  requireString(step, "action", location);
  const actionLocation = `${location} (${step.action})`;
  if (step.action === "goto") {
    const hasUrl = hasValue(step, "url");
    const hasPath = hasValue(step, "path");
    if (!hasUrl && !hasPath)
      fail(actionLocation, "either url or path is required");
    if (hasUrl) requireString(step, "url", actionLocation);
    if (hasPath) requireString(step, "path", actionLocation);
  } else {
    const requiredFields = ACTION_FIELDS[step.action];
    if (!requiredFields) fail(actionLocation, "unsupported scenario action");
    for (const field of requiredFields) {
      if (!hasValue(step, field)) fail(actionLocation, `${field} is required`);
      if (STRING_FIELDS.has(field)) requireString(step, field, actionLocation);
    }
  }

  if (step.action === "fill" || step.action === "type") {
    if (!["string", "number", "boolean"].includes(typeof step.value)) {
      fail(actionLocation, "value must be a string, number, or boolean");
    }
  }
  requireFiniteNumber(step, "durationMs", actionLocation, {
    required: step.action === "wait",
  });
  requireFiniteNumber(step, "delayMs", actionLocation);
  requireFiniteNumber(step, "pauseAfterMs", actionLocation);
  requireFiniteNumber(step, "timeoutMs", actionLocation, { minimum: 1 });
  if (hasValue(step, "subtitle"))
    requireString(step, "subtitle", actionLocation, { allowEmpty: true });
}

export function validateScenario(scenario) {
  if (!isObject(scenario)) fail("scenario", "must be an object");
  requireString(scenario, "name", "scenario");
  if (hasValue(scenario, "startPath"))
    requireString(scenario, "startPath", "scenario");
  requireFiniteNumber(scenario, "defaultPauseMs", "scenario");
  if (hasValue(scenario, "viewport")) {
    if (!isObject(scenario.viewport))
      fail("scenario.viewport", "must be an object");
    for (const field of ["width", "height"]) {
      if (
        !Number.isInteger(scenario.viewport[field]) ||
        scenario.viewport[field] <= 0
      ) {
        fail("scenario.viewport", `${field} must be a positive integer`);
      }
    }
  }
  if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) {
    fail("scenario", "steps must be a non-empty array");
  }
  scenario.steps.forEach(validateStep);
  return scenario;
}

export function validateFixtures(fixtures) {
  if (!isObject(fixtures)) fail("fixtures", "must be an object");
  for (const field of ["localStorage", "sessionStorage"]) {
    if (hasValue(fixtures, field) && !isObject(fixtures[field]))
      fail(`fixtures.${field}`, "must be an object");
    for (const [key, value] of Object.entries(fixtures[field] ?? {})) {
      const primitive = ["string", "number", "boolean"].includes(typeof value);
      if (!primitive || (typeof value === "number" && !Number.isFinite(value))) {
        fail(
          `fixtures.${field}.${key}`,
          "must be a string, finite number, or boolean",
        );
      }
    }
  }
  if (hasValue(fixtures, "cookies") && !Array.isArray(fixtures.cookies)) {
    fail("fixtures.cookies", "must be an array");
  }
  if (hasValue(fixtures, "routes")) {
    if (!Array.isArray(fixtures.routes))
      fail("fixtures.routes", "must be an array");
    fixtures.routes.forEach((route, index) => {
      const location = `fixtures.routes[${index}]`;
      if (!isObject(route)) fail(location, "route must be an object");
      requireString(route, "url", location);
      for (const field of ["method", "contentType", "body", "bodyFile"]) {
        if (hasValue(route, field))
          requireString(route, field, location, {
            allowEmpty: field === "body",
          });
      }
      if (
        hasValue(route, "status") &&
        (!Number.isInteger(route.status) ||
          route.status < 100 ||
          route.status > 599)
      ) {
        fail(location, "status must be an integer between 100 and 599");
      }
      if (hasValue(route, "headers")) {
        if (
          !isObject(route.headers) ||
          Object.values(route.headers).some(
            (value) => typeof value !== "string",
          )
        ) {
          fail(location, "headers must be an object with string values");
        }
      }
      const bodies = ["json", "body", "bodyFile"].filter((field) =>
        hasDefined(route, field),
      );
      if (bodies.length > 1)
        fail(location, "use only one of json, body, or bodyFile");
    });
  }
  return fixtures;
}
