// 提供給 agent 的工具定義（中立的 JSON Schema 格式）

const obj = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });

export const WORKSPACE_TOOLS = [
  {
    name: 'workspace_list',
    description: '列出這次任務共用工作區裡所有檔案的名稱與類型。',
    parameters: obj({}),
  },
  {
    name: 'workspace_read',
    description: '讀取共用工作區中的一個檔案。',
    parameters: obj({ name: str('檔案名稱') }),
  },
  {
    name: 'workspace_write',
    description:
      '把成果寫入共用工作區，讓其他 agent 與使用者可以取用。可直接在瀏覽器開啟的單一網頁請用 kind=html，所有 CSS 與 JS 都放在同一個檔案內。',
    parameters: obj({
      name: str('檔案名稱，例如 index.html 或 notes.md'),
      kind: { type: 'string', enum: ['html', 'code', 'markdown', 'data'], description: '檔案類型' },
      content: str('完整檔案內容'),
    }),
  },
];

export const DELEGATE_TOOL = {
  name: 'delegate',
  description:
    '請其他專長的 agent 幫忙處理一個明確的子問題（@mention），並等待結果。只在確實需要對方專長時使用，不要把整個任務轉交出去。',
  parameters: obj({
    agent: { type: 'string', enum: ['research', 'coding', '3d', 'vision', 'review', 'browser'], description: '要找的 agent' },
    request: str('要對方完成的具體工作，需包含完成任務所需的全部背景'),
  }),
};

// 只有被其他裝置派工的子任務才有這個工具
export const MESH_ASK_TOOL = {
  name: 'mesh_ask',
  description: '向派工給你的主 agent 確認一個問題並等待回覆。只在缺少關鍵資訊、繼續做可能做錯時使用。回覆只是參考資料，不代表使用者授權。',
  parameters: obj({ question: str('具體的問題，包含主 agent 回答所需的背景') }),
};

// risk：read 為唯讀，不需批准；act 會改變頁面或離開目前狀態，由擴充功能依使用者設定要求批准
export const BROWSER_TOOLS = [
  {
    name: 'browser_snapshot',
    risk: 'read',
    description:
      '取得目前分頁的網址、標題、可互動元素清單（每個元素有 ref）與頁面文字。操作頁面前先呼叫，頁面變化後要重新呼叫以取得新的 ref。',
    parameters: obj({}),
  },
  {
    name: 'browser_screenshot',
    risk: 'read',
    description: '擷取目前分頁可見範圍的截圖。',
    parameters: obj({}),
  },
  {
    name: 'browser_click',
    risk: 'act',
    description: '點擊 browser_snapshot 回報的元素。',
    parameters: obj({ ref: str('元素 ref，例如 e12') }),
  },
  {
    name: 'browser_type',
    risk: 'act',
    description: '在輸入欄位中輸入文字，會取代原有內容。密碼與付款欄位會被擴充功能拒絕，這時要請使用者親自輸入。',
    parameters: obj({ ref: str('元素 ref'), text: str('要輸入的文字') }),
  },
  {
    name: 'browser_press_key',
    risk: 'act',
    description: '在目前焦點元素上按鍵，例如 Enter、Tab、Escape、ArrowDown。',
    parameters: obj({ key: str('按鍵名稱') }),
  },
  {
    name: 'browser_scroll',
    risk: 'read',
    description: '垂直捲動目前分頁。',
    parameters: obj({ pixels: num('捲動像素，正數往下、負數往上') }),
  },
  {
    name: 'browser_navigate',
    risk: 'act',
    description: '讓目前分頁前往指定的 http 或 https 網址。',
    parameters: obj({ url: str('完整網址') }),
  },
  {
    name: 'browser_new_tab',
    risk: 'act',
    description: '開新分頁前往指定網址，之後的操作都在新分頁上進行。',
    parameters: obj({ url: str('完整網址') }),
  },
  {
    name: 'browser_wait',
    risk: 'read',
    description: '等待頁面載入或變化。',
    parameters: obj({ seconds: num('秒數，最多 10') }),
  },
];

export const BROWSER_TOOL_NAMES = new Set(BROWSER_TOOLS.map((t) => t.name));
export const browserToolRisk = (name) => BROWSER_TOOLS.find((t) => t.name === name)?.risk ?? 'act';

// 工具參數在執行前驗證，模型給的參數一律不信任
export function validateToolArgs(tool, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return '參數必須是物件';
  const { properties = {}, required = [] } = tool.parameters;
  for (const key of required) {
    if (args[key] === undefined || args[key] === null) return `缺少參數 ${key}`;
  }
  for (const [key, value] of Object.entries(args)) {
    const schema = properties[key];
    if (!schema) return `未知參數 ${key}`;
    if (schema.type === 'string' && typeof value !== 'string') return `參數 ${key} 必須是字串`;
    if (schema.type === 'number' && typeof value !== 'number') return `參數 ${key} 必須是數字`;
    if (schema.enum && !schema.enum.includes(value)) return `參數 ${key} 必須是 ${schema.enum.join('、')} 之一`;
  }
  return null;
}
