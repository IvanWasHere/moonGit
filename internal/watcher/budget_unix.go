//go:build !windows

package watcher

import "syscall"

// watchBudget is how many file descriptors the watcher may spend, read from
// the process limit rather than assumed.
//
// A constant would be wrong on both sides: too high and the app dies on a
// machine with a tighter limit, too low and it degrades on a machine that
// could have coped. Go raises the soft limit to 10240 on macOS at startup, but
// that is an implementation detail of the runtime and not a promise.
//
// Split by build tag because `RLIMIT_NOFILE` does not exist on Windows — see
// `budget_windows.go`, which explains why the answer there is a constant and
// why that is not the compromise it looks like.
func watchBudget() int {
	var lim syscall.Rlimit
	if err := syscall.Getrlimit(syscall.RLIMIT_NOFILE, &lim); err != nil {
		return fallbackWatchDescriptors
	}
	// Cur is RLIM_INFINITY on some systems, which overflows int on 32-bit and
	// is meaningless here regardless — the ceiling below is the real answer.
	soft := int64(lim.Cur)
	if soft <= 0 || soft > int64(maxWatchDescriptors+reservedDescriptors) {
		return maxWatchDescriptors
	}
	budget := int(soft) - reservedDescriptors
	if budget < 0 {
		return 0
	}
	return budget
}
