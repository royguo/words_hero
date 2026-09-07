#!/usr/bin/env python3
"""Optional Edge worker. JSON arrives on stdin; stdout contains only MP3 bytes."""
import asyncio
import json
import sys

import edge_tts


async def main():
    request = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    speech = edge_tts.Communicate(request["text"], request["voice"], rate=request["rate"],
                                  connect_timeout=8, receive_timeout=15)
    async for chunk in speech.stream():
        if chunk["type"] == "audio":
            sys.stdout.buffer.write(chunk["data"])


if __name__ == "__main__":
    try:
        asyncio.run(asyncio.wait_for(main(), timeout=28))
    except Exception as exc:
        # Do not log educational text, keys, or service request URLs.
        print(type(exc).__name__, file=sys.stderr)
        sys.exit(1)
