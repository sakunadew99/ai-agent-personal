"""One process for free hosting (Render free plan): the Sakuna API plus the MCP server.

Requests whose path starts with /mcp go to the MCP app; everything else goes to the API.
The MCP app keeps calling the API over HTTP with the user's token (unchanged behaviour), here on
127.0.0.1 inside the same container. Both apps' lifespans are started and stopped together.
"""
import importlib.util
import os
from contextlib import AsyncExitStack
from pathlib import Path

PORT = os.getenv("PORT", "10000")
os.environ.setdefault("BACKEND_URL", f"http://127.0.0.1:{PORT}")

from app.main import app as api_app  # noqa: E402  (backend package)

# The MCP service also names its package "app", so load its module from file under another name.
_spec = importlib.util.spec_from_file_location("sakuna_mcp_main", Path(__file__).with_name("sakuna_mcp_main.py"))
_mcp_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mcp_module)
mcp_app = _mcp_module.app


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        message = await receive()
        assert message["type"] == "lifespan.startup"
        async with AsyncExitStack() as stack:
            try:
                await stack.enter_async_context(api_app.router.lifespan_context(api_app))
                await stack.enter_async_context(mcp_app.router.lifespan_context(mcp_app))
            except Exception as exc:  # report startup failure to the server instead of hanging
                await send({"type": "lifespan.startup.failed", "message": repr(exc)})
                return
            await send({"type": "lifespan.startup.complete"})
            await receive()  # lifespan.shutdown
        await send({"type": "lifespan.shutdown.complete"})
        return
    if scope["type"] in ("http", "websocket") and scope.get("path", "").startswith("/mcp"):
        await mcp_app(scope, receive, send)
    else:
        await api_app(scope, receive, send)
