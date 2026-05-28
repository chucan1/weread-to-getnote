# weread-to-getnote

> 微信读书笔记一键导入 Get 笔记 — Claude Code Skill

将微信读书中的划线摘录和读书想法，自动导入 Get 笔记并归入知识库。全程 AI 辅助，一条指令完成。

## 效果

```
你：/weread-to-getnote ← 把《智人之上》的笔记导一下
AI：已拉取 12 条划线、3 条想法，格式如下，确认保存？
你：确认
AI：已保存 ✓ 推荐加入「读书摘录」知识库，是否加入？
你：加入
AI：已加入知识库 ✓
```

## 安装

### 前置条件

- Claude Code 已安装
- 微信读书账号
- Get 笔记账号

### 1. 安装微信读书 Skill

```bash
claude skills add Tencent/WeChatReading
```

### 2. 安装 Get 笔记 CLI

从 [releases](https://github.com/iswalle/getnote-cli/releases) 下载并安装 `getnote-cli`，然后认证：

```bash
getnote auth login --api-key gk_live_xxxxx
```

### 3. 安装本 Skill

将此仓库克隆或下载到 Claude Code 项目目录，或直接复制 `.claude/skills/weread-to-getnote/` 到你的项目：

```bash
# 方式一：作为项目 skill
cp -r weread-to-getnote/ your-project/.claude/skills/

# 方式二：作为全局 skill
cp -r weread-to-getnote/ ~/.claude/skills/
```

### 4. 配置环境变量

在 Claude Code 的 `settings.local.json` 中配置：

```json
{
  "env": {
    "WEREAD_API_KEY": "wrk-xxxxxxxx"
  }
}
```

微信读书 API Key 获取方式：App → 我 → 设置 → 网络接入助手。

### 5. 验证

```bash
# 验证微信读书 API
curl -s -X POST https://i.weread.qq.com/api/agent/gateway \
  -H "Authorization: Bearer $WEREAD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"api_name":"/user/notebooks","count":5,"skill_version":"1.0.3"}'

# 验证 Get 笔记
getnote auth status
```

## 使用

调用 `/weread-to-getnote` 后按提示操作：

1. **告诉 AI 要导入什么** — 书名、指定划线、全部笔记、最新一条等
2. **确认格式** — 默认 Markdown 格式，可调整
3. **AI 拉取并整理** — 自动从微信读书拉取数据
4. **确认保存** — 内容确认后写入 Get 笔记
5. **加入知识库** — AI 推荐知识库，你批准后加入

### 示例

```
/weread-to-getnote 帮我把《黑客与画家》里关于设计的划线导几条
```

## Skill 优化

本项目使用 [达尔文 skill](https://github.com/anthropics/claude-code/tree/main/skills/darwin-skill) 进行持续优化。当前评分 **84/100**（基线 40）。

优化维度：
- 前置安装引导（新用户可跟）
- API 指令具体性（完整 curl 示例）
- 边界条件覆盖（13 类错误处理）
- 批量导入规则

## 协议

MIT
