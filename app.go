package main

import (
	"context"
	"runtime"
)

// App holds application-level concerns that do not belong to a specific
// service: startup wiring, environment reporting, and shutdown.
type App struct {
	ctx context.Context
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// Environment is what the frontend reads once at boot to decide what it can do.
type Environment struct {
	Platform string `json:"platform"`
	Arch     string `json:"arch"`
	Version  string `json:"version"`
}

func (a *App) Environment() Environment {
	return Environment{
		Platform: runtime.GOOS,
		Arch:     runtime.GOARCH,
		Version:  appVersion,
	}
}

const appVersion = "0.1.0"
