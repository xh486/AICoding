.PHONY: run build dev

run:
	export $$(grep -v '^#' .env.local | xargs) && go run .

build:
	go build -o review-ai.exe .

dev:
	export $$(grep -v '^#' .env.local | xargs) && go run .
