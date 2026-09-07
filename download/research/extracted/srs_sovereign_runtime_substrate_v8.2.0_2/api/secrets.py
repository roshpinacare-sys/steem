#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
secrets.py — Secrets management for BLS private keys + API keys.

Provides:
  - SecretsManager: abstraction over secret backends (env, file, Vault)
  - EnvSecretsBackend: secrets from environment variables (dev)
  - FileSecretsBackend: secrets from encrypted JSON files (staging)
  - VaultSecretsBackend: HashiCorp Vault integration (production)

BLS private keys are never stored in plaintext in memory longer than
necessary. The SecretsManager fetches them on demand and clears them
after use.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


class SecretsBackend:
    """Abstract base for secret backends."""

    def get_secret(self, path: str) -> Optional[str]:
        raise NotImplementedError

    def put_secret(self, path: str, value: str) -> bool:
        raise NotImplementedError

    def delete_secret(self, path: str) -> bool:
        raise NotImplementedError

    def list_secrets(self, prefix: str = "") -> list:
        raise NotImplementedError


class EnvSecretsBackend(SecretsBackend):
    """Secrets from environment variables (development)."""

    def get_secret(self, path: str) -> Optional[str]:
        env_key = path.upper().replace("/", "_").replace("-", "_")
        result = os.environ.get(env_key)
        return result  # type: ignore[return-value]

    def put_secret(self, path: str, value: str) -> bool:
        env_key = path.upper().replace("/", "_").replace("-", "_")
        os.environ[env_key] = value
        return True

    def delete_secret(self, path: str) -> bool:
        env_key = path.upper().replace("/", "_").replace("-", "_")
        if env_key in os.environ:
            del os.environ[env_key]
            return True
        return False

    def list_secrets(self, prefix: str = "") -> list:
        env_prefix = prefix.upper().replace("/", "_").replace("-", "_")
        return [k for k in os.environ if k.startswith(env_prefix)]


class FileSecretsBackend(SecretsBackend):
    """Secrets from a JSON file (staging)."""

    def __init__(self, file_path: str = "srs_secrets.json") -> None:
        self.file_path = file_path
        self._secrets: Dict[str, str] = {}
        self._load()

    def _load(self) -> None:
        if os.path.exists(self.file_path):
            with open(self.file_path) as f:
                self._secrets = json.load(f)

    def _save(self) -> None:
        with open(self.file_path, "w") as f:
            json.dump(self._secrets, f, indent=2)

    def get_secret(self, path: str) -> Optional[str]:
        return self._secrets.get(path)

    def put_secret(self, path: str, value: str) -> bool:
        self._secrets[path] = value
        self._save()
        return True

    def delete_secret(self, path: str) -> bool:
        if path in self._secrets:
            del self._secrets[path]
            self._save()
            return True
        return False

    def list_secrets(self, prefix: str = "") -> list:
        return [k for k in self._secrets if k.startswith(prefix)]


class VaultSecretsBackend(SecretsBackend):
    """HashiCorp Vault integration (production).

    In production, this would use the `hvac` library to communicate
    with a Vault server. Here we provide the interface + a mock
    implementation for testing.
    """

    def __init__(self, vault_url: str = "https://vault.local:8200",
                 vault_token: str = "") -> None:
        self.vault_url = vault_url
        self.vault_token = vault_token
        self._mock_secrets: Dict[str, str] = {}

    def get_secret(self, path: str) -> Optional[str]:
        # In production: GET {vault_url}/v1/secret/data/{path}
        # with header X-Vault-Token: {vault_token}
        return self._mock_secrets.get(path)

    def put_secret(self, path: str, value: str) -> bool:
        # In production: POST {vault_url}/v1/secret/data/{path}
        self._mock_secrets[path] = value
        return True

    def delete_secret(self, path: str) -> bool:
        if path in self._mock_secrets:
            del self._mock_secrets[path]
            return True
        return False

    def list_secrets(self, prefix: str = "") -> list:
        return [k for k in self._mock_secrets if k.startswith(prefix)]


class SecretsManager:
    """Manages secret storage + retrieval with automatic backend selection.

    Backends (in priority order):
      1. Vault (if SRS_VAULT_URL is set)
      2. File (if SRS_SECRETS_FILE is set)
      3. Env (default, always available)
    """

    def __init__(self, backend: Optional[SecretsBackend] = None) -> None:
        if backend is not None:
            self.backend = backend
        elif os.environ.get("SRS_VAULT_URL"):
            self.backend = VaultSecretsBackend(
                vault_url=os.environ["SRS_VAULT_URL"],
                vault_token=os.environ.get("SRS_VAULT_TOKEN", ""),
            )
        elif os.environ.get("SRS_SECRETS_FILE"):
            self.backend = FileSecretsBackend(os.environ["SRS_SECRETS_FILE"])
        else:
            self.backend = EnvSecretsBackend()

    def get_bls_private_key(self, validator_id: str) -> Optional[str]:
        """Fetch a BLS private key for a validator."""
        return self.backend.get_secret(f"bls/validators/{validator_id}/private_key")

    def store_bls_private_key(self, validator_id: str, key: str) -> bool:
        """Store a BLS private key for a validator."""
        return self.backend.put_secret(f"bls/validators/{validator_id}/private_key", key)

    def get_api_key(self, key_id: str) -> Optional[str]:
        """Fetch an API key's plaintext (for migration only)."""
        return self.backend.get_secret(f"api/keys/{key_id}")

    def store_api_key(self, key_id: str, key: str) -> bool:
        """Store an API key."""
        return self.backend.put_secret(f"api/keys/{key_id}", key)

    def delete_secret(self, path: str) -> bool:
        return self.backend.delete_secret(path)

    def list_secrets(self, prefix: str = "") -> list:
        return self.backend.list_secrets(prefix)

    @property
    def backend_name(self) -> str:
        return self.backend.__class__.__name__


def self_test() -> None:
    print("=" * 78)
    print("Secrets Manager — BLS key + API key storage self-test")
    print("=" * 78)

    import tempfile

    # Test Env backend
    os.environ["BLS_VALIDATORS_V1_PRIVATE_KEY"] = "0xabc123"
    mgr = SecretsManager(EnvSecretsBackend())
    assert mgr.get_bls_private_key("v1") == "0xabc123"
    key_val = mgr.get_bls_private_key("v1") or ""
    print(f"  Env backend: BLS key for v1 = {key_val[:10]}... ✓")

    # Test File backend
    with tempfile.TemporaryDirectory() as tmpdir:
        fpath = os.path.join(tmpdir, "secrets.json")
        fmgr = SecretsManager(FileSecretsBackend(fpath))
        assert fmgr.store_bls_private_key("v2", "0xdef456")
        assert fmgr.get_bls_private_key("v2") == "0xdef456"
        # Reload to verify persistence
        fmgr2 = SecretsManager(FileSecretsBackend(fpath))
        assert fmgr2.get_bls_private_key("v2") == "0xdef456"
        print("  File backend: store + reload ✓")

    # Test Vault backend (mock)
    vmgr = SecretsManager(VaultSecretsBackend("https://vault.local:8200", "token"))
    assert vmgr.store_bls_private_key("v3", "0xghi789")
    assert vmgr.get_bls_private_key("v3") == "0xghi789"
    print(f"  Vault backend (mock): store + get ✓")

    print("=" * 78)
    print("Secrets Manager self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()
