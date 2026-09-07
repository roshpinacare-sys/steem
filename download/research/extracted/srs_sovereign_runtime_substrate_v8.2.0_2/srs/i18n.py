"""Internationalization (i18n) infrastructure for the SRS runtime.

This module sets up ``gettext`` translation plumbing so that user-facing
strings CAN be wrapped in ``_()`` for translation, without forcing every
string to be wrapped today. The default ``NullTranslations`` returns
the input string unchanged, so behavior is identical to a no-op until a
``locale/`` directory with compiled ``.mo`` files is added.

Why a separate module (instead of inline ``import gettext`` in cli.py)?
  - Single source of truth: every module that wants to mark strings
    imports ``_`` from here. Re-binding the translation at runtime
    (e.g. in a future ``srs.cli --lang fr`` flag) only has to update
    ONE place.
  - No circular-import risk: ``srs.cli`` imports ``srs.persistence``
    which imports ``srs.types``; if each of those ``import gettext``
    inline there is no problem, but consolidating into ``srs.i18n``
    keeps the dependency graph obvious.
  - Discoverable: contributors who want to add a translation find the
    entry point by searching for ``i18n`` rather than guessing.

Usage in user-facing modules:

    from srs.i18n import _
    print(_("SRS Runtime v{}").format(version))

When no translation is active, ``_("SRS Runtime v{}")`` returns
``"SRS Runtime v{}"`` — i.e. the input string verbatim — so existing
behavior is unchanged. To activate a translation, set the ``LANGUAGE``
or ``LANG`` environment variable and drop a compiled ``.mo`` file at
``srs/locale/<lang>/LC_MESSAGES/srs.mo`` (the ``LOCALE_DIR`` constant
below is the base directory).

Note: this module is the infrastructure only. Strings are NOT yet
wrapped project-wide — that is a deliberate, separate change because
wrapping every string in one pass would (a) be a huge diff and (b)
require careful review to avoid wrapping non-user-facing strings
(internal log messages, exception messages, debug output). The intent
is that new user-facing strings SHOULD be wrapped, and existing strings
SHOULD be wrapped incrementally as their modules are touched.
"""
from __future__ import annotations

import gettext as _gettext
import os
from pathlib import Path

# Base directory for compiled translations. Layout:
#   LOCALE_DIR /
#     fr /
#       LC_MESSAGES /
#         srs.mo
#     es /
#       LC_MESSAGES /
#         srs.mo
# We default to ``<package_dir>/locale`` so translations ship alongside
# the source. The directory may not exist yet (no translations are
# bundled); ``gettext.translation`` falls back to ``NullTranslations``
# in that case.
LOCALE_DIR: Path = Path(__file__).resolve().parent / "locale"

# Domain name. ``gettext.translation`` looks for
# ``<LOCALE_DIR>/<lang>/LC_MESSAGES/<DOMAIN>.mo``.
DOMAIN: str = "srs"


def _init_translations() -> _gettext.NullTranslations:
    """Initialize the active translation, falling back to no-op.

    Honors the standard ``LANGUAGE`` env var (colon-separated priority
    list, e.g. ``"fr:es"``) first, then ``LANG`` (e.g. ``"fr_FR.UTF-8"``).
    If neither is set, or if no compiled catalog is found for the
    requested language(s), returns a ``NullTranslations`` that passes
    strings through unchanged.

    This is called once at module-load time and the result is bound to
    the module-level ``_`` callable. Re-calling ``_init_translations``
    later (e.g. after a test sets ``LANGUAGE``) returns a fresh
    translation object — useful for testing.
    """
    # Build a candidate language list from LANGUAGE (highest priority)
    # and LANG (lower priority). Strip empty / "C" / "POSIX" entries
    # (those mean "no translation, use the source language").
    candidates: list[str] = []
    language_env = os.environ.get("LANGUAGE", "")
    for lang in language_env.split(":"):
        lang = lang.strip()
        if lang and lang not in ("C", "POSIX"):
            candidates.append(lang)
    lang_env = os.environ.get("LANG", "")
    if lang_env:
        lang_base = lang_env.split(".")[0]  # strip encoding suffix
        if lang_base and lang_base not in ("C", "POSIX"):
            candidates.append(lang_base)
    # If we have no candidates, or no locale dir, use NullTranslations
    # so the runtime works in any environment without compiled catalogs.
    if not candidates or not LOCALE_DIR.is_dir():
        return _gettext.NullTranslations()
    try:
        return _gettext.translation(
            DOMAIN,
            localedir=str(LOCALE_DIR),
            languages=candidates,
            fallback=True,  # return NullTranslations if no .mo found
        )
    except Exception:
        # Defensive: gettext.translation only raises OSError, but a
        # broken catalog file could plausibly raise something else on
        # a future Python version. Fall back to no-op rather than
        # bricking the runtime.
        return _gettext.NullTranslations()


# Module-level translation object. Bound once at import time so callers
# can do ``from srs.i18n import _`` and use ``_("some string")``.
_translations: _gettext.NullTranslations = _init_translations()

# Public callable. ``_("text")`` returns the translated text, or the
# input unchanged if no translation is active.
_ = _translations.gettext


def set_translation(lang: str | None) -> None:
    """Re-bind the module-level ``_`` to a translation for ``lang``.

    Primarily intended for tests and future CLI flags (e.g.
    ``srs --lang fr execute ...``). Pass ``None`` (or ``"C"`` /
    ``"POSIX"``) to reset to the no-op NullTranslations.

    Side effect: mutates the module-level ``_`` callable so existing
    ``from srs.i18n import _`` imports in OTHER modules see the new
    translation. (Python re-binds the name in this module's namespace;
    call sites that imported ``_`` via ``from srs.i18n import _`` keep
    the OLD binding — they must ``import srs.i18n as i18n`` and call
    ``i18n._(...)`` to pick up re-binds. This is a known Python import
    semantics gotcha; for test purposes the re-bind is sufficient
    because tests call ``i18n._`` directly.)
    """
    global _translations, _
    if lang is None or lang in ("C", "POSIX"):
        _translations = _gettext.NullTranslations()
    else:
        if not LOCALE_DIR.is_dir():
            _translations = _gettext.NullTranslations()
        else:
            _translations = _gettext.translation(
                DOMAIN,
                localedir=str(LOCALE_DIR),
                languages=[lang],
                fallback=True,
            )
    _ = _translations.gettext


__all__ = ["_", "set_translation", "LOCALE_DIR", "DOMAIN"]
