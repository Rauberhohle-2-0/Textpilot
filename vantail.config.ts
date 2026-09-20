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
  permissions: {
    network: {
      allow: ['127.0.0.1', 'localhost'],
    },
  },
})
