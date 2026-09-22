# Textpilot

A Markdown notes app whose notes are just files.

## Where your notes live

Everything lives in a `Textpilot` folder inside your Documents directory:

- **macOS / Windows:** `~/Documents/Textpilot`
- **Linux:** the XDG Documents directory (falls back to `~/Documents/Textpilot`)

Every document is a `.md` file and every folder in the app is a real
directory, so you can edit, move, sync or version them with any other
tool. A document's *filename* is its title in the sidebar: renaming a
document renames its file. Siblings sort by name, folders first, the way
a file manager shows them.

On first launch, notes from older versions (the project-local `data/`
directory) are imported once — copied into the library, never moved out
of it.

## Development

```sh
bun install
bun run dev      # API + Vite + desktop window
bun test
bun run typecheck
```

`bun run dev` uses the real Documents folder. Set `TEXTPILOT_DIR` to
point the library somewhere else, so development never touches your
notes:

```sh
TEXTPILOT_DIR=/tmp/textpilot-dev bun run dev
```
