# TITAI v18 Portable Installer

This package contains the complete v18 Capability Foundry release plus a Windows-friendly portable installation layer.

The installer:

- Generates local authentication and encryption secrets.
- Uses the exact `package-lock.json` dependency graph.
- Disables npm lifecycle scripts.
- Applies and validates canonical SQLite migrations.
- Creates the first local administrator and built-in defaults.
- Builds the production application.
- Binds the server to loopback only.
- Provides start, stop, verification, repair, encrypted backup, restore, and uninstall commands.

The first installation downloads the exact locked npm packages. Runtime operation does not require a commercial API key or cloud database.
