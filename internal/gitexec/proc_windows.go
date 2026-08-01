//go:build windows

package gitexec

import "os/exec"

// configureProcessGroup is a no-op on Windows for now. The equivalent is a Job
// Object that child processes are assigned to and terminated with; that work
// belongs to the cross-platform milestone (PLAN.md §Future Roadmap). Until
// then the default single-process kill applies, and cmd.WaitDelay bounds how
// long Wait can block on inherited pipes.
func configureProcessGroup(cmd *exec.Cmd) {}
