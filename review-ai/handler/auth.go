package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"review-ai/config"
	"review-ai/model"

	"github.com/gin-gonic/gin"
)

// Login 重定向到 GitHub OAuth
func (h *Handler) Login(c *gin.Context) {
	u := fmt.Sprintf(
		"https://github.com/login/oauth/authorize?client_id=%s&scope=repo",
		h.cfg.GitHubClientID,
	)
	c.Redirect(http.StatusFound, u)
}

// Callback GitHub OAuth 回调
func (h *Handler) Callback(c *gin.Context) {
	code := c.Query("code")
	if code == "" {
		c.String(http.StatusBadRequest, "缺少 code 参数")
		return
	}

	// 1. 用 code 换 access_token
	token, err := exchangeCodeForToken(code, h.cfg)
	if err != nil {
		c.String(http.StatusInternalServerError, "换取 token 失败: %v", err)
		return
	}

	// 2. 用 token 拿用户信息
	ghUser, err := fetchGitHubUser(token)
	if err != nil {
		c.String(http.StatusInternalServerError, "获取用户信息失败: %v", err)
		return
	}

	// 3. 写入或更新数据库
	user, err := h.upsertUser(c, ghUser, token)
	if err != nil {
		c.String(http.StatusInternalServerError, "保存用户失败: %v", err)
		return
	}

	// 4. 种 cookie
	setCurrentUser(c, user)

	c.Redirect(http.StatusFound, "/dashboard")
}

// ─── GitHub API 调用 ───

func exchangeCodeForToken(code string, cfg *config.Config) (string, error) {
	data := url.Values{
		"client_id":     {cfg.GitHubClientID},
		"client_secret": {cfg.GitHubClientSecret},
		"code":          {code},
	}

	req, _ := http.NewRequest("POST", "https://github.com/login/oauth/access_token", strings.NewReader(data.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if result.Error != "" {
		return "", fmt.Errorf("OAuth error: %s", result.Error)
	}
	return result.AccessToken, nil
}

func fetchGitHubUser(token string) (*model.User, error) {
	req, _ := http.NewRequest("GET", "https://api.github.com/user", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var ghUser struct {
		ID        int64  `json:"id"`
		Login     string `json:"login"`
		AvatarURL string `json:"avatar_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&ghUser); err != nil {
		return nil, err
	}

	return &model.User{
		GitHubID:    ghUser.ID,
		GitHubLogin: ghUser.Login,
		AvatarURL:   ghUser.AvatarURL,
	}, nil
}

// upsertUser 存在就更新 token，不存在就插入
func (h *Handler) upsertUser(c *gin.Context, ghUser *model.User, token string) (*model.User, error) {
	var user model.User
	err := h.db.QueryRow(
		context.Background(),
		`INSERT INTO users (github_id, github_username, access_token, avatar_url)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (github_id)
		 DO UPDATE SET access_token = $3, avatar_url = $4, github_username = $2
		 RETURNING id, github_id, github_username, access_token, avatar_url, created_at`,
		ghUser.GitHubID, ghUser.GitHubLogin, token, ghUser.AvatarURL,
	).Scan(&user.ID, &user.GitHubID, &user.GitHubLogin, &user.AccessToken, &user.AvatarURL, &user.CreatedAt)

	if err != nil {
		return nil, fmt.Errorf("upsert user: %w", err)
	}
	return &user, nil
}
