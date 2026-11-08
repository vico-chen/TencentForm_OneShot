globalThis.FormHelper = {
  formId(url) {
    try {
      const parsed = new URL(url);
      if (parsed.origin === "https://docs.qq.com")
        return /^\/form\/page\/([A-Za-z0-9_-]+)\/?$/.exec(parsed.pathname)?.[1] ?? null;
    } catch {}
    return null;
  },
  taskKey: tabId => "task:" + tabId,
  waitMs: 20000,
  confirmWaitMs: 3000,
  text: value => (value ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim(),
};

