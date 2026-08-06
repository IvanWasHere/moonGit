# moonGit — common tasks.
#
# Note the explicit package list in the Go targets. `./...` also matches a
# vendored Go package inside frontend/node_modules, which is not ours and
# should never be built or tested.
GO_PKGS := . ./internal/...

.PHONY: dev build test test-go test-web lint typecheck check seed seed-reset \
        seed-large seed-large-clean bench fonts bindings clean

dev:            ## run the app with hot reload
	wails dev

build:          ## produce a packaged .app
	wails build

bindings:       ## regenerate TypeScript bindings from the Go services
	rm -rf frontend/wailsjs/go
	wails generate module

test: test-go test-web

test-go:
	go test $(GO_PKGS)

test-web:
	cd frontend && npm run test

lint:
	go vet $(GO_PKGS)
	cd frontend && npm run lint

typecheck:
	cd frontend && npm run typecheck

check: lint typecheck test  ## everything CI would run

seed:           ## put testGitHere/test-repo{1,2} into a rich state
	./scripts/seed-test-repos.sh --yes

seed-reset:     ## restore the test repos to pristine origin/main
	./scripts/seed-test-repos.sh --reset

seed-large:     ## generate the 500k-file and 1M-commit bench repos (~4 min, ~2.1G)
	./scripts/seed-large-repo.sh

seed-large-clean: ## delete them
	./scripts/seed-large-repo.sh --clean

bench:          ## time the app's own git commands against them (PLAN.md §10)
	cd frontend && npm run bench

fonts:          ## re-vendor JetBrains Mono + Space Grotesk
	./scripts/vendor-fonts.sh

clean:
	rm -rf build/bin frontend/dist frontend/coverage
