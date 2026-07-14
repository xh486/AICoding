# Code Review AI

GitHub PR 自动代码审查助手。PR 创建/更新时自动触发 DeepSeek 审查，结果以评论形式发布到 PR。

## 技术栈

- **Go** + Gin（HTTP 框架）
- **DeepSeek API**（AI 审查引擎）
- **Supabase Postgres**（数据存储）
- **GitHub OAuth** + Webhook

## 快速开始

```bash
# 1. 装依赖
go mod tidy

# 2. 配环境变量
cp .env.local .env
# 编辑 .env，填入真实 Key

# 3. 建数据库表（在 Supabase SQL Editor 里跑）
# 看下方 SQL

# 4. 启动
make run
# 或 go run .
```

## 数据库建表

```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  github_id BIGINT UNIQUE NOT NULL,
  github_username TEXT NOT NULL,
  access_token TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE reviews (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  repo_full_name TEXT NOT NULL,
  pr_number INT NOT NULL,
  pr_title TEXT NOT NULL,
  commit_sha TEXT,
  diff_content TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE review_comments (
  id BIGSERIAL PRIMARY KEY,
  review_id BIGINT REFERENCES reviews(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  line_number INT,
  severity TEXT NOT NULL,
  category TEXT,
  body TEXT NOT NULL,
  suggestion TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## 项目结构

```
review-ai/
├── main.go           # 入口，路由注册
├── config/           # 环境变量
├── handler/          # HTTP 处理器
│   ├── auth.go       # GitHub OAuth
│   ├── webhook.go    # PR Webhook
│   ├── review.go     # 审查 API
│   ├── reviewer.go   # DeepSeek 审查引擎
│   ├── prompt.go     # 审查 Prompt
│   └── dashboard.go  # 页面渲染
├── model/            # 数据结构
├── store/            # 数据库连接
├── template/         # HTML 模板
└── static/           # CSS
```
