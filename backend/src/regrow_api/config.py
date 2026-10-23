from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    data_dir: Path = BACKEND_DIR / "data"
    cors_origins: list[str] = ["http://localhost:5173"]
    public_url: str = "http://localhost:5173"  # where the app + /api are reachable (certificate links)

    rpc_url: str = "https://sepolia.base.org"
    chain_id: int = 84532
    oracle_private_key: str = ""  # legacy single key (used for both roles if the others are unset)
    oracle_private_keys: str = ""  # comma-separated oracle committee signer keys held by this server
    relayer_private_key: str = ""  # pays gas to submit signed data; holds no role
    admin_passcode: str = ""
    gas_tank_private_key: str = ""  # sponsors demo-wallet gas; falls back to the relayer key
    demo_gas_max_wei: int = 5_000_000_000_000_000  # cap per demo-wallet top-up: 0.005 test ETH

    openai_api_key: str = ""
    openai_model: str = "gpt-5-mini"
    ai_daily_budget_usd: float = 0.50  # cap on AI spend per day from live (visitor) calls; pipeline runs are not capped


settings = Settings()
