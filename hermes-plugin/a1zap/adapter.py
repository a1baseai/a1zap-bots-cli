import asyncio
import json
import os
import urllib.error
import urllib.parse
import urllib.request

from gateway.config import Platform
from gateway.platforms.base import (
    BasePlatformAdapter,
    MessageEvent,
    MessageType,
    SendResult,
)


def _env(name, default=""):
    value = os.getenv(name)
    return value.strip() if value else default


def _normalize_base_url(value):
    value = (value or "").strip().rstrip("/")
    if value.endswith(".convex.cloud"):
        return value[: -len(".convex.cloud")] + ".convex.site"
    return value


def _safe_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def check_requirements():
    return bool(_env("A1ZAP_BASE_URL") and _env("A1ZAP_AGENT_ID") and _env("A1ZAP_API_KEY"))


def validate_config(config):
    extra = getattr(config, "extra", None) or {}
    return bool(
        (extra.get("base_url") or _env("A1ZAP_BASE_URL"))
        and (extra.get("agent_id") or _env("A1ZAP_AGENT_ID"))
        and (extra.get("api_key") or _env("A1ZAP_API_KEY"))
    )


def _env_enablement():
    if not check_requirements():
        return None
    return {
        "base_url": _normalize_base_url(_env("A1ZAP_BASE_URL")),
        "agent_id": _env("A1ZAP_AGENT_ID"),
        "api_key": _env("A1ZAP_API_KEY"),
        "home_channel": _env("A1ZAP_HOME_CHANNEL"),
        "poll_interval_ms": _env("A1ZAP_POLL_INTERVAL_MS", "2000"),
        "update_limit": _env("A1ZAP_UPDATE_LIMIT", "25"),
        "long_poll_seconds": _env("A1ZAP_LONG_POLL_SECONDS", "25"),
    }


def _config_values(config):
    extra = getattr(config, "extra", None) or {}
    return {
        "base_url": _normalize_base_url(extra.get("base_url") or _env("A1ZAP_BASE_URL")),
        "agent_id": extra.get("agent_id") or _env("A1ZAP_AGENT_ID"),
        "api_key": extra.get("api_key") or _env("A1ZAP_API_KEY"),
        "home_channel": extra.get("home_channel") or _env("A1ZAP_HOME_CHANNEL"),
    }


def _request_a1zap_json(config, method, suffix, body=None, query=None):
    values = _config_values(config)
    base_url = values["base_url"]
    agent_id = values["agent_id"]
    api_key = values["api_key"]
    if not base_url or not agent_id or not api_key:
        raise RuntimeError("A1Zap requires A1ZAP_BASE_URL, A1ZAP_AGENT_ID, and A1ZAP_API_KEY")

    path = f"/v1/bots/{urllib.parse.quote(str(agent_id), safe='')}{suffix}"
    url = urllib.parse.urljoin(base_url + "/", path.lstrip("/"))
    if query:
        clean_query = {key: value for key, value in query.items() if value not in (None, "")}
        if clean_query:
            url = url + "?" + urllib.parse.urlencode(clean_query)
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json",
            "X-API-Key": api_key,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8")
        raise RuntimeError(f"A1Zap {method} {suffix} failed with HTTP {error.code}: {raw}") from error
    return json.loads(raw) if raw else {}


def _normalize_chat_type(value):
    raw = str(value or "").lower()
    if raw in ("dm", "direct", "direct_message", "individual", "private"):
        return "dm"
    if raw in ("channel", "broadcast", "campus", "community", "community_wide"):
        return "channel"
    return "group"


def _attachment_url(attachment):
    if not isinstance(attachment, dict):
        return None
    for key in ("url", "downloadUrl", "imageUrl", "publicUrl"):
        value = attachment.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _attachment_kind(attachment):
    if not isinstance(attachment, dict):
        return "document"
    kind = str(attachment.get("kind") or "").lower()
    content_type = str(attachment.get("contentType") or "").lower()
    if kind in ("image", "photo") or content_type.startswith("image/"):
        return "image"
    if kind == "video" or content_type.startswith("video/"):
        return "video"
    if kind in ("audio", "voice") or content_type.startswith("audio/"):
        return "audio"
    return "document"


def _message_type_for(kind, text):
    if text.startswith("/"):
        return getattr(MessageType, "COMMAND", MessageType.TEXT)
    if kind == "image":
        return getattr(MessageType, "PHOTO", MessageType.TEXT)
    if kind == "video":
        return getattr(MessageType, "VIDEO", MessageType.TEXT)
    if kind == "audio":
        return getattr(MessageType, "AUDIO", MessageType.TEXT)
    if kind == "document":
        return getattr(MessageType, "DOCUMENT", MessageType.TEXT)
    return MessageType.TEXT


