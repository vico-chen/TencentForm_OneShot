(() => {
  const { formId, confirmWaitMs } = FormHelper;
  const { scan, resolve, ready, submitButton, submitConfirmation } = FormReader;
  if (!formId(location.href)) return;

  const send = message => chrome.runtime.sendMessage(message);
  let stop = () => {};
  let taskId;
  let configuration = 0;
  async function configure() {
    const request = ++configuration;
    const task = await send({ type: "read" });
    if (request !== configuration || task?.id === taskId) return;
    stop();
    taskId = task?.id;
    if (!taskId) return;

    let observer;
    let openingTimer;
    let endTimer;
    let retryTimer;
    let ended = false;
    let busy = false;
    let lastDetail;
    const attempted = new WeakSet();
    const end = () => {
      ended = true;
      clearTimeout(openingTimer);
      clearTimeout(endTimer);
      clearInterval(retryTimer);
      observer?.disconnect();
    };
    stop = end;
    const update = (type, extra = {}) => send({ type, id: task.id, ...extra });

    function inspect() {
      const fields = scan();
      const byKey = new Map(fields.map(field => [field.key, field]));
      const entries = task.answers.map(({ key, value }) => {
        const field = byKey.get(key);
        return { field, plan: field ? resolve(field, value) : null };
      });
      return { fields, entries };
    }

    async function submit(detail) {
      // A conditional question or navigation can appear while the grant is in flight.
      const current = inspect();
      const button = formId(location.href) === task.form && ready(current.fields) &&
        current.entries.every(entry => entry.plan?.matches()) && !submitConfirmation().present ? submitButton() : null;
      if (!button) {
        await update("result", { clicked: false, detail: "已填写，但页面状态有变化，请核对后手动提交。" });
        return;
      }

      button.click();
      const deadline = Date.now() + confirmWaitMs;
      const manual = detail + "已点击「提交」，请在网页核对确认框。";
      let result = detail + "已点击「提交」，以网页结果为准。";
      while (!ended && formId(location.href) === task.form) {
        const confirmation = submitConfirmation();
        if (Date.now() >= deadline) {
          if (confirmation.present) result = manual;
          break;
        }
        if (confirmation.button) {
          if (await update("confirm") !== true || ended || formId(location.href) !== task.form) return;
          if (Date.now() < deadline && submitConfirmation().button === confirmation.button) {
            confirmation.button.click();
            result = detail + "已点击「提交」和「确认」，以网页结果为准。";
          } else {
            result = manual;
          }
          break;
        }
        await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
      }
      if (!ended) await update("result", { clicked: true, detail: result });
    }

    async function check(first = false) {
      if (ended || busy || Date.now() >= task.until || formId(location.href) !== task.form) return;
      busy = true;
      try {
        let { entries, fields } = inspect();
        if (first && !entries.some(entry => entry.plan) && task.scheduled && !task.reloaded) {
          if (await update("reload") === true && !ended) location.reload();
          return;
        }
        let changed = false;
        for (const { field, plan } of entries) {
          if (plan && !plan.matches() && !attempted.has(field.nodes[0])) {
            attempted.add(field.nodes[0]);
            plan.apply();
            changed = true;
          }
        }
        if (changed) {
          await new Promise(resolveFrame => setTimeout(resolveFrame, 0));
          ({ entries, fields } = inspect());
        }

        const filled = entries.filter(entry => entry.plan?.matches()).length;
        const allFilled = filled === entries.length;
        const canSubmit = task.submit && allFilled && ready(fields) && submitButton();
        if (allFilled && (!task.submit || canSubmit)) {
          const detail = "已填写 " + filled + " 项。";
          if (await update("finish", { submit: task.submit, detail }) !== true || ended) return;
          clearTimeout(endTimer);
          try {
            if (task.submit) await submit(detail);
          } finally {
            end();
          }
          return;
        }

        const detail = "已填写 " + filled + "/" + entries.length + " 项。" +
          (allFilled ? "仍有必填题或验证未完成，或提交按钮不可用。" : "其余题目尚未开放，或题目和选项与草稿不一致。");
        if (lastDetail !== detail) {
          lastDetail = detail;
          await update("waiting", { detail });
        }
      } catch {
        if (!ended && lastDetail !== "网页控件未接受自动填写。") {
          lastDetail = "网页控件未接受自动填写。";
          await update("waiting", { detail: lastDetail }).catch(() => {});
        }
      } finally {
        busy = false;
      }
    }

    openingTimer = setTimeout(() => {
      observer = new MutationObserver(() => { void check(); });
      observer.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ["class", "style", "hidden", "disabled", "readonly", "aria-checked", "aria-disabled", "aria-invalid"]
      });
      // Some controls update a property without mutating DOM attributes.
      retryTimer = setInterval(() => { void check(); }, 150);
      void check(true);
    }, Math.max(0, task.at - Date.now()));
    endTimer = setTimeout(() => {
      end();
      void update("expire").catch(() => {});
    }, Math.max(0, task.until - Date.now()));
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type === "configure") {
      configure().then(() => reply(true), () => reply(false));
      return true;
    }
    if (message.type === "scan") {
      const fields = scan().map(({ key, title, kind, required, inputType, options, locked }) =>
        ({ key, title, kind, required, inputType, locked, options: options.map(option => option.label) }));
      reply({ form: formId(location.href), title: document.title, fields });
    }
    return false;
  });
  void configure().catch(() => {});
})();
