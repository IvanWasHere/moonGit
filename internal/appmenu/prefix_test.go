package appmenu

import (
	"testing"

	"github.com/wailsapp/wails/v2/pkg/menu"
)

// The macOS-only menu roles, and why they must not travel (PLAN.md §11, 8.16).
//
// `menu.AppMenu()` and `menu.EditMenu()` return a MenuItem carrying only a
// Role — no Label, no SubMenu — which macOS expands into real menus. Wails'
// Windows menu builder reads Label and SubMenu and ignores Role entirely, so
// prepending them there produces two blank entries in the menu bar and no Edit
// menu at all.
//
// This takes the OS as an argument precisely so it can be checked from a Mac.
// Nothing in this project has ever run on Windows, and a test that could only
// fail on a machine nobody has is not a test.
func TestMenuPrefixIsMacOnly(t *testing.T) {
	t.Run("macOS gets the app menu and Edit", func(t *testing.T) {
		prefix := menuPrefix("darwin")
		if len(prefix) != 2 {
			t.Fatalf("darwin: got %d prefix items, want 2", len(prefix))
		}
		// Roles, not labels — that is what macOS expands. If these ever gain a
		// label, the assumption behind the Windows branch has changed.
		for i, item := range prefix {
			if item.Label != "" {
				t.Errorf("darwin: prefix item %d has label %q; these are roles", i, item.Label)
			}
			var noRole menu.Role
			if item.Role == noRole {
				t.Errorf("darwin: prefix item %d carries no role", i)
			}
		}
	})

	// The whole point. Omitting Edit costs Windows nothing — the webview
	// handles clipboard shortcuts itself — while including it costs two blank
	// entries in the menu bar.
	for _, goos := range []string{"windows", "linux", "freebsd"} {
		t.Run(goos+" gets nothing", func(t *testing.T) {
			if prefix := menuPrefix(goos); len(prefix) != 0 {
				t.Fatalf("%s: got %d prefix items, want 0", goos, len(prefix))
			}
		})
	}
}
