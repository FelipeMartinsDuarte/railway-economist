export const MS = {
  none: "no deployment on record",
  alreadyIdle: "already idle (SLEEPING)",
  stopOk: "stop requested (accepted)",
  stopNo: "stop not applied (API returned false)",
  upOk: "restart requested (accepted)",
  upNo: "restart not applied (API returned false)",
  upNone: "nothing to restart (no deployment)",
  downNone: "nothing to stop (no deployment)",
  noServices: "no services in this project",
};

function row(tag, name, detail) {
  return `[${tag}] ${name} — ${detail}`;
}

export function lineOk(name, detail) {
  return row("OK", name, detail);
}

export function lineSkip(name, detail) {
  return row("SKIP", name, detail);
}

export function lineFail(name, detail) {
  return row("FAIL", name, detail);
}

export function lineInfo(detail) {
  return `[INFO] — ${detail}`;
}

export function section(title, bodyLines) {
  const bar = "—".repeat(Math.min(48, 8 + title.length));
  return `${title}\n${bar}\n${bodyLines.join("\n")}`;
}
