//go:build !windows

package gitexec

import (
	"os/exec"
	"syscall"
)

// configureProcessGroup puts git into its own process group and makes
// cancellation kill that entire group rather than just git itself.
//
// This is load-bearing, not defensive. git routinely spawns children: ssh
// during fetch/push, credential helpers, external diff and merge tools. Those
// children inherit the stdout pipe, so if only git is killed, cmd.Wait() blocks
// until the *children* exit — and a 200ms timeout silently becomes a 30-second
// hang. Killing the group closes the pipe, so Wait returns immediately.
//
// WaitDelay (set in command()) is the second layer: even if a process somehow
// survives the signal, Wait gives up on I/O after a bounded interval instead of
// waiting forever.
func configureProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		// A negative pid signals the whole process group.
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}
