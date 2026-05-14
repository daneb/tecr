# Changelog

All notable changes to the TECR VS Code extension will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.0.1] — 2026-05-13

### Added
- `@tecr` chat participant wired to a local `tecr-mcp` server via stdio MCP transport
- Commands: `map`, `outline`, `read`, `search`, `grep`, `refs`, `delegate`
- Settings: `tecr.mcpServerPath`, `tecr.contextWindow`, `tecr.localModelUrl`, `tecr.telemetryEnabled`
- Graceful server shutdown on extension deactivation
- Workspace trust declaration (extension spawns a child process)
