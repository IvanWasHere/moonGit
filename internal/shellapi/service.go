// Package shellapi exposes the few OS integrations the frontend needs.
package shellapi

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"runtime"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type Service struct {
	ctx context.Context
}

func New() *Service { return &Service{} }

func (s *Service) Startup(ctx context.Context) { s.ctx = ctx }

// OpenExternal opens a URL in the user's browser.
//
// The scheme is validated first. Repository data — remote URLs, commit trailers,
// branch descriptions — reaches this function, and that content is not
// trustworthy just because it came from a repo the user cloned. Allowing
// file:// or a custom scheme here would turn a malicious remote URL into
// arbitrary local execution.
func (s *Service) OpenExternal(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("not a valid URL: %w", err)
	}
	switch u.Scheme {
	case "http", "https", "mailto":
		wruntime.BrowserOpenURL(s.ctx, rawURL)
		return nil
	default:
		return fmt.Errorf("refusing to open scheme %q", u.Scheme)
	}
}

// RevealInFinder shows a path in the OS file manager with it selected.
func (s *Service) RevealInFinder(path string) error {
	if _, err := os.Stat(path); err != nil {
		return err
	}
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", "-R", path).Start()
	case "windows":
		return exec.Command("explorer", "/select,"+path).Start()
	default:
		return exec.Command("xdg-open", path).Start()
	}
}
