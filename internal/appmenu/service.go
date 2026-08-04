// Package appmenu puts the application's menu into the native macOS menu bar.
//
// The structure is *not* defined here. It is pushed in from the frontend, which
// already holds it as data in `components/menu/menuConfig.ts` and draws the
// in-window menubar from it. Duplicating that list in Go would mean two places
// to add an item to and one of them silently forgotten — the native menu would
// drift from the one drawn in the window, and nothing would fail to compile.
//
// So this service is a native capability and nothing else, like every other
// service under internal/ (PLAN.md §4): it knows how to build an NSMenu and how
// to report a click. What the items *mean* stays in TypeScript, where the
// handlers are.
package appmenu

import (
	"context"
	"errors"
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/menu"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ActionEvent carries the clicked item's id — the same `MenuItemId` the
// in-window menubar passes to its handler map, so both surfaces land in the
// same place.
const ActionEvent = "menu:action"

// Item is one row. The zero SeparatorBefore is the common case.
type Item struct {
	ID              string `json:"id"`
	Label           string `json:"label"`
	SeparatorBefore bool   `json:"separatorBefore"`
}

// Menu is one top-level title and its rows.
type Menu struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Items []Item `json:"items"`
}

type Service struct {
	ctx context.Context
}

func New() *Service { return &Service{} }

func (s *Service) Startup(ctx context.Context) { s.ctx = ctx }

// Set replaces the native application menu with the app menu, Edit, and these.
//
// Those two are prepended here rather than sent from the frontend: they are
// macOS's own, they must come first, and their contents are not ours to choose.
// Everything after them is the caller's.
//
// **Edit is here because removing it breaks the clipboard, not for symmetry.**
// macOS routes ⌘C/⌘X/⌘V/⌘A/⌘Z through menu items; with no Edit menu there are
// none, and WKWebView does not pick them up. Measured, not assumed: typing into
// the app and pressing ⌘C left the system clipboard untouched without this menu
// and copied the selection with it. Wails v2 offers whole-menu roles only —
// there is no per-item Copy role that could be hidden inside the app menu — so
// a visible Edit menu is the price of a working ⌘V.
//
// The Window menu is *not* here: nothing in it works in a frameless window,
// which this app's is (`TitleBarHiddenInset`).
func (s *Service) Set(menus []Menu) error {
	if s.ctx == nil {
		return errors.New("appmenu: not started")
	}

	items := []*menu.MenuItem{menu.AppMenu(), menu.EditMenu()}

	for _, m := range menus {
		if m.Label == "" {
			return fmt.Errorf("appmenu: menu %q has no label", m.ID)
		}

		submenu := menu.NewMenu()
		for _, item := range m.Items {
			if item.ID == "" || item.Label == "" {
				return fmt.Errorf("appmenu: item in %q needs both an id and a label", m.ID)
			}
			if item.SeparatorBefore {
				submenu.Append(menu.Separator())
			}
			// Bound per iteration so every callback reports its own id. Go 1.22
			// scopes the loop variable this way already; the local is here to
			// say that the closure outlives the loop on purpose.
			id := item.ID
			submenu.Append(menu.Text(item.Label, nil, func(_ *menu.CallbackData) {
				wruntime.EventsEmit(s.ctx, ActionEvent, id)
			}))
		}

		items = append(items, menu.SubMenu(m.Label, submenu))
	}

	// No accelerators, deliberately. The frontend owns the app's keyboard
	// shortcuts, and a native accelerator for the same action would fire
	// alongside it rather than instead of it — two handlers, one keystroke.
	wruntime.MenuSetApplicationMenu(s.ctx, menu.NewMenuFromItems(items[0], items[1:]...))
	wruntime.MenuUpdateApplicationMenu(s.ctx)
	return nil
}