def _adapter_lock_key(base_url, agent_id):
    return f"{_normalize_base_url(base_url)}:{agent_id}"


def _acquire_adapter_lock(base_url, agent_id):
    try:
        from gateway.status import acquire_scoped_lock
    except Exception:
        return True
    return acquire_scoped_lock("a1zap", _adapter_lock_key(base_url, agent_id))


def _release_adapter_lock(base_url, agent_id):
    try:
        from gateway.status import release_scoped_lock
    except Exception:
        return
    release_scoped_lock("a1zap", _adapter_lock_key(base_url, agent_id))


async def _standalone_send(
    pconfig,
    chat_id,
    message,
    *,
    thread_id=None,
    media_files=None,
    force_document=False,
):
    target_chat_id = chat_id or _config_values(pconfig)["home_channel"]
    if not target_chat_id:
        return {"error": "A1Zap standalone delivery needs chat_id or A1ZAP_HOME_CHANNEL"}
    body = {
        "chatId": target_chat_id,
        "text": message,
        "replyToMessageId": thread_id,
        "metadata": {
            "source": "hermes-a1zap-standalone",
            "mediaFiles": media_files or [],
            "forceDocument": bool(force_document),
        },
    }
    result = await asyncio.to_thread(_request_a1zap_json, pconfig, "POST", "/messages", body, None)
    message_id = result.get("messageId") or (result.get("message") or {}).get("id")
    return {"success": bool(result.get("success", True)), "message_id": message_id}


