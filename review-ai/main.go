package main

import (
	"log"

	"review-ai/config"
	"review-ai/handler"
	"review-ai/store"

	"github.com/gin-gonic/gin"
)

func main() {
	cfg := config.Load()

	// 初始化数据库连接
	db, err := store.Connect(cfg.SupabaseDBURL)
	if err != nil {
		log.Fatalf("数据库连接失败: %v", err)
	}
	defer db.Close()

	h := handler.New(cfg, db)

	r := gin.Default()

	// 静态文件
	r.Static("/static", "./static")

	// 加载模板
	r.LoadHTMLGlob("template/*")

	// ─── 页面路由 ───
	r.GET("/", h.Index)
	r.GET("/dashboard", h.Dashboard)
	r.GET("/review/:id", h.ReviewDetail)

	// ─── API 路由 ───
	r.GET("/api/auth/login", h.Login)
	r.GET("/api/auth/callback", h.Callback)
	r.GET("/api/reviews", h.ListReviews)
	r.GET("/api/reviews/:id", h.GetReview)

	// ─── Webhook ───
	r.POST("/api/webhook/github", h.GitHubWebhook)

	log.Printf("🚀 review-ai 启动在 %s", cfg.Addr)
	if err := r.Run(cfg.Addr); err != nil {
		log.Fatalf("服务器启动失败: %v", err)
	}
}
