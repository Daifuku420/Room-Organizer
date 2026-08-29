# Desktop app

Tauri 2 shell around React + TypeScript. The plan is SVG, drawn in millimetres.

## Run it

    cd desktop
    npm install
    npm run tauri icon        # generates src-tauri/icons from any square PNG
    npm run app               # dev, hot reload
    npm run app:build         # produces an .msi and an .exe installer

First run asks for your server address and the device token from the bootstrap
call. Both are kept in the webview's local storage.

## Requirements

Rust and the MSVC build tools, once:

    winget install Rustlang.Rustup
    winget install Microsoft.VisualStudio.2022.BuildTools

Then add the "Desktop development with C++" workload in the Visual Studio
installer. WebView2 is already present on Windows 11.

## Where things are

    src/geometry.ts      pure plan maths: rotation, clipping, collisions, gaps
    src/api.ts           HTTP client + furniture presets
    src/components/
      Setup.tsx          first-run connection screen
      RoomList.tsx       pick or create a room
      Editor.tsx         holds state, talks to the API
      FloorPlan.tsx      the SVG plan: drag, hatching, dimension strings
      Inspector.tsx      numeric editing for the selection

`geometry.ts` imports nothing. That is deliberate: it is the part with real
logic in it, so it should be testable without a browser or a server.

## Network

HTTP goes through Tauri's http plugin, which runs the request in Rust rather
than the webview. No CORS, and the reachable hosts are pinned in
`src-tauri/capabilities/default.json` — edit that list if the API moves.
