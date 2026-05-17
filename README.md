# 框选解惑

**有疑惑，用框选解惑。** 一个 Chrome 浏览器扩展——框选网页上任意文字，AI 用大白话帮你理解，并一键保存到你的知识库。

---

## 怎么安装？

### 方法一：Edge 浏览器（推荐）

1. 打开 Microsoft Edge，地址栏输入 `edge://extensions`
2. 打开左下角「**开发人员模式**」开关
3. 点击「**加载解压缩的扩展**」
4. 选择本扩展的文件夹 → 确定
5. 完成！扩展图标会出现在右上角工具栏

### 方法二：Chrome 浏览器

1. 打开 Chrome，地址栏输入 `chrome://extensions`
2. 打开右上角「**开发者模式**」开关
3. 点击左上角「**加载已解压的扩展程序**」
4. 选择本扩展的文件夹 → 确定
5. 完成！扩展图标会出现在右上角工具栏

---

## 安装后第一步：配置 API Key

点击右上角扩展图标 → 在弹出的面板中粘贴你的 **API Key**：

- **DeepSeek**：去 [platform.deepseek.com](https://platform.deepseek.com) 注册 → API Keys → 创建密钥
- **OpenAI**：去 [platform.openai.com](https://platform.openai.com) 注册 → API Keys → 创建密钥
- **自定义**：支持任何兼容 OpenAI 接口的服务

填好 API Key 后点「保存并启用」。

---

## 怎么用？

1. **框选文字** — 在任何网页选中让你疑惑的文字
2. **点图标** — 选区旁边会出现一个 🔍 图标，点它
3. **看解释** — 惑惑（你的 AI 助手）会用大白话解释
4. **保存笔记** — 点「📡 同步到知识库」一键存到 Obsidian

还可以：
- 点「🔄 换种方式解释」换个角度再讲一遍
- 在弹窗里继续追问
- 按 **Ctrl+Q** 打开自由对话窗口
- 通过 Obsidian Local REST API 一键保存笔记

---

## 功能一览

| 功能 | 说明 |
|------|------|
| AI 解释 | 支持人物、英语单词、专业概念、日常词汇四种模式 |
| 换种方式解释 | 不满意就换个角度再讲 |
| 追问对话 | 弹窗里直接追问 |
| 自由聊天 | Ctrl+Q 或点图标打开独立对话 |
| 保存到知识库 | REST API 直存 或 URI 备用链接 |
| 下载 Markdown | 一键下载笔记文件 |
| 复制 Markdown | 复制到剪贴板，可粘贴到任何笔记软件 |

---

## 保存到 Obsidian（可选）

如果想一键保存解释到笔记：

1. 打开 Obsidian → 左下角齿轮⚙️ →「第三方插件」
2. 关闭安全模式 → 点「浏览」→ 搜索 **Local REST API**
3. 安装并启用 → 点插件右侧齿轮 →「Create new key」
4. 复制生成的密钥
5. 在扩展设置中粘贴 Obsidian API Key
6. ⚠️ 保存时需保持 Obsidian 运行

---

## 项目文件

```
├── manifest.json      # 扩展配置
├── background.js      # AI API 调用 + Obsidian 保存
├── content.js         # 网页框选检测 + 弹窗 UI
├── content.css        # 弹窗样式
├── popup.html/js/css  # 工具栏弹出面板
├── options.html/js/css # 设置页面
├── chat.html/js       # 独立聊天页面
└── icons/             # 图标文件
```
