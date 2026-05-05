export function parseAllowedUserIds() {
  const raw = String(process.env.TELEGRAM_ALLOWED_USER_IDS ?? "").trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n))
  );
}

export function isAllowedUser(from, allowed) {
  const id = from?.id;
  if (id == null) return false;
  return allowed.size > 0 && allowed.has(id);
}