class A1ZapPlatformAdapter(BasePlatformAdapter):
    def __init__(self, config):
        try:
            platform = Platform("a1zap")
        except Exception:
            platform = "a1zap"
        super().__init__(config, platform)
        self.config = config
        extra = getattr(config, "extra", None) or {}
        self.base_url = _normalize_base_url(extra.get("base_url") or _env("A1ZAP_BASE_URL"))
        self.agent_id = extra.get("agent_id") or _env("A1ZAP_AGENT_ID")
        self.api_key = extra.get("api_key") or _env("A1ZAP_API_KEY")
        self.home_channel = extra.get("home_channel") or _env("A1ZAP_HOME_CHANNEL")
        self.poll_interval_ms = _safe_int(extra.get("poll_interval_ms") or _env("A1ZAP_POLL_INTERVAL_MS", "2000"), 2000)
        self.update_limit = _safe_int(extra.get("update_limit") or _env("A1ZAP_UPDATE_LIMIT", "25"), 25)
        self.long_poll_seconds = _safe_int(extra.get("long_poll_seconds") or _env("A1ZAP_LONG_POLL_SECONDS", "25"), 25)
        self._cursor = None
        self._running = False
        self._poll_task = None
        self._lock_acquired = False

    async def connect(self):
        if not self.base_url or not self.agent_id or not self.api_key:
            raise RuntimeError("A1Zap requires A1ZAP_BASE_URL, A1ZAP_AGENT_ID, and A1ZAP_API_KEY")
        if not _acquire_adapter_lock(self.base_url, self.agent_id):
            print("[a1zap] another Hermes gateway process is already using this A1Zap agent")
            return False
        self._lock_acquired = True
        self._running = True
        self._poll_task = asyncio.create_task(self._poll_updates())
        self._mark_connected()
        return True

    async def disconnect(self):
        self._running = False
        if self._poll_task:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
            self._poll_task = None
        if self._lock_acquired:
            _release_adapter_lock(self.base_url, self.agent_id)
            self._lock_acquired = False
        self._mark_disconnected()

    async def send(self, chat_id, content, reply_to=None, metadata=None, **_kwargs):
        body = {
            "chatId": chat_id,
            "text": content,
            "replyToMessageId": reply_to,
            "metadata": {
                **(metadata or {}),
                "source": (metadata or {}).get("source", "hermes-a1zap-platform"),
            },
        }
        result = await asyncio.to_thread(self._request_json, "POST", "/messages", body, None)
        message_id = result.get("messageId") or (result.get("message") or {}).get("id")
        return SendResult(success=bool(result.get("success", True)), message_id=message_id)

    async def get_chat_info(self, chat_id):
        try:
            result = await asyncio.to_thread(
                self._request_json,
                "GET",
                f"/chats/{urllib.parse.quote(str(chat_id), safe='')}/participants",
                None,
                None,
            )
        except Exception:
            return {"id": chat_id, "name": str(chat_id), "type": "chat"}
        participants = result.get("participants") or []
        return {
            "id": chat_id,
            "name": ", ".join(p.get("name") for p in participants if p.get("name")) or str(chat_id),
            "type": "group" if len(participants) > 2 else "dm",
            "participants": participants,
        }

    async def send_typing(self, chat_id, is_typing=True, **_kwargs):
        try:
            await asyncio.to_thread(
                self._request_json,
                "POST",
                f"/chats/{urllib.parse.quote(str(chat_id), safe='')}/typing",
                {"isTyping": bool(is_typing)},
                None,
            )
            return True
        except Exception as error:
            print(f"[a1zap] typing update failed: {error}")
            return False

    async def _poll_updates(self):
        while self._running:
            try:
                query = {
                    "cursor": self._cursor,
                    "limit": self.update_limit,
                    "timeout": max(0, min(self.long_poll_seconds, 30)),
                }
                result = await asyncio.to_thread(self._request_json, "GET", "/updates", None, query)
                self._cursor = result.get("cursor") or self._cursor
                for event in result.get("events") or []:
                    message_event = self._to_message_event(event)
                    if message_event:
                        await self.handle_message(message_event)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                print(f"[a1zap] polling failed: {error}")
            await asyncio.sleep(max(self.poll_interval_ms, 250) / 1000)

    def _to_message_event(self, event):
        if event.get("type") != "message.received":
            return None
        message = event.get("message") or {}
        text = message.get("text") or message.get("content") or ""
        if not text and not message.get("attachments"):
            return None
        chat = event.get("chat") or {}
        sender = message.get("sender") or {}
        chat_id = message.get("chatId") or chat.get("id")
        if not chat_id:
            return None
        source = self.build_source(
            chat_id=str(chat_id),
            chat_name=chat.get("name") or str(chat_id),
            chat_type=_normalize_chat_type(chat.get("type") or chat.get("category")),
            user_id=str(sender.get("userId") or sender.get("id") or sender.get("conversationUserId") or "unknown"),
            user_name=sender.get("name") or sender.get("handle") or "A1Zap user",
            message_id=message.get("id"),
        )
        attachments = message.get("attachments") or []
        media_urls = [url for url in (_attachment_url(item) for item in attachments) if url]
        media_types = [_attachment_kind(item) for item in attachments if _attachment_url(item)]
        primary_kind = media_types[0] if media_types else "text"
        metadata = {
            "a1zap_event": event,
            "a1zap_user_id": sender.get("userId"),
            "a1zap_conversation_user_id": sender.get("conversationUserId"),
            "attachments": attachments,
            "richContentBlocks": message.get("richContentBlocks"),
            "replyToMessageId": message.get("replyToMessageId"),
        }
        try:
            return MessageEvent(
                text=text,
                message_type=_message_type_for(primary_kind, text),
                source=source,
                raw_message=event,
                message_id=message.get("id"),
                media_urls=media_urls,
                media_types=media_types,
                reply_to_message_id=message.get("replyToMessageId"),
                metadata=metadata,
            )
        except TypeError:
            try:
                return MessageEvent(
                    text=text,
                    message_type=_message_type_for(primary_kind, text),
                    source=source,
                    message_id=message.get("id"),
                    metadata=metadata,
                )
            except TypeError:
                return MessageEvent(
                    text=text,
                    message_type=_message_type_for(primary_kind, text),
                    source=source,
                    message_id=message.get("id"),
                )

    def _request_json(self, method, suffix, body=None, query=None):
        return _request_a1zap_json(self.config, method, suffix, body, query)


def register(ctx):
    try:
        from gateway.platform_registry import PlatformEntry

        supported_entry_fields = set(getattr(PlatformEntry, "__dataclass_fields__", {}).keys())
    except Exception:
        supported_entry_fields = set()

    entry_kwargs = {
        "is_connected": validate_config,
        "allowed_users_env": "A1ZAP_ALLOWED_USERS",
        "allow_all_env": "A1ZAP_ALLOW_ALL_USERS",
        "max_message_length": 4000,
        "emoji": "A1",
        "platform_hint": "You are chatting via A1Zap. Keep replies social, concise, and useful in a live group chat.",
    }
    future_kwargs = {
        "env_enablement_fn": _env_enablement,
        "cron_deliver_env_var": "A1ZAP_HOME_CHANNEL",
        "standalone_sender_fn": _standalone_send,
    }
    if supported_entry_fields:
        entry_kwargs = {
            key: value
            for key, value in {**entry_kwargs, **future_kwargs}.items()
            if key in supported_entry_fields
        }

    ctx.register_platform(
        name="a1zap",
        label="A1Zap",
        adapter_factory=lambda cfg: A1ZapPlatformAdapter(cfg),
        check_fn=check_requirements,
        validate_config=validate_config,
        required_env=["A1ZAP_BASE_URL", "A1ZAP_AGENT_ID", "A1ZAP_API_KEY"],
        **entry_kwargs,
    )
