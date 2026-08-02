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

// OpenPath opens a local file or directory with the OS default handler.
//
// Deliberately separate from OpenExternal, which refuses every scheme but
// http/https/mailto precisely so a hostile remote URL cannot become a local
// `open`. This one takes a *path* rather than a URL, and the caller is the
// file list — paths that came from `git status`, not from repository content
// that names its own target.
//
// The path must exist. Handing `open` a missing file on macOS produces a
// dialog the app has no control over, which is a worse failure than an error
// the UI can show.
func (s *Service) OpenPath(path string) error {
	if _, err := os.Stat(path); err != nil {
		return err
	}
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", path).Start()
	case "windows":
		return exec.Command("cmd", "/c", "start", "", path).Start()
	default:
		return exec.Command("xdg-open", path).Start()
	}
}

// OpenTerminal opens a terminal with its working directory set to dir.
//
// dir must be a directory: `open -a Terminal <file>` on macOS opens the file
// *in* Terminal as a script, which is not what "open terminal here" means and
// would be a surprising thing to do to somebody's shell script.
func (s *Service) OpenTerminal(dir string) error {
	info, err := os.Stat(dir)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("not a directory: %s", dir)
	}
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", "-a", "Terminal", dir).Start()
	case "windows":
		return exec.Command("cmd", "/c", "start", "cmd", "/K", "cd /d "+dir).Start()
	default:
		// No portable answer on Linux; x-terminal-emulator is the Debian
		// alternatives entry and the closest thing to a convention.
		cmd := exec.Command("x-terminal-emulator")
		cmd.Dir = dir
		return cmd.Start()
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
