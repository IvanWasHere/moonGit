# Documentation assets

Images referenced by the root `README.md`. Nothing here is imported by the app —
these are documentation only, and none of them are required for a build.

## Expected files

| File | Used for | Suggested spec |
|---|---|---|
| `icon.png` | The centred icon at the top of the README | Square, 200–256px, transparent background so it sits on both GitHub themes |
| `screenshots/workspace.png` | Main view — the whole layout | 2× (Retina), window only, no desktop behind it |
| `screenshots/diff.png` | Diff viewer with hunk staging | 2×, cropped to the Changes pane |
| `screenshots/history.png` | Commit graph and search | 2×, cropped to the Journal pane |
| `screenshots/merge.png` | Three-way conflict resolver | 2×, the modal only |

## Capturing them

`⌘⇧4` then `space` captures a single window with its shadow, at the display's
native scale. Seed a repository with something worth looking at first:

```sh
make seed        # puts testGitHere/test-repo{1,2} into a rich state
make dev
```

Two things worth getting right, because they are the difference between a
screenshot that reads and one that does not:

- **Use one theme throughout.** Mixing light and dark shots across the four
  cells makes the table look like four different applications. Dark is the
  design's native state — the token set was lifted from a dark mockup and the
  light theme is a Phase 6.8 derivation.
- **Crop to the feature.** A full 1440×900 window shrunk into a table cell
  shows nothing legible. Three of the four are better cropped to the pane the
  caption is about.

## The app icon is not this icon

`build/appicon.png` is still the stock Wails logo and is what the *built
application* uses. `docs/icon.png` is for the README. Replacing one does not
replace the other — see the note in the root README.
