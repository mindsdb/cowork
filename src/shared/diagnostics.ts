/** Diagnostic output contains stable events and safe metadata, never caller values. */
type Level = "DEBUG" | "INFO" | "WARNING" | "ERROR";
interface RuntimeSettings {
  process?: { env?: Record<string, string | undefined> };
  localStorage?: { getItem(name: string): string | null };
}
// V8 exposes stack as a native accessor; never call an error's custom getter.
const nativeStackGetter = Object.getOwnPropertyDescriptor(
  new Error(),
  "stack",
)?.get;
const levels: Record<Level, number> = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
};

function configuredLevel(): number {
  const runtime = globalThis as RuntimeSettings;
  try {
    const value =
      runtime.process?.env?.LOG_LEVEL ||
      runtime.localStorage?.getItem("diagnostic_log_level") ||
      "WARNING";
    return levels[value.toUpperCase() as Level] ?? levels.WARNING;
  } catch {
    return levels.WARNING;
  }
}

export function diagnostic(
  logger: string,
  level: Level,
  event: string,
  ...values: unknown[]
): void {
  if (levels[level] < configuredLevel()) return;
  const payload: Record<
    string,
    string | number | { file: string; line: number; column: number }[]
  > = {
    logged_at: new Date().toISOString(),
    logger,
    log_level: level,
    event,
    message: event.replace(/_/g, " "),
  };
  for (const value of values) {
    try {
      if (value instanceof Error) {
        const constructor = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(value),
          "constructor",
        )?.value;
        const name =
          typeof constructor === "function" ? constructor.name : "Error";
        payload.error_type = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)
          ? name
          : "Error";
        const stackProperty = Object.getOwnPropertyDescriptor(value, "stack");
        const stack =
          stackProperty && "value" in stackProperty
            ? stackProperty.value
            : nativeStackGetter?.call(value);
        if (typeof stack === "string") {
          payload.exception_frames = stack
            .split("\n")
            .slice(1, 33)
            .flatMap((frame) => {
              const location =
                /([A-Za-z0-9_.-]+\.(?:js|jsx|ts|tsx))(?:\?[^)\n]*)?:(\d+):(\d+)/.exec(
                  frame,
                );
              return location
                ? [
                    {
                      file: location[1],
                      line: Number(location[2]),
                      column: Number(location[3]),
                    },
                  ]
                : [];
            });
        }
      }
      if (value !== null && typeof value === "object") {
        // Read only own data properties: a diagnostic must not invoke a getter.
        for (const field of [
          "server_version",
          "agent_version",
          "target_version",
          "build_channel",
          "outcome",
          "device_key_id",
          "count",
          "config_field",
          "config_source",
          "setting_key",
        ]) {
          const entry = Object.getOwnPropertyDescriptor(value, field)?.value;
          if (field === "count" && Number.isSafeInteger(entry) && entry >= 0)
            payload[field] = entry;
          else if (
            typeof entry === "string" &&
            ((field.endsWith("_version") &&
              /^[0-9]+(?:\.[0-9]+)*(?:(?:rc|a|b|dev)[0-9]+)?$/.test(entry)) ||
              (field === "build_channel" &&
                ["prod", "dev", "staging", "unknown"].includes(entry)) ||
              (field === "outcome" &&
                [
                  "repair",
                  "not-prod",
                  "unknown-installed-version",
                  "on-stream",
                  "no-latest-version",
                  "latest-not-stable",
                ].includes(entry)) ||
              (field === "config_source" && entry === "/brand/brand.js") ||
              (field === "config_field" &&
                [
                  "productName",
                  "skin",
                  "theme",
                  "logoUrl",
                  "iconUrl",
                  "appleTouchIconUrl",
                  "skinLocked",
                ].includes(entry)) ||
              (field === "setting_key" &&
                [
                  "planning_model",
                  "coding_model",
                  "conversation_model",
                  "intent_model",
                ].includes(entry)) ||
              (field === "device_key_id" &&
                /^hub:anton:[a-f0-9]{16,64}$/.test(entry)))
          )
            payload[field] = entry;
        }
        const status = Object.getOwnPropertyDescriptor(value, "status")?.value;
        if (Number.isInteger(status) && status >= 400 && status <= 599)
          payload.status_code = status;
        const requestId = Object.getOwnPropertyDescriptor(
          value,
          "request_id",
        )?.value;
        if (
          typeof requestId === "string" &&
          /^[a-f0-9-]{32,36}$/i.test(requestId)
        )
          payload.request_id = requestId;
      }
    } catch {
      // Hostile proxies and unavailable metadata must not break the caller.
    }
  }
  const write =
    level === "ERROR"
      ? console.error
      : level === "WARNING"
        ? console.warn
        : console.log;
  write(JSON.stringify(payload));
}
