# moonGit — common tasks.
#
# Note the explicit package list in the Go targets. `./...` also matches a
# vendored Go package inside frontend/node_modules, which is not ours and
# should never be built or tested.
GO_PKGS := . ./internal/...

.PHONY: dev build archcheck crosscheck test test-go test-web lint typecheck check seed seed-reset \
        seed-large seed-large-clean bench fonts bindings clean

dev:            ## run the app with hot reload
	wails dev

# A universal binary, not just this machine's architecture (PLAN.md §11).
#
# `wails build` alone produces whatever the host is — arm64 here — and an
# Intel Mac would refuse to open the result. This is only cheap because the
# project is CGO-free by decision (§1.2, modernc.org/sqlite): with a cgo
# dependency, cross-compiling amd64 from an arm64 host needs a cross toolchain
# and stops being one flag.
build:          ## produce a packaged .app (universal: arm64 + amd64)
	wails build -platform darwin/universal

archcheck:      ## assert the built binary really is universal
	@lipo -info build/bin/moonGit.app/Contents/MacOS/moonGit

bindings:       ## regenerate TypeScript bindings from the Go services
	rm -rf frontend/wailsjs/go
	wails generate module

# Windows and Linux are not shipped, but the Go side is kept compiling for them
# (PLAN.md §11, 8.15) — cheap to check, and it is how a macOS-only API gets
# noticed on the day it is added rather than a year later. Two seconds.
crosscheck:     ## assert the Go side still builds for windows and linux
	@for os in windows linux; do \
		printf '  GOOS=%-8s ' $$os; \
		GOOS=$$os GOARCH=amd64 go build $(GO_PKGS) || exit 1; \
		echo OK; \
	done

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

check: lint typecheck crosscheck test  ## everything CI would run

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
