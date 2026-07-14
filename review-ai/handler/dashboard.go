package handler

import (
	"context"
	"net/http"
	"strconv"

	"review-ai/model"

	"github.com/gin-gonic/gin"
)

// Index 首页
func (h *Handler) Index(c *gin.Context) {
	user := getCurrentUser(c, h)
	c.HTML(http.StatusOK, "index.html", IndexData{User: user})
}

// Dashboard 审查历史
func (h *Handler) Dashboard(c *gin.Context) {
	user := getCurrentUser(c, h)
	if user == nil {
		c.Redirect(http.StatusFound, "/api/auth/login")
		return
	}

	rows, err := h.db.Query(c,
		`SELECT id, user_id, repo_full_name, pr_number, pr_title, COALESCE(commit_sha,''), status, created_at
		 FROM reviews WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
		user.ID,
	)
	if err != nil {
		c.HTML(http.StatusOK, "dashboard.html", DashboardData{User: user, WebhookURL: h.cfg.Addr + "/api/webhook/github"})
		return
	}
	defer rows.Close()

	var reviews []model.Review
	for rows.Next() {
		var r model.Review
		if err := rows.Scan(&r.ID, &r.UserID, &r.RepoFullName, &r.PRNumber, &r.PRTitle, &r.CommitSHA, &r.Status, &r.CreatedAt); err != nil {
			continue
		}
		reviews = append(reviews, r)
	}

	c.HTML(http.StatusOK, "dashboard.html", DashboardData{
		User:       user,
		Reviews:    reviews,
		WebhookURL: h.cfg.Addr + "/api/webhook/github",
	})
}

// ReviewDetail 单次审查详情
func (h *Handler) ReviewDetail(c *gin.Context) {
	user := getCurrentUser(c, h)
	if user == nil {
		c.Redirect(http.StatusFound, "/api/auth/login")
		return
	}

	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.String(http.StatusBadRequest, "无效的 ID")
		return
	}

	// 查审查记录
	var review model.Review
	err = h.db.QueryRow(
		context.Background(),
		`SELECT id, user_id, repo_full_name, pr_number, pr_title, COALESCE(commit_sha,''), status, created_at
		 FROM reviews WHERE id = $1 AND user_id = $2`,
		id, user.ID,
	).Scan(&review.ID, &review.UserID, &review.RepoFullName, &review.PRNumber, &review.PRTitle, &review.CommitSHA, &review.Status, &review.CreatedAt)
	if err != nil {
		c.String(http.StatusNotFound, "审查记录不存在")
		return
	}

	// 查审查意见
	rows, err := h.db.Query(
		context.Background(),
		`SELECT id, review_id, file_path, COALESCE(line_number,0), severity, COALESCE(category,''), body, COALESCE(suggestion,'')
		 FROM review_comments WHERE review_id = $1 ORDER BY severity, id`,
		id,
	)
	if err != nil {
		c.HTML(http.StatusOK, "detail.html", DetailData{User: user, Review: review})
		return
	}
	defer rows.Close()

	var comments []model.ReviewComment
	for rows.Next() {
		var cm model.ReviewComment
		if err := rows.Scan(&cm.ID, &cm.ReviewID, &cm.FilePath, &cm.LineNumber, &cm.Severity, &cm.Category, &cm.Body, &cm.Suggestion); err != nil {
			continue
		}
		comments = append(comments, cm)
	}

	c.HTML(http.StatusOK, "detail.html", DetailData{
		User:     user,
		Review:   review,
		Comments: comments,
	})
}
