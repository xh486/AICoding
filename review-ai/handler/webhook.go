package handler

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"

	"review-ai/model"

	"github.com/gin-gonic/gin"
)

// GitHubWebhook 接收 GitHub PR webhook
func (h *Handler) GitHubWebhook(c *gin.Context) {
	// 1. 验证签名
	signature := c.GetHeader("X-Hub-Signature-256")
	body, _ := io.ReadAll(c.Request.Body)

	if !verifySignature(h.cfg.GitHubWebhookSecret, signature, body) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "签名验证失败"})
		return
	}

	// 2. 解析事件
	event := c.GetHeader("X-GitHub-Event")
	if event != "pull_request" {
		c.JSON(http.StatusOK, gin.H{"message": "忽略非 PR 事件"})
		return
	}

	var payload struct {
		Action      string `json:"action"`
		Number      int    `json:"number"`
		PullRequest struct {
			Title string `json:"title"`
			Head  struct {
				SHA  string `json:"sha"`
				Repo struct {
					FullName string `json:"full_name"`
				} `json:"repo"`
			} `json:"head"`
		} `json:"pull_request"`
		Repository struct {
			FullName string `json:"full_name"`
			Owner    struct {
				ID int64 `json:"id"`
			} `json:"owner"`
		} `json:"repository"`
	}

	if err := json.Unmarshal(body, &payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无法解析 payload"})
		return
	}

	// 只处理 PR 打开或更新
	if payload.Action != "opened" && payload.Action != "synchronize" {
		c.JSON(http.StatusOK, gin.H{"message": "忽略 action: " + payload.Action})
		return
	}

	repoFullName := payload.Repository.FullName
	prNumber := payload.Number
	prTitle := payload.PullRequest.Title
	commitSHA := payload.PullRequest.Head.SHA

	// 3. 找到仓库 owner 对应的用户（看 webhook 从哪个仓库来的）
	user, err := queryUserByGitHubID(context.Background(), h.db, payload.Repository.Owner.ID)
	if err != nil {
		log.Printf("找不到仓库 owner: %v", err)
		c.JSON(http.StatusOK, gin.H{"message": "用户未注册"})
		return
	}

	// 4. 拉取 PR diff
	diff, err := fetchPRDiff(user.AccessToken, repoFullName, prNumber)
	if err != nil {
		log.Printf("拉取 diff 失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "拉取 diff 失败"})
		return
	}

	// 5. 创建审查记录
	var reviewID int64
	err = h.db.QueryRow(
		context.Background(),
		`INSERT INTO reviews (user_id, repo_full_name, pr_number, pr_title, commit_sha, diff_content, status)
		 VALUES ($1, $2, $3, $4, $5, $6, 'analyzing') RETURNING id`,
		user.ID, repoFullName, prNumber, prTitle, commitSHA, diff,
	).Scan(&reviewID)
	if err != nil {
		log.Printf("创建审查记录失败: %v", err)
	}

	// 6. AI 审查
	go func() {
		results, err := reviewDiff(h.cfg.DeepSeekAPIKey, diff)
		if err != nil {
			log.Printf("AI 审查失败: %v", err)
			h.db.Exec(context.Background(), "UPDATE reviews SET status = 'failed' WHERE id = $1", reviewID)
			return
		}

		// 7. 保存审查意见
		for _, r := range results {
			h.db.Exec(context.Background(),
				`INSERT INTO review_comments (review_id, file_path, line_number, severity, category, body, suggestion)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				reviewID, r.File, r.Line, r.Severity, r.Category, r.Comment, r.Suggestion,
			)
		}

		// 8. 发 PR 评论
		comments := convertToPRComments(results)
		if err := postPRReview(user.AccessToken, repoFullName, prNumber, commitSHA, comments); err != nil {
			log.Printf("发 PR 评论失败: %v", err)
		}

		h.db.Exec(context.Background(), "UPDATE reviews SET status = 'done' WHERE id = $1", reviewID)
	}()

	c.JSON(http.StatusOK, gin.H{
		"message":   "审查已触发",
		"repo":      repoFullName,
		"pr_number": prNumber,
	})
}

func verifySignature(secret, signatureHeader string, body []byte) bool {
	if secret == "" || signatureHeader == "" {
		return false
	}
	// signatureHeader = "sha256=xxxx"
	parts := strings.SplitN(signatureHeader, "=", 2)
	if len(parts) != 2 {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(parts[1]), []byte(expected))
}

func convertToPRComments(results []model.ReviewResult) []PRComment {
	cs := make([]PRComment, len(results))
	for i, r := range results {
		cs[i] = PRComment{
			Path:     r.File,
			Line:     r.Line,
			Severity: r.Severity,
			Category: r.Category,
			Body:     formatReviewComment(r),
		}
	}
	return cs
}

func formatReviewComment(r model.ReviewResult) string {
	s := r.Comment
	if r.Suggestion != "" {
		s += "\n\n**建议修复：**\n```suggestion\n" + r.Suggestion + "\n```"
	}
	return s
}
