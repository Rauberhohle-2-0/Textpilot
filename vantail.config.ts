import { defineConfig } from '@vantail/cli'

export default defineConfig({
  app: {
    name: 'Textpilot',
    identifier: 'dev.textpilot.app',
    version: '0.1.0',
  },
  window: {
    title: 'Textpilot',
    width: 1280,
    height: 800,
    minWidth: 1280,
    minHeight: 800,
    // Native macOS window gray (dark). The page itself paints light or
    // dark via CSS `prefers-color-scheme`, so this is only the very
    // first paint before styles load.
    backgroundColor: '#1E1E1E',
    // Native chrome: the page runs to the top edge (titleBarStyle: "hidden")
    // and macOS keeps drawing its own traffic lights - no custom buttons.
    // (Rounded corners via `borderRadius` need `decorations: false`, which
    // removes the frame and the lights with it, so they are off while the
    // native buttons are back.)
    titleBarStyle: 'hidden',
    titleBarHeight: 36,
    // Native traffic lights, parked inside the floating sidebar's chrome
    // row: panel left edge (12px float gap) + chrome padding (~12.8px) +
    // a small inset. `y` drops them below the panel's top border into
    // the chrome band (centered-in-bar would straddle the border and
    // look clipped). Capped by AppKit's button container if too large.
    trafficLightPosition: { x: 28, y: 22 },
  },
  // Explicit app menu (docs/api.md#menu): without `menu` macOS installs the
  // standard menu but labels it with the dev binary name ("vantail-runtime").
  // Defining it here makes both `vantail dev` and the packaged build show
  // "Textpilot". The Edit items are load-bearing on macOS: without copy /
  // paste / undo / selectAll their shortcuts stop working everywhere.
  menu: [
    {
      type: 'submenu',
      label: 'Textpilot',
      items: [
        { type: 'predefined', item: 'about' },
        { type: 'separator' },
        { type: 'predefined', item: 'services' },
        { type: 'separator' },
        { type: 'predefined', item: 'hide' },
        { type: 'predefined', item: 'hideOthers' },
        { type: 'predefined', item: 'showAll' },
        { type: 'separator' },
        { type: 'predefined', item: 'quit' },
      ],
    },
    {
      type: 'submenu',
      label: 'Edit',
      items: [
        { type: 'predefined', item: 'undo' },
        { type: 'predefined', item: 'redo' },
        { type: 'separator' },
        { type: 'predefined', item: 'cut' },
        { type: 'predefined', item: 'copy' },
        { type: 'predefined', item: 'paste' },
        { type: 'predefined', item: 'selectAll' },
      ],
    },
    {
      type: 'submenu',
      label: 'Window',
      items: [
        { type: 'predefined', item: 'minimize' },
        { type: 'predefined', item: 'maximize' },
        { type: 'predefined', item: 'fullscreen' },
        { type: 'separator' },
        { type: 'predefined', item: 'closeWindow' },
        { type: 'predefined', item: 'bringAllToFront' },
      ],
    },
  ],
  permissions: {
    network: {
      allow: ['127.0.0.1', 'localhost'],
    },
    // The compiled server, shipped inside the bundle.
    //
    // `$RESOURCE` is the directory the packaged assets land in, so this
    // names the binary `bun run build` wrote into `dist/`. Development
    // never reaches this rule - there the window points straight at a
    // server that is already running (`src/dev.ts`, `src/main.ts`).
    //
    // No arguments are allowed at all: `args: []` is a rule per position,
    // and there are no positions.
    shell: {
      allow: [{ program: '$RESOURCE/server', args: [] }],
    },
  },
})
