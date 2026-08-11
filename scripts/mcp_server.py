#!/usr/bin/env python3
"""Compatibility facade for the canonical adaptive Python MCP server.

The implementation lives in ``skill/scripts/mcp_server.py``. Public symbols
are re-exported so existing imports from ``scripts.mcp_server`` keep working.
"""
from __future__ import annotations

import importlib.util
import runpy
from pathlib import Path

_CANONICAL_PATH = Path(__file__).resolve().parent.parent / "skill" / "scripts" / "mcp_server.py"
_SPEC = importlib.util.spec_from_file_location("_parasite_skill_canonical_mcp_server", _CANONICAL_PATH)
if _SPEC is None or _SPEC.loader is None:
    raise ImportError(f"cannot load canonical MCP server: {_CANONICAL_PATH}")
_CANONICAL = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_CANONICAL)
for _name in dir(_CANONICAL):
    if not _name.startswith("__"):
        globals()[_name] = getattr(_CANONICAL, _name)


if __name__ == "__main__":
    runpy.run_path(str(_CANONICAL_PATH), run_name="__main__")
