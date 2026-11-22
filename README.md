# Milky Client
Electron launcher for Minecraft (Fabric). Requires Node 18+ and Java (21 for MC 1.20.5+, 17 for older).

    npm install
    npm start          # run it
    npm run dist       # build installer (.exe / .dmg / AppImage) into dist/

Sign-in uses the Microsoft OAuth flow via the `msmc` library; tokens stay in memory only.
For public release, register your own Azure app and pass its client ID to msmc.
New profiles install: Fabric API, Sodium, Lithium, FerriteCore, ImmediatelyFast, More Culling, Dynamic FPS, ModernFix.
