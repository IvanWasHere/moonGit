package main

import (
	"context"
	"embed"
	"log"

	"moongit/internal/creds"
	"moongit/internal/dialogs"
	"moongit/internal/fsapi"
	"moongit/internal/gitexec"
	"moongit/internal/ptyapi"
	"moongit/internal/shellapi"
	"moongit/internal/store"
	"moongit/internal/watcher"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	// Each service owns one native capability and nothing else. None of them
	// know what a commit or a branch is — that is TypeScript's job (PLAN.md §4).
	gitSvc := gitexec.New()
	fsSvc := fsapi.New()
	watchSvc := watcher.New()
	dialogSvc := dialogs.New()
	shellSvc := shellapi.New()
	storeSvc := store.New()
	credsSvc := creds.New()
	ptySvc := ptyapi.New()

	err := wails.Run(&options.App{
		Title:     "moonGit",
		Width:     1440,
		Height:    900,
		MinWidth:  900,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		// Matches --bg-darkest so there is no white flash before the webview paints.
		BackgroundColour: &options.RGBA{R: 0x0d, G: 0x11, B: 0x17, A: 1},

		OnStartup: func(ctx context.Context) {
			app.startup(ctx)
			gitSvc.Startup(ctx)
			watchSvc.Startup(ctx)
			dialogSvc.Startup(ctx)
			shellSvc.Startup(ctx)
			ptySvc.Startup(ctx)
			// A failed store is not fatal: the app works without persisted
			// preferences, and refusing to launch over a settings file would be
			// a bad trade. The frontend sees it via Store.Info().open == false.
			if err := storeSvc.Startup(ctx); err != nil {
				log.Printf("store unavailable, continuing without persistence: %v", err)
			}
		},
		OnShutdown: func(_ context.Context) {
			// Before the store, and unlike everything else here: a terminal
			// session is a child *process*, and closing the window does not
			// end it. Without this a quit leaves an orphaned shell — and
			// whatever it was running — alive with no way back to it.
			ptySvc.Shutdown()
			_ = storeSvc.Close()
		},

		Mac: &mac.Options{
			// The design supplies its own 60px menubar, so the native title bar
			// is hidden and the traffic lights float over it. The frontend
			// reserves space for them via the --titlebar-inset token.
			TitleBar:   mac.TitleBarHiddenInset(),
			Appearance: mac.NSAppearanceNameDarkAqua,
			About: &mac.AboutInfo{
				Title:   "moonGit",
				Message: "A native macOS Git client.\nCopyright © 2026 Ivan Marinkovic",
			},
		},

		Bind: []interface{}{
			app,
			gitSvc,
			fsSvc,
			watchSvc,
			dialogSvc,
			shellSvc,
			storeSvc,
			credsSvc,
			ptySvc,
		},
	})

	if err != nil {
		log.Fatalf("wails: %v", err)
	}
}
