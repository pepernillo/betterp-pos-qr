from django.conf import settings
from django.contrib.auth.hashers import Argon2PasswordHasher


class BetterPArgon2PasswordHasher(Argon2PasswordHasher):
    """Argon2id defaults tuned for BetterP auth latency and Render memory limits."""

    time_cost = int(getattr(settings, "PASSWORD_ARGON2_TIME_COST", 2))
    memory_cost = int(getattr(settings, "PASSWORD_ARGON2_MEMORY_COST", 19456))
    parallelism = int(getattr(settings, "PASSWORD_ARGON2_PARALLELISM", 1))
