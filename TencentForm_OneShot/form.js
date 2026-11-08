globalThis.FormReader = (() => {
  const { text } = FormHelper;
  const titleSelector = [
    "legend", "[data-question-title]", "[data-field-title]",
    '[class*="question-title" i]', '[class*="questionTitle" i]',
    '[class*="topic-title" i]', '[class*="topicTitle" i]'
  ].join(",");
  const cardSelector = [
    "fieldset", "[data-question-id]", "[data-field-id]",
    '[class*="question-item" i]', '[class*="questionItem" i]',
    '[class*="topic-item" i]', '[class*="topicItem" i]'
  ].join(",");
  const controlSelector = 'input:not([type=hidden]),textarea,select,[contenteditable=true],[role=radio],[role=checkbox],[role=combobox]';
  const choiceGroupSelector = '[role=radiogroup],[role=group],fieldset';
  const textTypes = new Set(["text", "email", "tel", "url", "number", "date", "time", "datetime-local", "month", "week"]);
  const root = () => document.getElementById("fillBodyContent") ??
    document.querySelector('[class*="fillBodyContent" i],#workbench-content-container form,#workbench-content-container');
  const read = element => text(element?.innerText ?? element?.textContent);
  const visible = element => Boolean(element?.getClientRects().length &&
    !element.closest('[hidden],[aria-hidden=true]') && getComputedStyle(element).visibility === "visible");
  const blocked = element => Boolean(element?.matches(":disabled,[readonly],[aria-disabled=true]") ||
    element?.closest('[aria-disabled=true],[inert]'));
  const cleanTitle = label => text(label).split(/\s+(?=例\s*[:：]|收集表暂停|请务必)/, 1)[0]
    .replace(/^[*＊]\s*\d{1,3}(?:\s*[.．、:：]\s*|\s+)/, "")
    .replace(/^\d+\s*(?:[.．、:：]|(?=[*＊]))\s*/, "")
    .replace(/^[*＊]\s*|\s*[*＊]$/g, "").replace(/[:：]\s*$/, "").trim();
  const keyFor = title => cleanTitle(title).normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const optionKey = label => text(label).normalize("NFKC");
  const isTitle = title => title && title.length <= 160 && !/^(?:\d+|请输入.*|请选择.*|提交.*|登录.*|必填|选填)$/.test(title);
  const ariaName = element => text((element?.getAttribute("aria-labelledby") ?? "").split(/\s+/)
    .map(id => read(document.getElementById(id))).filter(Boolean).join(" ")) || text(element?.getAttribute("aria-label"));
  function labelText(label) {
    if (!label) return "";
    const copy = label.cloneNode(true);
    for (const control of copy.querySelectorAll(controlSelector)) control.remove();
    return read(copy);
  }
  const nativeLabel = element => [...(element?.labels ?? [])].map(labelText).filter(Boolean).join(" ");
  const choiceKind = element => {
    const type = element.getAttribute("role") ?? element.type;
    return type === "radio" || type === "checkbox" ? type : null;
  };

  function titleElementIn(container, anchor) {
    if (!container) return null;
    const explicit = [...container.querySelectorAll(titleSelector)].filter(el =>
      visible(el) && !el.contains(anchor) && !el.querySelector(controlSelector) && isTitle(cleanTitle(read(el))));
    return explicit.length === 1 ? explicit[0] : null;
  }

  function isChoiceOption(element, kind) {
    if (choiceKind(element) === kind) return true;
    if (element.matches(cardSelector + ',[role=radiogroup]') || element.querySelector(titleSelector)) return false;
    const [control, nested, extra] = element.querySelectorAll(controlSelector);
    return Boolean(control && choiceKind(control) === kind &&
      (!nested || (!extra && choiceKind(nested) === kind && choiceWrapper(nested) === control)));
  }

  function previousHeading(anchor, scope, choice = null) {
    for (let node = anchor; node && node !== scope; node = node.parentElement) {
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (!visible(sibling)) continue;
        if (sibling.matches(controlSelector) || sibling.querySelector(controlSelector)) {
          if (choice && isChoiceOption(sibling, choice)) continue;
          break;
        }
        const heading = titleElementIn(sibling, anchor) ?? sibling;
        if (isTitle(cleanTitle(read(heading)))) return heading;
      }
      if (node.matches(cardSelector)) break;
    }
    return null;
  }

  const choiceWrapper = element => element.matches("input")
    ? element.parentElement?.closest('[role=radio],[role=checkbox]')
    : null;

  function choiceLabel(element) {
    const wrapper = choiceWrapper(element);
    const label = ariaName(element) || nativeLabel(element) || read(element) ||
      labelText(element.closest("label")) || ariaName(wrapper) || labelText(wrapper);
    const parent = element.parentElement;
    return label || (parent && isChoiceOption(parent, choiceKind(element)) ? labelText(parent) : "");
  }

  function optionLabels(entries) {
    const options = entries.map(entry => entry.label);
    return options.every(Boolean) && new Set(options.map(optionKey)).size === options.length;
  }

  function numberDuplicateCheckboxOptions(options) {
    const labels = new Set();
    const duplicates = new Set();
    for (const option of options) {
      const key = optionKey(option.label);
      if (key && labels.has(key)) duplicates.add(key);
      labels.add(key);
    }
    if (!duplicates.size) return options;

    return options.map((option, index) => {
      if (!duplicates.has(optionKey(option.label))) return option;
      let label = `${option.label}（第 ${index + 1} 项）`;
      while (labels.has(optionKey(label))) label += "（同名选项）";
      labels.add(optionKey(label));
      return { ...option, label };
    });
  }

  function scan() {
    const container = root();
    if (!container) return [];
    const nodes = [...container.querySelectorAll(controlSelector)].filter(el => {
      if (el.matches('input[type=submit],input[type=button],input[type=reset],input[type=image]')) return false;
      const choice = choiceKind(el);
      if (choice && !el.matches("input") && el.querySelector('input[type="' + choice + '"]')) return false;
      return visible(el) || (choice && ([...(el.labels ?? [])].some(visible) || visible(choiceWrapper(el))));
    });
    const questionNodes = new Set();
    const fields = [];
    const used = new Set();
    const choiceHeadings = new Map();
    for (const node of nodes) {
      const choice = choiceKind(node);
      if (!choice || (choice === "radio" && node.closest('[role=radiogroup]'))) continue;
      const scope = node.closest(choiceGroupSelector) ?? node.closest(cardSelector);
      const anchor = choiceWrapper(node) ?? node.closest("label") ?? node;
      const heading = titleElementIn(scope, node) ?? previousHeading(anchor, container, choice);
      if (heading) choiceHeadings.set(node, heading);
    }

    for (const node of nodes) {
      if (used.has(node)) continue;
      const card = node.closest(cardSelector);
      const choice = choiceKind(node);
      const radioGroup = choice === "radio" ? node.closest('[role=radiogroup]') : null;
      const group = radioGroup ?? (choice ? node.closest(choiceGroupSelector) : null);
      const scope = group || card;
      const heading = choiceHeadings.get(node);
      let related = [node];
      let inferredTitle = "";
      if (radioGroup) {
        related = nodes.filter(el => !used.has(el) && choiceKind(el) === "radio" &&
          el.closest('[role=radiogroup]') === radioGroup);
      } else if (choice) {
        related = nodes.filter(el => !used.has(el) && choiceKind(el) === choice && (
          scope ? scope.contains(el) && (!node.name || el.name === node.name) &&
            (el.closest(choiceGroupSelector) ?? el.closest(cardSelector)) === scope :
          node.name ? el.name === node.name : el === node
        ));
        // Checkboxes in one question can have different names. Match the heading element and control type.
        if (heading && (choice === "checkbox" || related.length === 1)) {
          const sameQuestion = nodes.filter(el => !used.has(el) && choiceKind(el) === choice && choiceHeadings.get(el) === heading);
          const names = sameQuestion.map(el => el.name).filter(Boolean);
          if (sameQuestion.length > 1 && (choice === "checkbox" || new Set(names).size === names.length)) {
            related = sameQuestion;
            inferredTitle = read(heading);
          }
        }
      }
      related.forEach(el => used.add(el));
      const first = related[0];
      const rawTitle = choice
        ? inferredTitle || ariaName(group) || read(titleElementIn(scope, first)) ||
          read(previousHeading(group || first.closest("label") || first, container)) || read(heading)
          || (choice === "checkbox" && related.length === 1 ? choiceLabel(first) : "")
        : ariaName(first) || nativeLabel(first) || read(titleElementIn(card, first)) || read(previousHeading(first, container))
          || text(first.placeholder).replace(/^请(?:输入|填写)/, "");
      const title = cleanTitle(rawTitle);
      const required = Boolean(/[*＊]/.test(rawTitle) || card?.matches('[data-required=true],[aria-required=true]') ||
        group?.matches('[aria-required=true]') || related.some(el => el.required || el.getAttribute("aria-required") === "true"));
      const labeled = isTitle(title);
      let kind = "manual";
      let options = [];
      if (labeled && choice) {
        options = related.map(el => ({ element: el, label: choiceLabel(el) }));
        if (choice === "checkbox") options = numberDuplicateCheckboxOptions(options);
        if (optionLabels(options)) kind = choice;
      } else if (labeled && first.matches("select:not([multiple])")) {
        options = [...first.options].filter(option => option.value !== "" && !option.disabled)
          .map(option => ({ element: option, label: text(option.label) }));
        if (options.length && optionLabels(options)) kind = "select";
      } else if (labeled && first.matches("textarea")) {
        kind = "textarea";
      } else if (labeled && first.matches("input") && textTypes.has(first.type)) {
        kind = "text";
      }
      if (card) questionNodes.add(card);
      fields.push({ key: labeled ? keyFor(title) : "", title: labeled ? title : "未识别到题目名称",
        required, kind, options, nodes: related, locked: related.every(blocked),
        inputType: kind === "text" ? first.type : "" });
    }

    // The preview may show titles before the organizer enables the actual inputs.
    for (const heading of container.querySelectorAll(titleSelector)) {
      if (!visible(heading) || heading.querySelector(controlSelector)) continue;
      const card = heading.closest(cardSelector);
      if ((card && questionNodes.has(card)) || nodes.some(node => node.closest("label")?.contains(heading))) continue;
      const rawTitle = read(heading);
      const title = cleanTitle(rawTitle);
      if (!isTitle(title) || fields.some(field => field.key === keyFor(title))) continue;
      fields.push({ key: keyFor(title), title, required: /[*＊]/.test(rawTitle),
        kind: "preview", options: [], nodes: [heading], inputType: "" });
    }
    if (!nodes.length && !fields.length && container.id === "fillBodyContent") {
      for (const element of container.querySelectorAll("div,span,label,p")) {
        if (!visible(element) || element.children.length > 1 || [...element.children].some(child => read(child) === read(element))) continue;
        const raw = read(element);
        if (!/^[*＊]\s*\S/.test(raw)) continue;
        const title = cleanTitle(raw);
        if (isTitle(title) && !fields.some(field => field.key === keyFor(title)))
          fields.push({ key: keyFor(title), title, required: true, kind: "preview", options: [], nodes: [element], inputType: "" });
      }
    }

    const counts = new Map();
    for (const field of fields) counts.set(field.key, (counts.get(field.key) ?? 0) + 1);
    return fields.map(field => field.key && counts.get(field.key) === 1 ? field :
      { ...field, key: "", kind: "manual", options: [] });
  }

  const checked = element => element.matches("input") ? element.checked : element.getAttribute("aria-checked") === "true";
  const normalize = values => values.map(optionKey).sort().join("\u001F");
  function valueOf(field) {
    const [element] = field.nodes;
    if (field.kind === "radio" || field.kind === "checkbox")
      return field.options.filter(option => checked(option.element)).map(option => option.label);
    if (field.kind === "select")
      return field.options.filter(option => option.element.selected).map(option => option.label);
    return element.value ?? "";
  }

  function resolve(field, answer) {
    const [element] = field.nodes;
    if (["preview", "manual"].includes(field.kind)) return null;
    if (field.kind === "text" || field.kind === "textarea") {
      if (Array.isArray(answer) || blocked(element)) return null;
      return { matches: () => valueOf(field) === answer, apply: () => setValue(element, answer) };
    }
    const wanted = (Array.isArray(answer) ? answer : answer.split(/\r?\n/)).map(text).filter(Boolean);
    if (!wanted.length || (field.kind !== "checkbox" && wanted.length !== 1)) return null;
    const desired = new Set(wanted.map(optionKey));
    if (desired.size !== wanted.length) return null;
    const selected = field.options.filter(option => desired.has(optionKey(option.label)));
    if (selected.length !== desired.size || selected.some(option => blocked(option.element))) return null;
    const matches = () => normalize(valueOf(field)) === normalize(wanted);
    if (field.kind === "select")
      return blocked(element) ? null : { matches, apply: () => setValue(element, selected[0].element.value) };
    if (field.kind === "checkbox" && field.options.some(option => blocked(option.element) &&
        checked(option.element) !== desired.has(optionKey(option.label)))) return null;
    return { matches, apply: () => {
      // Release old selections first so they do not count against a checkbox group's limit.
      const options = field.kind === "radio" ? selected :
        [...field.options.filter(option => !desired.has(optionKey(option.label))), ...selected];
      for (const option of options) {
        if (checked(option.element) !== desired.has(optionKey(option.label))) option.element.click();
      }
    } };
  }

  function setValue(element, value) {
    const prototype = element.matches("textarea") ? HTMLTextAreaElement.prototype :
      element.matches("select") ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function submitButton() {
    const container = document.getElementById("workbench-content-container") ?? root();
    if (!container) return null;
    const buttons = [...container.querySelectorAll("button,[role=button],input[type=submit]")].filter(el =>
      visible(el) && !blocked(el) && /^(?:提交|提交表单|提交答卷|提交收集表|提交回答)$/.test(read(el) || el.value || ariaName(el)));
    return buttons.length === 1 ? buttons[0] : null;
  }

  function submitConfirmation() {
    const actions = 'button,[role=button],input[type=button],input[type=submit]';
    const label = element => text(read(element) || element.value || ariaName(element)).replace(/\s/g, "");
    const prompt = /^(?:[×✕✖]|关闭)?确认提交你的结果吗[?？]?(?:(?:取消)?(?:确认)?|确认取消)(?:[×✕✖]|关闭)?$/;
    const matches = [...document.querySelectorAll(actions)].filter(button => {
      if (!visible(button) || label(button) !== "确认") return false;
      // The dialog can be mounted outside the form, so require its exact prompt and both actions.
      for (let panel = button.parentElement; panel && panel !== document.body; panel = panel.parentElement) {
        if (!prompt.test(read(panel).replace(/\s/g, ""))) continue;
        if ([...panel.querySelectorAll(actions)].some(action => visible(action) && label(action) === "取消")) return true;
      }
      return false;
    });
    return { present: matches.length > 0, button: matches.length === 1 && !blocked(matches[0]) ? matches[0] : null };
  }

  function ready(fields) {
    return fields.length > 0 && fields.every(field => {
      if (field.kind === "manual" || field.kind === "preview") return false;
      const value = valueOf(field);
      if (field.required && (Array.isArray(value) ? !value.length : !text(value))) return false;
      return field.nodes.every(element => element.getAttribute("aria-invalid") !== "true" && element.validity?.valid !== false);
    });
  }

  return { scan, resolve, ready, submitButton, submitConfirmation };
})();

