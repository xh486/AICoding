package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"review-ai/model"
)

// reviewDiff 调 DeepSeek API 审查 diff
func reviewDiff(apiKey, diff string) ([]model.ReviewResult, error) {
	reqBody := map[string]interface{}{
		"model": "deepseek-chat",
		"messages": []map[string]string{
			{"role": "system", "content": reviewSystemPrompt},
			{"role": "user", "content": diff},
		},
		"temperature": 0.3,
	}

	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", "https://api.deepseek.com/v1/chat/completions", bytes.NewReader(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("DeepSeek 请求失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var dsResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &dsResp); err != nil {
		return nil, fmt.Errorf("解析 DeepSeek 响应失败: %w", err)
	}

	if len(dsResp.Choices) == 0 {
		return nil, fmt.Errorf("DeepSeek 返回空响应")
	}

	content := dsResp.Choices[0].Message.Content

	// DeepSeek 可能返回带 ```json 包裹的内容，需要提取
	content = extractJSON(content)

	var results []model.ReviewResult
	if err := json.Unmarshal([]byte(content), &results); err != nil {
		return nil, fmt.Errorf("解析审查结果失败: %w\n原始内容: %s", err, content)
	}

	return results, nil
}

// extractJSON 从 markdown 代码块中提取 JSON
func extractJSON(s string) string {
	// 去掉 ```json 和 ``` 包裹
	for i := 0; i < len(s); i++ {
		if s[i] == '[' || s[i] == '{' {
			s = s[i:]
			break
		}
	}
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == ']' || s[i] == '}' {
			s = s[:i+1]
			break
		}
	}
	return s
}
