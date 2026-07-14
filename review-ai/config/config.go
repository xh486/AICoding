package config

import "os"

type Config struct {
	DeepSeekAPIKey     string
	SupabaseDBURL      string
	GitHubClientID     string
	GitHubClientSecret string
	GitHubWebhookSecret string
	SessionSecret      string
	Addr               string
}

func Load() *Config {
	return &Config{
		DeepSeekAPIKey:      os.Getenv("DEEPSEEK_API_KEY"),
		SupabaseDBURL:       os.Getenv("SUPABASE_DB_URL"),
		GitHubClientID:      os.Getenv("GITHUB_CLIENT_ID"),
		GitHubClientSecret:  os.Getenv("GITHUB_CLIENT_SECRET"),
		GitHubWebhookSecret: os.Getenv("GITHUB_WEBHOOK_SECRET"),
		SessionSecret:       getEnv("SESSION_SECRET", "dev-secret-change-me"),
		Addr:                getEnv("ADDR", ":8080"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
