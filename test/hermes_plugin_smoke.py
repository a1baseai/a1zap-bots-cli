import asyncio
import importlib.util
import sys
import types
from dataclasses import dataclass, field
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ADAPTER_PATH = ROOT / "hermes-plugin" / "a1zap" / "adapter.py"


def install_gateway_stubs():
    gateway_module = types.ModuleType("gateway")
    config_module = types.ModuleType("gateway.config")
    platforms_module = types.ModuleType("gateway.platforms")
    base_module = types.ModuleType("gateway.platforms.base")
    registry_module = types.ModuleType("gateway.platform_registry")
    status_module = types.ModuleType("gateway.status")
    locks = set()

    class Platform(str):
        pass

    class BasePlatformAdapter:
        def __init__(self, config, platform):
            self.config = config
            self.platform = platform
            self.connected = False

        def build_source(self, **kwargs):
            return kwargs

        def _mark_connected(self):
            self.connected = True

        def _mark_disconnected(self):
            self.connected = False

    class MessageType:
        TEXT = "text"

    class MessageEvent:
        def __init__(
            self,
            text,
            message_type,
            source,
            raw_message=None,
            message_id=None,
            media_urls=None,
            media_types=None,
            reply_to_message_id=None,
            metadata=None,
        ):
            self.text = text
            self.message_type = message_type
            self.source = source
            self.raw_message = raw_message
            self.message_id = message_id
            self.media_urls = media_urls or []
            self.media_types = media_types or []
            self.reply_to_message_id = reply_to_message_id
            self.metadata = metadata or {}

    class SendResult:
        def __init__(self, success, message_id=None):
            self.success = success
            self.message_id = message_id

    @dataclass
    class PlatformEntry:
        name: str
        label: str
        adapter_factory: object
        check_fn: object
        validate_config: object = None
        is_connected: object = None
        required_env: list = field(default_factory=list)
        install_hint: str = ""
        source: str = "plugin"
        plugin_name: str = ""
        allowed_users_env: str = ""
        allow_all_env: str = ""
        max_message_length: int = 0
        pii_safe: bool = False
        emoji: str = ""
        allow_update_command: bool = True
        platform_hint: str = ""

    config_module.Platform = Platform
    base_module.BasePlatformAdapter = BasePlatformAdapter
    base_module.MessageEvent = MessageEvent
    base_module.MessageType = MessageType
    base_module.SendResult = SendResult
    registry_module.PlatformEntry = PlatformEntry
    status_module.acquire_scoped_lock = lambda namespace, key: False if (namespace, key) in locks else not locks.add((namespace, key))
    status_module.release_scoped_lock = lambda namespace, key: locks.discard((namespace, key))

    sys.modules["gateway"] = gateway_module
    sys.modules["gateway.config"] = config_module
    sys.modules["gateway.platforms"] = platforms_module
    sys.modules["gateway.platforms.base"] = base_module
    sys.modules["gateway.platform_registry"] = registry_module
    sys.modules["gateway.status"] = status_module

    return PlatformEntry


