package handler

import (
	"context"
	"fmt"

	"review-ai/model"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// getCurrentUser 从 cookie 中获取当前登录用户
// 临时实现：从 cookie 读 github_id，查数据库
func getCurrentUser(c *gin.Context, h *Handler) *model.User {
	cookie, err := c.Cookie("github_id")
	if err != nil {
		return nil
	}

	var user model.User
	err = h.db.QueryRow(
		context.Background(),
		"SELECT id, github_id, github_username, access_token, avatar_url, created_at FROM users WHERE github_id = $1",
		cookie,
	).Scan(&user.ID, &user.GitHubID, &user.GitHubLogin, &user.AccessToken, &user.AvatarURL, &user.CreatedAt)
	if err != nil {
		return nil
	}
	return &user
}

// setCurrentUser 设置登录 cookie
func setCurrentUser(c *gin.Context, user *model.User) {
	c.SetCookie("github_id", fmt.Sprintf("%d", user.GitHubID), 3600*24*7, "/", "", false, true)
}

// 辅助：用 pgxpool 查询
func queryUserByGitHubID(ctx context.Context, db *pgxpool.Pool, githubID int64) (*model.User, error) {
	var user model.User
	err := db.QueryRow(ctx,
		"SELECT id, github_id, github_username, access_token, avatar_url, created_at FROM users WHERE github_id = $1",
		githubID,
	).Scan(&user.ID, &user.GitHubID, &user.GitHubLogin, &user.AccessToken, &user.AvatarURL, &user.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &user, nil
}
