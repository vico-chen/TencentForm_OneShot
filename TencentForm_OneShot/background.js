importScripts("shared.js");
const { formId, taskKey, waitMs, confirmWaitMs } = FormHelper;
const session = chrome.storage.session;
let queue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const tabId = sender.tab?.id ?? message.tabId;
  if (!Number.isInteger(tabId)) return false;
  const request = queue.then(async () => {
    const id = formId(sender.tab ? sender.url : (await chrome.tabs.get(tabId)).url);
    if (!id || (sender.tab && sender.frameId !== 0)) return null;
    const key = taskKey(tabId);
    let task = (await session.get(key))[key];
    if (task?.form !== id) task = null;
    const save = value => session.set({ [key]: value });
    const summary = ({ state, at, until, detail }) => ({ state, at, until, detail });
    const finish = (state, detail = "") => save({ form: id, state, at: task.at, until: task.until, detail });

    if (["armed", "committing"].includes(task?.state) && Date.now() >= task.until) {
      const state = task.state === "committing" ? "uncertain" : "expired";
      await finish(state, task.detail);
      task = { ...summary(task), state };
    }
    if (!sender.tab) {
      if (message.type === "status") return task && summary(task);
      if (message.type === "cancel") {
        await session.remove(key);
        return true;
      }
      if (message.type === "arm") {
        if (task?.state === "armed" || task?.state === "committing") return summary(task);
        const { answers, submit, at, scheduled } = message;
        if (message.form !== id || !Array.isArray(answers) || !answers.length || answers.length > 300 ||
            !Number.isFinite(at) || at < Date.now() - 10000 || at > Date.now() + 7 * 86400000)
          return null;
        const start = Math.max(Date.now(), at);
        const next = { id: crypto.randomUUID(), form: id, state: "armed", answers,
          submit: submit === true, scheduled: scheduled === true,
          at: start, until: start + waitMs, reloaded: false };
        await save(next);
        return summary(next);
      }
      return null;
    }

    if (message.type === "read") return task?.state === "armed" ? task : null;
    if (!task || message.id !== task.id || Date.now() < task.at) return null;
    if (message.type === "confirm" && task.state === "committing" && !task.confirmationGranted) {
      await save({ ...task, confirmationGranted: true });
      return true;
    }
    if (message.type === "result" && task.state === "committing") {
      await finish(message.clicked ? "clicked" : "filled", message.detail);
      return true;
    }
    if (task.state !== "armed") return null;
    if (message.type === "reload" && task.scheduled && !task.reloaded) {
      await save({ ...task, reloaded: true });
      return true;
    }
    if (message.type === "expire") {
      await finish("expired", task.detail);
      return true;
    }
    if (message.type === "waiting") {
      if (task.detail !== message.detail) await save({ ...task, detail: message.detail });
      return true;
    }
    if (message.type === "finish") {
      if (message.submit && !task.submit) return null;
      if (message.submit) {
        const until = Math.max(task.until, Date.now() + confirmWaitMs + 1000);
        await save({ form: id, id: task.id, state: "committing", at: task.at, until });
      } else {
        await finish("filled", message.detail);
      }
      return true;
    }
    return null;
  });
  queue = request.catch(() => {});
  request.then(reply, error => reply({ error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  queue = queue.then(() => session.remove(taskKey(tabId))).catch(() => {});
});

