//go:build windows

package watcher

// watchBudget is how many directories the watcher may watch at once.
//
// **A constant here, and not because reading a limit was too much trouble.**
// The Unix version divides a file-descriptor budget because that is what
// `inotify` and `kqueue` actually consume, and the process has a hard ceiling
// on them. Windows has no equivalent: `fsnotify` uses
// `ReadDirectoryChangesW`, which watches a directory *tree* through one handle
// per root and reports changes beneath it, and handles are not a scarce
// per-process resource in the way descriptors are.
//
// So there is no limit to read, and the number that matters is a different one
// — how many watched roots the app can keep responsive, not how many
// descriptors it can hold. `maxWatchDescriptors` is reused as that ceiling
// because the degrade path it feeds (PLAN.md §10, 7.6) is about the same
// thing: stop before the watcher becomes the reason the app is slow, and say
// so on screen when it happens.
//
// Untested on Windows. Nothing in this project has ever run there.
func watchBudget() int {
	return maxWatchDescriptors
}
