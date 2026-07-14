package handler

import (
	"review-ai/config"
	"review-ai/model"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler 持有所有依赖
type Handler struct {
	cfg *config.Config
	db  *pgxpool.Pool
}

func New(cfg *config.Config, db *pgxpool.Pool) *Handler {
	return &Handler{cfg: cfg, db: db}
}

// ─── 页面渲染 ───

type IndexData struct {
	User *model.User
}

type DashboardData struct {
	User       *model.User
	Reviews    []model.Review
	WebhookURL string
}

type DetailData struct {
	User     *model.User
	Review   model.Review
	Comments []model.ReviewComment
}
