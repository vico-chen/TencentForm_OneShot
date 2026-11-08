const $ = id => document.getElementById(id);
const { formId, taskKey } = FormHelper;
const status = message => { $("status").textContent = message; };
const tab = chrome.tabs.query({ active: true, currentWindow: true }).then(([active]) => active);
const editors = new Map();
const session = chrome.storage.session;
let id;
let fields = [];
let busy = false;
let armed = false;
let saveQueue = Promise.resolve();

async function send(type, options = {}) {
  return chrome.runtime.sendMessage({ type, tabId: (await tab).id, ...options });
}
async function page(type) {
  return chrome.tabs.sendMessage((await tab).id, { type });
}
const draftKey = () => "draft:" + id;
const hasAnswer = value => Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
function draft() {
  return [...editors].map(([key, get]) => [key, get()]);
}
function saveDraft() {
  if (!id) return;
  const key = draftKey();
  const answers = draft();
  saveQueue = saveQueue.catch(() => {}).then(() => session.set({ [key]: answers }));
}
function controls() {
  $("now").disabled = busy || armed || !editors.size;
  $("schedule").disabled = $("now").disabled;
  $("cancel").disabled = busy || !armed;
  $("refresh").disabled = busy;
  $("now").textContent = $("submit").checked ? "立即填写并提交" : "立即填写";
}
function show(task) {
  armed = task?.state === "armed" || task?.state === "committing";
  controls();
  const time = task?.at ? new Date(task.at).toLocaleString("zh-CN", { hour12: false }) : "";
  if (task?.state === "armed") status("已启动 · " + time + "。" + (task.detail ?? "请保持当前表单页在前台。"));
  else if (task?.state === "committing") status("正在提交并检查确认框。");
  else if (task?.state === "filled") status(task.detail || "已填写，请在网页核对后提交。");
  else if (task?.state === "clicked") status(task.detail || "已点击「提交」，以网页结果为准。");
  else if (task?.state === "expired") status("等待结束。" + (task.detail ?? "请查看网页状态。"));
  else if (task?.state === "uncertain") status("本次提交结果未确认，请查看网页状态。");
}

function addField(field, saved) {
  const box = document.createElement("fieldset");
  const title = document.createElement("legend");
  title.textContent = field.title;
  if (field.required) {
    const marker = document.createElement("span");
    marker.textContent = " · 必填";
    title.append(marker);
  }
  box.append(title);
  $("questions").append(box);
  if (field.locked && ["radio", "checkbox"].includes(field.kind)) {
    const hint = document.createElement("p");
    hint.className = "muted";
    hint.textContent = "已识别选项。当前网页控件不可选，可以先在这里选好答案。";
    box.append(hint);
  }
  if (field.kind === "manual") {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "请在原网页填写。";
    box.append(note);
    return;
  }

  const radio = field.kind === "radio";
  if (radio || field.kind === "checkbox") {
    const savedOptions = Array.isArray(saved) ? saved : (saved ?? "").split(/\r?\n/);
    const selected = new Set(radio && savedOptions.length !== 1 ? [] : savedOptions);
    const inputs = field.options.map(option => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      label.className = "choice";
      input.type = field.kind;
      if (radio) input.name = field.key;
      input.value = option;
      input.checked = selected.has(option);
      input.addEventListener("change", saveDraft);
      label.append(input, document.createTextNode(option));
      box.append(label);
      return input;
    });
    if (radio) {
      const checked = () => inputs.find(input => input.checked);
      editors.set(field.key, () => checked()?.value ?? "");
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "clear-choice";
      clear.textContent = "清除选择";
      clear.addEventListener("click", () => {
        const current = checked();
        if (!current) return;
        current.checked = false;
        saveDraft();
      });
      box.append(clear);
    } else {
      editors.set(field.key, () => inputs.filter(input => input.checked).map(input => input.value));
    }
    return;
  }

  const choice = field.kind === "select";
  const longText = field.kind === "textarea" || field.kind === "preview";
  const input = document.createElement(choice ? "select" : longText ? "textarea" : "input");
  input.setAttribute("aria-label", field.title);
  if (choice) {
    input.add(new Option("请选择", ""));
    for (const option of field.options) input.add(new Option(option, option));
  } else if (field.kind === "preview") {
    input.placeholder = "题型待确认。选择题先填完整选项，多选每行一个。";
  } else if (!longText) {
    if (["date", "time", "datetime-local", "month", "week"].includes(field.inputType)) input.type = field.inputType;
    if (field.inputType === "tel" || field.inputType === "number")
      input.inputMode = field.inputType === "tel" ? "tel" : "decimal";
  }
  input.value = Array.isArray(saved) ? saved.join("\n") : (saved ?? "");
  input.addEventListener("input", saveDraft);
  box.append(input);
  editors.set(field.key, () => input.value);
}

