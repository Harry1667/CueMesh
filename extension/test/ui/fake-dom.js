// 測試用的極簡 DOM：只實作 UI 模組會用到的方法，並記錄輸出的標籤與屬性，
// 也故意不提供 innerHTML 的解析行為——程式碼若依賴它，測試會直接失敗。
class FakeNode {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }

  appendChild(child) {
    if (child instanceof FakeFragment) {
      for (const c of [...child.childNodes]) this.appendChild(c);
      child.childNodes = [];
      return child;
    }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }
}

export class FakeText extends FakeNode {
  constructor(value) {
    super();
    this.value = value;
  }

  get textContent() {
    return this.value;
  }
}

export class FakeFragment extends FakeNode {}

export class FakeElement extends FakeNode {
  constructor(tagName) {
    super();
    this.tagName = tagName;
    this.attributes = {};
    this.listeners = {};
    this.classList = { add() {}, remove() {} };
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  addEventListener(type, fn) {
    this.listeners[type] = fn;
  }

  set innerHTML(_value) {
    throw new Error('不可使用 innerHTML');
  }
}

export function createFakeDocument() {
  return {
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (value) => new FakeText(value),
    createDocumentFragment: () => new FakeFragment(),
  };
}

// 走訪整棵樹，收集所有元素
export function allElements(root) {
  const out = [];
  const walk = (n) => {
    if (n instanceof FakeElement) out.push(n);
    for (const c of n.childNodes) walk(c);
  };
  walk(root);
  return out;
}
