package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"review-ai/model"

	"github.com/gin-gonic/gin"
)

// ─── API ───

// ListReviews 返回用户的审查列表（JSON）
func (h *Handler) ListReviews(c *gin.Context) {
	user := getCurrentUser(c, h)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
		return
	}

	rows, err := h.db.Query(
		context.Background(),
		`SELECT id, user_id, repo_full_name, pr_number, pr_title, COALESCE(commit_sha,''), status, created_at
		 FROM reviews WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
		user.ID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	reviews := []model.Review{}
	for rows.Next() {
		var r model.Review
		if err := rows.Scan(&r.ID, &r.UserID, &r.RepoFullName, &r.PRNumber, &r.PRTitle, &r.CommitSHA, &r.Status, &r.CreatedAt); err != nil {
			continue
		}
		reviews = append(reviews, r)
	}

	c.JSON(http.StatusOK, reviews)
}

// GetReview 返回单次审查详情（JSON）
func (h *Handler) GetReview(c *gin.Context) {
	user := getCurrentUser(c, h)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
		return
	}

	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
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
		c.JSON(http.StatusNotFound, gin.H{"error": "审查记录不存在"})
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	comments := []model.ReviewComment{}
	for rows.Next() {
		var c model.ReviewComment
		if err := rows.Scan(&c.ID, &c.ReviewID, &c.FilePath, &c.LineNumber, &c.Severity, &c.Category, &c.Body, &c.Suggestion); err != nil {
			continue
		}
		comments = append(comments, c)
	}

	c.JSON(http.StatusOK, gin.H{
		"review":   review,
		"comments": comments,
	})
}

// ─── GitHub API 工具函数 ───

// fetchPRDiff 获取 PR 的 diff
func fetchPRDiff(token, repoFullName string, prNumber int) (string, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/pulls/%d", repoFullName, prNumber)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github.v3.diff")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

// postPRReview 向 PR 发送审查评论
func postPRReview(token, repoFullName string, prNumber int, commitSHA string, comments []PRComment) error {
	body := map[string]interface{}{
		"body":  "🤖 **AI Code Review**\n\n以下由 DeepSeek 自动审查，仅供参考。",
		"event": "COMMENT",
		"commit_id": commitSHA,
		"comments": func() []map[string]interface{} {
			cs := make([]map[string]interface{}, 0, len(comments))
			for _, c := range comments {
				cs = append(cs, map[string]interface{}{
					"path": c.Path,
					"line": c.Line,
					"side": "RIGHT",
					"body": c.Body,
				})
			}
			return cs
		}(),
	}

	jsonBody, _ := json.Marshal(body)
	url := fmt.Sprintf("https://api.github.com/repos/%s/pulls/%d/reviews", repoFullName, prNumber)
	req, _ := http.NewRequest("POST", url, strings.NewReader(string(jsonBody)))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("GitHub API error %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

type PRComment struct {
	Path     string
	Line     int
	Body     string
	Severity string
	Category string
}