async function refresh() {
  busy = true;
  controls();
  const scanNote = $("scan-note");
  scanNote.textContent = "正在识别题目…";
  try {
    await saveQueue.catch(() => {});
    const current = await tab;
    if (!formId(current?.url)) throw new Error("请先在当前标签页打开腾讯文档收集表（docs.qq.com/form/page/…）。");
    const result = await page("scan").catch(() => null);
    if (!result?.form) throw new Error("请刷新一次收集表页面，再打开扩展。");
    id = result.form;
    fields = result.fields;
    $("form-title").textContent = result.title || "当前腾讯文档收集表";
    editors.clear();
    $("questions").replaceChildren();
    const key = draftKey();
    const saved = new Map((await session.get(key))[key] ?? []);
    fields.forEach(field => addField(field, saved.get(field.key)));
    const manual = fields.filter(field => field.kind === "manual").length;
    const preview = fields.some(field => field.kind === "preview");
    scanNote.textContent = fields.length
      ? "识别到 " + fields.length + " 项" + (manual ? "，其中 " + manual + " 项需在网页处理" : "") + "。" +
        (preview ? "部分输入框尚未开放，可以先准备答案。" : "")
      : "页面还没有可识别的题目。请确认已登录、表单已加载，然后重新识别。";
    show(await send("status"));
  } catch (error) {
    fields = [];
    editors.clear();
    $("questions").replaceChildren();
    $("form-title").textContent = "请打开腾讯文档收集表";
    scanNote.textContent = error.message;
  } finally {
    busy = false;
    controls();
  }
}

async function start(scheduled) {
  const answers = draft().filter(([, value]) => hasAnswer(value)).map(([key, value]) => ({ key, value }));
  if (!answers.length) return status("请先输入至少一项答案。");
  const submit = $("submit").checked;
  if (submit) {
    const answerKeys = new Set(answers.map(answer => answer.key));
    const missing = fields.find(field => field.kind === "manual" || (field.required && !answerKeys.has(field.key)));
    if (missing?.kind === "manual") return status("「" + missing.title + "」需在网页处理，请取消自动提交。");
    if (missing) return status("自动提交前请补全必填题「" + missing.title + "」。");
  }
  const at = scheduled ? new Date($("time").value).getTime() : Date.now();
  if (!Number.isFinite(at) || (scheduled && at <= Date.now()))
    return status("请按电脑本地时间选择一个未来的执行时刻。");
  busy = true;
  controls();
  try {
    const task = await send("arm", { form: id, answers, submit, scheduled, at });
    if (task?.state !== "armed") return status("启动失败。请核对页面和定时时间（最多提前七天）。");
    if (await page("configure") !== true) {
      await send("cancel");
      return status("扩展未连接到页面。请刷新收集表后重试。");
    }
    show(await send("status"));
  } catch {
    status("启动失败，请刷新表单后重试。");
  } finally {
    busy = false;
    controls();
  }
}

$("refresh").onclick = refresh;
$("now").onclick = () => start(false);
$("schedule").onclick = () => start(true);
$("submit").onchange = controls;
$("cancel").onclick = async () => {
  try {
    if (await send("cancel") !== true) return status("当前页的任务未能取消，请检查表单标签页。");
    await page("configure").catch(() => {});
    armed = false;
    controls();
    status("已取消。");
  } catch {
    status("取消失败，请刷新表单后检查任务状态。");
  }
};
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "session") return;
  const change = changes[taskKey((await tab)?.id)];
  if (change?.newValue?.form === id) show(change.newValue);
});
void refresh();