def load_adapter():
    install_gateway_stubs()
    spec = importlib.util.spec_from_file_location("a1zap_adapter_under_test", ADAPTER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeConfig:
    extra = {
        "base_url": "https://api.example.com",
        "agent_id": "agent_123",
        "api_key": "key_secret",
    }


class FakeManifest:
    name = "a1zap"


class FakeManager:
    def __init__(self):
        self._plugin_platform_names = set()


class FakeCtx:
    def __init__(self, platform_entry):
        self.manifest = FakeManifest()
        self._manager = FakeManager()
        self.platform_entry = platform_entry
        self.entry = None

    def register_platform(self, name, label, adapter_factory, check_fn, validate_config=None, required_env=None, install_hint="", **entry_kwargs):
        entry_kwargs.setdefault("plugin_name", self.manifest.name)
        self.entry = self.platform_entry(
            name=name,
            label=label,
            adapter_factory=adapter_factory,
            check_fn=check_fn,
            validate_config=validate_config,
            required_env=required_env or [],
            install_hint=install_hint,
            source="plugin",
            **entry_kwargs,
        )
        self._manager._plugin_platform_names.add(name)


def test_register_filters_unsupported_future_fields():
    module = load_adapter()
    platform_entry = sys.modules["gateway.platform_registry"].PlatformEntry
    ctx = FakeCtx(platform_entry)
    module.register(ctx)

    assert ctx.entry.name == "a1zap"
    assert ctx.entry.label == "A1Zap"
    assert ctx.entry.allowed_users_env == "A1ZAP_ALLOWED_USERS"
    assert not hasattr(ctx.entry, "standalone_sender_fn")


def test_send_and_event_conversion():
    module = load_adapter()
    adapter = module.A1ZapPlatformAdapter(FakeConfig())
    calls = []

    def fake_request(method, suffix, body=None, query=None):
        calls.append((method, suffix, body, query))
        return {"success": True, "messageId": "msg_out"}

    adapter._request_json = fake_request
    result = asyncio.run(adapter.send("chat_123", "hello", reply_to="msg_in"))

    assert result.success is True
    assert result.message_id == "msg_out"
    assert calls[0][0] == "POST"
    assert calls[0][1] == "/messages"
    assert calls[0][2]["chatId"] == "chat_123"
    assert calls[0][2]["text"] == "hello"

    event = {
        "type": "message.received",
        "chat": {"id": "chat_123", "name": "Summer chat", "type": "group"},
        "message": {
            "id": "msg_in",
            "chatId": "chat_123",
            "text": "hey look",
            "sender": {
                "conversationUserId": "conversation_user_123",
                "userId": "app_user_123",
                "name": "Pasha",
            },
            "attachments": [
                {
                    "id": "media_1",
                    "kind": "image",
                    "url": "https://cdn.example.com/photo.jpg",
                    "contentType": "image/jpeg",
                }
            ],
            "replyToMessageId": "msg_parent",
        },
    }
    message_event = adapter._to_message_event(event)
    assert message_event.text == "hey look"
    assert message_event.message_id == "msg_in"
    assert message_event.source["chat_id"] == "chat_123"
    assert message_event.source["chat_type"] == "group"
    assert message_event.source["user_id"] == "app_user_123"
    assert message_event.raw_message == event
    assert message_event.media_urls == ["https://cdn.example.com/photo.jpg"]
    assert message_event.media_types == ["image"]
    assert message_event.reply_to_message_id == "msg_parent"
    assert message_event.metadata["a1zap_event"] == event
    assert message_event.metadata["a1zap_user_id"] == "app_user_123"
    assert message_event.metadata["a1zap_conversation_user_id"] == "conversation_user_123"


def test_standalone_send_uses_home_channel_fallback():
    module = load_adapter()
    captured = {}

    class HomeConfig:
        extra = {
            "base_url": "https://api.example.com",
            "agent_id": "agent_123",
            "api_key": "key_secret",
            "home_channel": "home_chat",
        }

    def fake_request(config, method, suffix, body=None, query=None):
        captured.update({"method": method, "suffix": suffix, "body": body, "query": query})
        return {"success": True, "messageId": "cron_msg"}

    module._request_a1zap_json = fake_request
    result = asyncio.run(module._standalone_send(HomeConfig(), None, "background done", thread_id="thread_1"))

    assert result == {"success": True, "message_id": "cron_msg"}
    assert captured["method"] == "POST"
    assert captured["suffix"] == "/messages"
    assert captured["body"]["chatId"] == "home_chat"
    assert captured["body"]["text"] == "background done"


def test_connect_uses_scoped_lock_to_avoid_duplicate_gateways():
    module = load_adapter()

    async def scenario():
        adapter = module.A1ZapPlatformAdapter(FakeConfig())
        adapter._poll_updates = lambda: asyncio.sleep(60)

        connected = await adapter.connect()
        assert connected is True
        assert adapter._lock_acquired is True

        duplicate = module.A1ZapPlatformAdapter(FakeConfig())
        duplicate._poll_updates = lambda: asyncio.sleep(60)
        duplicate_connected = await duplicate.connect()
        assert duplicate_connected is False

        await adapter.disconnect()

        after_release = module.A1ZapPlatformAdapter(FakeConfig())
        after_release._poll_updates = lambda: asyncio.sleep(60)
        connected_again = await after_release.connect()
        assert connected_again is True
        await after_release.disconnect()

    asyncio.run(scenario())


if __name__ == "__main__":
    test_register_filters_unsupported_future_fields()
    test_send_and_event_conversion()
    test_standalone_send_uses_home_channel_fallback()
    test_connect_uses_scoped_lock_to_avoid_duplicate_gateways()
    print("hermes plugin smoke passed")
