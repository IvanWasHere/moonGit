// Package dialogs wraps Wails' native file and message dialogs.
package dialogs

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type Service struct {
	ctx context.Context
}

func New() *Service { return &Service{} }

func (s *Service) Startup(ctx context.Context) { s.ctx = ctx }

// SelectDirectory opens a folder picker. An empty string means the user
// cancelled — that is a normal outcome, not an error.
func (s *Service) SelectDirectory(title, defaultDir string) (string, error) {
	return runtime.OpenDirectoryDialog(s.ctx, runtime.OpenDialogOptions{
		Title:                title,
		DefaultDirectory:     defaultDir,
		CanCreateDirectories: true,
	})
}

func (s *Service) SelectFile(title, defaultDir string) (string, error) {
	return runtime.OpenFileDialog(s.ctx, runtime.OpenDialogOptions{
		Title:            title,
		DefaultDirectory: defaultDir,
	})
}

func (s *Service) SaveFile(title, defaultDir, defaultFilename string) (string, error) {
	return runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{
		Title:            title,
		DefaultDirectory: defaultDir,
		DefaultFilename:  defaultFilename,
	})
}

// MessageOptions describes a native alert. Kind is one of
// "info" | "warning" | "error" | "question".
type MessageOptions struct {
	Kind          string   `json:"kind"`
	Title         string   `json:"title"`
	Message       string   `json:"message"`
	Buttons       []string `json:"buttons,omitempty"`
	DefaultButton string   `json:"defaultButton,omitempty"`
	CancelButton  string   `json:"cancelButton,omitempty"`
}

// ShowMessage displays a native dialog and returns the chosen button's label.
func (s *Service) ShowMessage(opts MessageOptions) (string, error) {
	return runtime.MessageDialog(s.ctx, runtime.MessageDialogOptions{
		Type:          dialogType(opts.Kind),
		Title:         opts.Title,
		Message:       opts.Message,
		Buttons:       opts.Buttons,
		DefaultButton: opts.DefaultButton,
		CancelButton:  opts.CancelButton,
	})
}

func dialogType(kind string) runtime.DialogType {
	switch kind {
	case "warning":
		return runtime.WarningDialog
	case "error":
		return runtime.ErrorDialog
	case "question":
		return runtime.QuestionDialog
	default:
		return runtime.InfoDialog
	}
}
