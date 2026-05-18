from core.ollama_client import check_ollama


def test_ollama_unavailable_gracefully():
    status = check_ollama("http://127.0.0.1:9/api/chat")
    assert not status.running
    assert "Local play still works" in status.error
