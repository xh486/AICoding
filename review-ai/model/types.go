package model

import "time"

type User struct {
	ID           int64     `json:"id"`
	GitHubID     int64     `json:"github_id"`
	GitHubLogin  string    `json:"github_username"`
	AccessToken  string    `json:"-"`
	AvatarURL    string    `json:"avatar_url"`
	CreatedAt    time.Time `json:"created_at"`
}

type Review struct {
	ID           int64     `json:"id"`
	UserID       int64     `json:"user_id"`
	RepoFullName string    `json:"repo_full_name"`
	PRNumber     int       `json:"pr_number"`
	PRTitle      string    `json:"pr_title"`
	CommitSHA    string    `json:"commit_sha"`
	DiffContent  string    `json:"diff_content,omitempty"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
}

type ReviewComment struct {
	ID         int64  `json:"id"`
	ReviewID   int64  `json:"review_id"`
	FilePath   string `json:"file_path"`
	LineNumber int    `json:"line_number"`
	Severity   string `json:"severity"`
	Category   string `json:"category"`
	Body       string `json:"body"`
	Suggestion string `json:"suggestion"`
}

// DeepSeek 审查返回的 JSON 结构
type ReviewResult struct {
	File       string `json:"file"`
	Line       int    `json:"line"`
	Severity   string `json:"severity"`
	Category   string `json:"category"`
	Comment    string `json:"comment"`
	Suggestion string `json:"suggestion"`
}
