.PHONY: test test-frontend test-backend

test: test-frontend test-backend

test-frontend:
	npx vitest run --config src/renderer/vite.config.ts

test-backend:
	cd server && python -m pytest -v
