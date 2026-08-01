package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

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
		OnStartup:        app.startup,
		Mac: &mac.Options{
			// The design supplies its own 60px menubar, so the native title bar is
			// hidden and the traffic lights float over it. The frontend reserves
			// space for them via the --titlebar-inset token.
			TitleBar:   mac.TitleBarHiddenInset(),
			Appearance: mac.NSAppearanceNameDarkAqua,
			About: &mac.AboutInfo{
				Title:   "moonGit",
				Message: "A native macOS Git client.\nCopyright © 2026 Ivan Marinkovic",
			},
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
