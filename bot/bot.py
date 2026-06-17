import asyncio
import os
import re
from dataclasses import dataclass
from typing import Optional

import aiohttp
import discord
from discord import app_commands
from discord.ext import commands
from aiohttp import web
from dotenv import load_dotenv
from appeal_system import setup_appeal, APPEAL_GUILD

load_dotenv()

API_BASE = (os.getenv("MACCLIPPER_API_BASE_URL") or "").strip().rstrip("/")
BOT_SECRET = (os.getenv("MACCLIPPER_BOT_SHARED_SECRET") or "").strip()
TOKEN = (os.getenv("DISCORD_BOT_TOKEN") or "").strip()
HEALTH_PORT = int((os.getenv("PORT") or "8080").strip() or "8080")
LOG_ANALYZER_ENABLED = ((os.getenv("DISCORD_LOG_ANALYZER_ENABLED") or "true").strip().lower() not in {"0", "false", "no"})
LOG_ANALYZER_CHANNEL_IDS = {
    int(value.strip())
    for value in (os.getenv("DISCORD_LOG_ANALYZER_CHANNEL_IDS") or "").split(",")
    if value.strip().isdigit()
}
LOG_ANALYZER_MIN_LINES = 1  # Accept even 1-line logs
LOG_ANALYZER_MAX_CHARS = int((os.getenv("DISCORD_LOG_ANALYZER_MAX_CHARS") or "40000").strip() or "40000")
LOG_ANALYZER_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024  # 2MB


@dataclass
class LogDiagnosis:
    key: str
    title: str
    confidence: str
    why: str
    fix: str
    signals: list[str]


SIGNATURES = [
    {
        "key": "replay-capture-stalled",
        "title": "Replay capture pipeline stalled",
        "confidence": "high",
        "all": [r"replaybuffer", r"warming up|no usable buffered media|requested clip duration exceeds available buffered media"],
        "any": [r"latestpts", r"tail gap", r"capture stalled"],
        "why": "The app is still armed, but the capture timeline stopped advancing so clips cannot be assembled.",
        "fix": "Open MacClipper and trigger recorder restart/rearm. Confirm Screen Recording permission is still granted, then test with a short clip. If this repeats, update to the newest build that includes stalled-capture recovery.",
    },
    {
        "key": "browser-session-expired",
        "title": "Session expired or invalid JWT (browser)",
        "confidence": "high",
        "all": [r"invalid jwt|token is expired|unable to parse or verify signature", r"admin|api|unlisted-clips|creatorprofile|jwt"],
        "any": [r"sign in|session|token|jwt"],
        "why": "Your session token (JWT) is expired or invalid, so protected API calls are failing with 403 errors.",
        "fix": "Sign out and sign in again to refresh your session. If the problem persists, clear cookies and try again.",
    },
    {
        "key": "display-or-permission-missing",
        "title": "No display stream or permission issue",
        "confidence": "high",
        "all": [r"scshareablecontent|display", r"no displays found|permission|not permitted|denied"],
        "any": [r"screen recording", r"tcc", r"capture source"],
        "why": "macOS denied or removed screen-capture access, or no valid display source is available.",
        "fix": "In System Settings > Privacy & Security > Screen Recording, re-enable MacClipper and fully restart the app. Verify at least one display is active and not blocked by capture restrictions.",
    },
    {
        "key": "supabase-auth-lock-contention",
        "title": "Supabase auth lock contention",
        "confidence": "medium",
        "all": [r"lock: sb-.*auth-token", r"stole it|released"],
        "any": [r"getsession", r"session"],
        "why": "Multiple concurrent session reads/refreshes are competing over the same auth token lock.",
        "fix": "Use one shared session resolver and dedupe in-flight auth calls. Avoid parallel direct getSession() calls across components; rely on a single hydration path.",
    },
    {
        "key": "google-oauth-invalid-grant",
        "title": "Google OAuth invalid_grant during CLI auth",
        "confidence": "high",
        "all": [r"invalid_grant", r"code verifier|code_verifier|code challenge|bad request"],
        "any": [r"gcloud", r"oauth"],
        "why": "The OAuth browser/device code was reused or the local verifier became stale.",
        "fix": "Restart login from scratch with a fresh one-time code. Complete auth in one browser tab only, then immediately retry deploy.",
    },
    {
        "key": "email-rate-limited",
        "title": "Signup/reset email rate limited",
        "confidence": "medium",
        "all": [r"rate limit|too many requests", r"email|signup|reset"],
        "any": [r"supabase", r"auth"],
        "why": "Auth provider throttled outbound email requests due to high frequency.",
        "fix": "Wait for cooldown and retry once. Add UX guidance for retry timing and reduce repeated resend attempts in quick succession.",
    },
]


def extract_code_blocks(text: str) -> list[str]:
    return [match.group(1).strip() for match in re.finditer(r"```(?:[a-zA-Z0-9_+-]+)?\n([\s\S]*?)```", text)]


def looks_like_log_text(text: str) -> bool:
    if not text:
        return False
    line_count = text.count("\n") + 1
    if line_count < LOG_ANALYZER_MIN_LINES:
        return False
    lowered = text.lower()
    log_markers = [
        "error",
        "warning",
        "replaybuffer",
        "exception",
        "stack trace",
        "traceback",
        "latency",
        "denied",
        "invalid_grant",
        "auth-token",
    ]
    return any(marker in lowered for marker in log_markers)


def diagnose_log_text(text: str) -> list[LogDiagnosis]:
    lowered = text.lower()
    matches: list[LogDiagnosis] = []
    for signature in SIGNATURES:
        all_patterns = signature.get("all") or []
        any_patterns = signature.get("any") or []
        all_hit = all(re.search(pattern, lowered) for pattern in all_patterns)
        if not all_hit:
            continue
        signals = [pattern for pattern in all_patterns if re.search(pattern, lowered)]
        any_hits = [pattern for pattern in any_patterns if re.search(pattern, lowered)]
        if any_patterns and not any_hits:
            continue
        signals.extend(any_hits)
        matches.append(
            LogDiagnosis(
                key=str(signature["key"]),
                title=str(signature["title"]),
                confidence=str(signature["confidence"]),
                why=str(signature["why"]),
                fix=str(signature["fix"]),
                signals=signals[:6],
            )
        )
    if matches:
        return matches[:3]
    if "error" in lowered or "exception" in lowered or "traceback" in lowered:
        return [
            LogDiagnosis(
                key="generic-runtime-error",
                title="Runtime error detected",
                confidence="low",
                why="Logs include generic error signatures, but no known MacClipper pattern matched with high confidence.",
                fix="Share a longer log window (30-60 seconds before the first error) and include platform/app version so we can correlate root cause.",
                signals=["error", "exception", "traceback"],
            )
        ]
    return []


def diagnosis_embed(diagnoses: list[LogDiagnosis], source: str) -> discord.Embed:
    top = diagnoses[0]
    confidence_badge = {
        "high": "High",
        "medium": "Medium",
        "low": "Low",
    }.get(top.confidence.lower(), top.confidence.title())
    embed = discord.Embed(
        title=f"Log Diagnosis: {top.title}",
        description=f"Primary confidence: **{confidence_badge}**\nSource: {source}",
        color=discord.Color.orange(),
    )
    embed.add_field(name="Likely Cause", value=top.why[:1024], inline=False)
    embed.add_field(name="How To Fix", value=top.fix[:1024], inline=False)
    embed.add_field(name="Matched Signals", value=", ".join(top.signals)[:1024] or "n/a", inline=False)
    if len(diagnoses) > 1:
        alternate = "\n".join(f"- {item.title} ({item.confidence})" for item in diagnoses[1:4])
        embed.add_field(name="Other Possible Issues", value=alternate[:1024], inline=False)
    embed.set_footer(text="MacClipper log analyzer (auto)")
    return embed


def message_channel_allowed(message: discord.Message) -> bool:
    if not isinstance(message.channel, discord.TextChannel):
        return False
    if LOG_ANALYZER_CHANNEL_IDS:
        return message.channel.id in LOG_ANALYZER_CHANNEL_IDS
    name = (message.channel.name or "").lower()
    return "general" in name or "support" in name or "help" in name


@dataclass
class BotConfig:
    staff_role_id: int
    admin_role_id: int
    ticket_category_id: int
    ticket_panel_banner_url: str
    ticket_panel_title: str
    ticket_panel_description: str
    discord_pro_role_id: int
    discord_pro_area_role_id: int
    guild_id: str


def load_bot_config() -> BotConfig:
    return BotConfig(
        staff_role_id=int((os.getenv("DISCORD_STAFF_ROLE_ID") or "0").strip() or "0"),
        admin_role_id=int((os.getenv("DISCORD_ADMIN_ROLE_ID") or "0").strip() or "0"),
        ticket_category_id=int((os.getenv("DISCORD_TICKET_CATEGORY_ID") or "0").strip() or "0"),
        ticket_panel_banner_url=(os.getenv("DISCORD_TICKET_PANEL_BANNER_URL") or "https://macclipper.co/og-image.png").strip(),
        ticket_panel_title=(os.getenv("DISCORD_TICKET_PANEL_TITLE") or "MacClipper Help Desk").strip() or "MacClipper Help Desk",
        ticket_panel_description=(
            os.getenv("DISCORD_TICKET_PANEL_DESCRIPTION")
            or "Choose the reason you need help and we'll open a private ticket instantly. Our team will claim it and keep updates in one clean thread."
        ).strip()
        or "Choose the reason you need help and we'll open a private ticket instantly. Our team will claim it and keep updates in one clean thread.",
        discord_pro_role_id=int((os.getenv("DISCORD_PRO_ROLE_ID") or "0").strip() or "0"),
        discord_pro_area_role_id=int((os.getenv("DISCORD_PRO_AREA_ROLE_ID") or "0").strip() or "0"),
        guild_id=(os.getenv("DISCORD_GUILD_ID") or "").strip(),
    )


bot_config = load_bot_config()
ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")


def update_env_file(updates: dict[str, str]) -> None:
    lines: list[str] = []
    existing: dict[str, int] = {}

    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r", encoding="utf-8") as env_file:
            lines = env_file.read().splitlines()

    for idx, line in enumerate(lines):
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key = line.split("=", 1)[0].strip()
        if key:
            existing[key] = idx

    for key, value in updates.items():
        safe_value = value.replace("\n", " ").strip()
        encoded = f"{key}={safe_value}"
        if key in existing:
            lines[existing[key]] = encoded
        else:
            lines.append(encoded)

    with open(ENV_PATH, "w", encoding="utf-8") as env_file:
        env_file.write("\n".join(lines).strip() + "\n")


def require_env() -> None:
    missing = []
    if not API_BASE:
        missing.append("MACCLIPPER_API_BASE_URL")
    if not BOT_SECRET:
        missing.append("MACCLIPPER_BOT_SHARED_SECRET")
    if not TOKEN:
        missing.append("DISCORD_BOT_TOKEN")
    if missing:
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")


@dataclass
class APIResult:
    ok: bool
    status: int
    data: dict


class MacClipperBot(commands.Bot):
    def __init__(self) -> None:
        intents = discord.Intents.none()
        intents.guilds = True
        intents.guild_messages = True
        intents.message_content = True
        super().__init__(command_prefix="!", intents=intents)
        self.http_session: Optional[aiohttp.ClientSession] = None
        self.synced = False

    async def setup_hook(self) -> None:
        self.http_session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20))
        self.add_view(TicketPanelView())
        setup_appeal(self)

    async def close(self) -> None:
        if self.http_session and not self.http_session.closed:
            await self.http_session.close()
        await super().close()

    async def on_ready(self) -> None:
        if not self.synced:
            await self.tree.sync()
            await self.tree.sync(guild=APPEAL_GUILD)
            self.synced = True
        # Load persisted config from backend
        await _sync_guild_config(self)
        print(f"MacClipper Python bot online as {self.user}")

    async def fetch_attachment_text(self, attachment: discord.Attachment) -> str:
        if attachment.size > LOG_ANALYZER_ATTACHMENT_MAX_BYTES:
            return ""
        assert self.http_session is not None
        try:
            async with self.http_session.get(attachment.url) as response:
                if response.status >= 400:
                    return ""
                raw = await response.read()
                # Always try to decode as text, fallback to utf-8 with replacement
                return raw.decode("utf-8", errors="replace")[:LOG_ANALYZER_MAX_CHARS]
        except Exception:
            return ""

    async def on_message(self, message: discord.Message) -> None:
        if message.author.bot:
            return

        # --- Autoresponder: scan every message for code blocks or code files ---
        code_blocks = extract_code_blocks(message.content or "")
        code_file_found = False
        code_snippet_found = False
        code_text = ""

        # Check attachments for code files
        for attachment in message.attachments[:3]:
            if attachment.filename and any(attachment.filename.lower().endswith(ext) for ext in [".py", ".js", ".ts", ".swift", ".m", ".cpp", ".c", ".h", ".json", ".txt"]):
                code_file_found = True
                code_text = await self.fetch_attachment_text(attachment)
                break

        # If no code file, check for code blocks in message
        if not code_file_found and code_blocks:
            code_snippet_found = True
            code_text = code_blocks[0]

        # If code detected, check if it's MacClipper-related
        if code_file_found or code_snippet_found:
            macclipper_keywords = ["macclipper", "ClipCloud", "AppDelegate", "ClipEditor", "ClipLibrary", "clipcloud", "mac clipper"]
            if not any(kw.lower() in (code_text or "").lower() for kw in macclipper_keywords):
                # Not MacClipper code, auto-respond with info and link
                # Call website API to get a help/share link
                api_result = await self.api_post("/bot/code-link", {"discordUserId": str(message.author.id), "username": str(message.author), "codeSample": code_text[:500]})
                link_url = api_result.data.get("linkURL") if api_result.ok else None
                reply_text = (
                    "👋 I noticed you posted code! If this isn't related to MacClipper, please check our docs or share your code here:"
                )
                if link_url:
                    reply_text += f"\n🔗 {link_url}"
                else:
                    reply_text += "\n(Unable to generate a link right now.)"
                await message.reply(reply_text, mention_author=False)
                await self.process_commands(message)
                return

        # --- Existing log analyzer logic (only in allowed channels) ---
        if LOG_ANALYZER_ENABLED and message.guild and message_channel_allowed(message):
            text_chunks: list[str] = []
            if message.content:
                text_chunks.append(message.content[:LOG_ANALYZER_MAX_CHARS])
                text_chunks.extend(block[:LOG_ANALYZER_MAX_CHARS] for block in extract_code_blocks(message.content))
            for attachment in message.attachments[:3]:
                extracted = await self.fetch_attachment_text(attachment)
                if extracted:
                    text_chunks.append(extracted)
            if text_chunks:
                joined = "\n\n".join(chunk for chunk in text_chunks if chunk).strip()[:LOG_ANALYZER_MAX_CHARS]
                if looks_like_log_text(joined):
                    diagnoses = diagnose_log_text(joined)
                    if diagnoses:
                        source = "message text" if message.content.strip() else "attachments"
                        embed = diagnosis_embed(diagnoses, source=source)
                        await message.reply(embed=embed, mention_author=False)
        await self.process_commands(message)

    async def api_get(self, path: str, params: Optional[dict] = None) -> APIResult:
        assert self.http_session is not None
        url = f"{API_BASE}{path}"
        print(f"[api_get] GET {url} params={params}")
        async with self.http_session.get(url, params=params or {}, headers={"Authorization": f"Bearer {BOT_SECRET}"}) as response:
            print(f"[api_get] status={response.status}")
            payload = {}
            try:
                payload = await response.json(content_type=None)
            except Exception:
                payload = {}
            return APIResult(response.status < 400, response.status, payload if isinstance(payload, dict) else {})

    async def api_post(self, path: str, body: dict) -> APIResult:
        assert self.http_session is not None
        url = f"{API_BASE}{path}"
        print(f"[api_post] POST {url} body={body}")
        async with self.http_session.post(
            url,
            json=body,
            headers={"Authorization": f"Bearer {BOT_SECRET}"},
        ) as response:
            print(f"[api_post] status={response.status}")
            payload = {}
            try:
                payload = await response.json(content_type=None)
                print(f"[api_post] response={payload}")
            except Exception as e:
                print(f"[api_post] json parse error: {e}")
                payload = {}
            return APIResult(response.status < 400, response.status, payload if isinstance(payload, dict) else {})



bot = MacClipperBot()

# --- Discord ↔ Website Linking Commands ---

async def _sync_guild_config(bot_instance: MacClipperBot) -> None:
    """Load persisted config from backend into bot_config."""
    global bot_config
    guild_id = bot_config.guild_id
    if not guild_id:
        return
    result = await bot_instance.api_get("/bot/config", {"guildId": guild_id})
    if not result.ok:
        return
    data = result.data or {}
    pro_role_str = str(data.get("discord_pro_role_id", "") or "").strip()
    area_role_str = str(data.get("discord_pro_area_role_id", "") or "").strip()
    if pro_role_str:
        bot_config.discord_pro_role_id = int(pro_role_str)
    if area_role_str:
        bot_config.discord_pro_area_role_id = int(area_role_str)


async def _assign_pro_role(interaction: discord.Interaction) -> bool:
    pro_role_id = bot_config.discord_pro_role_id
    print(f"[_assign_pro_role] pro_role_id={pro_role_id}, guild={interaction.guild.id if interaction.guild else None}, user={interaction.user.id if interaction.user else None}")
    if not pro_role_id or not interaction.guild:
        print(f"[_assign_pro_role] FAIL: no pro_role_id or guild")
        return False
    role = interaction.guild.get_role(pro_role_id)
    print(f"[_assign_pro_role] role={role}, isinstance_member={isinstance(interaction.user, discord.Member)}")
    if not role or not isinstance(interaction.user, discord.Member):
        print(f"[_assign_pro_role] FAIL: role={role} member={isinstance(interaction.user, discord.Member)}")
        return False
    try:
        await interaction.user.add_roles(role, reason="Linked Discord to MacClipper Pro account")
        print(f"[_assign_pro_role] SUCCESS: assigned role {role.id}")
        return True
    except discord.Forbidden:
        print(f"[_assign_pro_role] FAIL: discord.Forbidden - check role hierarchy and permissions")
        return False
    except Exception as e:
        print(f"[_assign_pro_role] FAIL: {type(e).__name__}: {e}")
        return False


@bot.tree.command(name="link", description="Get a link to connect your Discord to your MacClipper account")
async def link_command(interaction: discord.Interaction) -> None:
    await interaction.response.defer(ephemeral=True)
    user_id = str(interaction.user.id)
    username = str(interaction.user)

    link_url = f"https://macclipper.co/link-discord?discordUserId={user_id}&discordUsername={username}"

    # Check if already linked
    lookup = await bot.api_get(f"/bot/users/lookup", {"discordUserId": user_id})
    already_linked = False
    if lookup.ok and lookup.data.get("user"):
        linked_user = lookup.data["user"]
        linked_discord_id = str(linked_user.get("discordUserId", "") or "")
        if linked_discord_id == user_id:
            already_linked = True
            tier = linked_user.get("subscriptionTier", "free")
            features = linked_user.get("paidFeatures", [])
            has_pro = tier == "pro" or "4k-pro" in features
            if has_pro:
                assigned = await _assign_pro_role(interaction)
                if assigned:
                    await interaction.followup.send(
                        f"✅ Pro role assigned!",
                        ephemeral=True,
                    )
                else:
                    await interaction.followup.send(
                        f"✅ Discord is linked, but I couldn't assign the Pro role.\n"
                        f"Make sure I have **Manage Roles** permission and my role is **above** the Pro role.\n"
                        f"Re-link at:\n{link_url}",
                        ephemeral=True,
                    )
            else:
                await interaction.followup.send(
                    f"ℹ️ Discord is linked but you don't have Pro on this account.\n"
                    f"Link page:\n{link_url}",
                    ephemeral=True,
                )
            return

    # Not yet linked — give the user a URL
    await interaction.followup.send(
        f"🔗 **Link your Discord to MacClipper**\n\n"
        f"1. Visit this link:\n{link_url}\n\n"
        f"2. Sign in with your email (same one you use with MacClipper)\n"
        f"3. Click **Link Discord**\n\n"
        f"After linking, run `/link` again to get your Pro role.",
        ephemeral=True,
    )


@bot.tree.command(name="mc-link-setup", description="Set up Discord server for MacClipper Pro linking")
@app_commands.describe(pro_role="Role to assign to Pro users", area_role="Role for Pro-only areas")
async def mc_link_setup(interaction: discord.Interaction, pro_role: discord.Role, area_role: discord.Role = None) -> None:
    guard = admin_guard(interaction)
    if guard:
        await interaction.response.send_message(guard, ephemeral=True)
        return
    # Save role IDs to local .env and to backend
    updates = {"DISCORD_PRO_ROLE_ID": str(pro_role.id)}
    if area_role:
        updates["DISCORD_PRO_AREA_ROLE_ID"] = str(area_role.id)
    update_env_file(updates)
    # Persist to backend (survives deploys)
    body: dict[str, str] = {"guildId": str(interaction.guild_id) if interaction.guild_id else ""}
    body["discord_pro_role_id"] = str(pro_role.id)
    if area_role:
        body["discord_pro_area_role_id"] = str(area_role.id)
    result = await bot.api_post("/bot/config", body)
    print(f"[mc_link_setup] api_post result: ok={result.ok} status={result.status} data={result.data}")
    # Update in-memory config immediately (no need to wait for next startup sync)
    bot_config.discord_pro_role_id = pro_role.id
    if area_role:
        bot_config.discord_pro_area_role_id = area_role.id
    await interaction.response.send_message(
        f"Pro role set to {pro_role.mention}. Pro-only area role: {area_role.mention if area_role else 'Not set'}\n"
        f"Users who link and have Pro will be assigned these roles.",
        ephemeral=True,
    )


def member_role_ids(interaction: discord.Interaction) -> set[int]:
    if interaction.user is None or not isinstance(interaction.user, discord.Member):
        return set()
    return {role.id for role in interaction.user.roles}


def is_staff(interaction: discord.Interaction) -> bool:
    if interaction.user and isinstance(interaction.user, discord.Member):
        if interaction.user.guild_permissions.manage_channels:
            return True
    roles = member_role_ids(interaction)
    return (bot_config.staff_role_id and bot_config.staff_role_id in roles) or (bot_config.admin_role_id and bot_config.admin_role_id in roles)


def is_admin(interaction: discord.Interaction) -> bool:
    if interaction.user and isinstance(interaction.user, discord.Member):
        if interaction.user.guild_permissions.administrator or interaction.user.guild_permissions.manage_guild:
            return True
    roles = member_role_ids(interaction)
    return bool(bot_config.admin_role_id and bot_config.admin_role_id in roles)


def staff_guard(interaction: discord.Interaction) -> Optional[str]:
    if not is_staff(interaction):
        return "You need staff permissions to use this command."
    return None


def admin_guard(interaction: discord.Interaction) -> Optional[str]:
    if not is_admin(interaction):
        return "You need admin permissions to use this command."
    return None


def api_error(result: APIResult) -> str:
    return result.data.get("error") or result.data.get("message") or f"HTTP {result.status}"


def poll_embed(question: str, options: list[str], vote_counts: list[int]) -> discord.Embed:
    embed = discord.Embed(title="Poll", description=question, color=discord.Color.blurple())
    lines = []
    for idx, option in enumerate(options):
        count = vote_counts[idx] if idx < len(vote_counts) else 0
        lines.append(f"**{idx + 1}.** {option} — `{count}` votes")
    embed.add_field(name="Options", value="\n".join(lines), inline=False)
    return embed


def sanitize_ticket_slug(value: str) -> str:
    lowered = value.lower().strip()
    lowered = re.sub(r"[^a-z0-9]+", "-", lowered)
    lowered = re.sub(r"-+", "-", lowered).strip("-")
    return lowered or "general"


def bot_member(guild: discord.Guild) -> Optional[discord.Member]:
    if not bot.user:
        return None
    return guild.get_member(bot.user.id)


async def create_ticket_for_member(
    interaction: discord.Interaction,
    owner: discord.Member,
    subject: str,
    details: str = "",
    system_context: str = "",
) -> tuple[bool, str]:
    if not interaction.guild or not isinstance(interaction.channel, discord.TextChannel):
        return False, "Use this command in a server text channel."

    if not bot_config.staff_role_id:
        return False, "Set a staff role first with `/mc-config-set` (staff role option)."

    guild = interaction.guild
    current_channel = interaction.channel
    if not isinstance(current_channel, discord.TextChannel):
        return False, "Use this command in a server text channel."

    ticket_slug = sanitize_ticket_slug(subject)
    channel_name = f"ticket-{owner.name}-{ticket_slug}".lower().replace(" ", "-")[:95]

    overwrites: dict[discord.abc.Snowflake, discord.PermissionOverwrite] = {
        guild.default_role: discord.PermissionOverwrite(view_channel=False),
    }
    # Always ensure owner is a discord.Member and gets explicit permissions
    if isinstance(owner, discord.Member):
        overwrites[owner] = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True, attach_files=True)
    else:
        print(f"[WARN] Ticket owner {owner} is not a discord.Member; cannot set channel permissions.")

    staff_role = guild.get_role(bot_config.staff_role_id)
    if staff_role:
        overwrites[staff_role] = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True)

    if bot_config.admin_role_id:
        admin_role = guild.get_role(bot_config.admin_role_id)
        if admin_role:
            overwrites[admin_role] = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True, manage_channels=True)

    me = bot_member(guild)
    if me:
        overwrites[me] = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True, manage_channels=True)

    category = guild.get_channel(bot_config.ticket_category_id) if bot_config.ticket_category_id else None
    ticket_channel = await guild.create_text_channel(channel_name, category=category, overwrites=overwrites)
    # Re-apply owner permissions after creation in case Discord overwrites failed
    if isinstance(owner, discord.Member):
        try:
            await ticket_channel.set_permissions(owner, view_channel=True, send_messages=True, read_message_history=True, attach_files=True)
        except Exception as e:
            print(f"[ERROR] Failed to set ticket owner permissions: {e}")
    else:
        print(f"[WARN] Ticket owner {owner} is not a discord.Member after channel creation.")

    opened = await bot.api_post(
        "/bot/tickets/open",
        {
            "guildId": str(guild.id),
            "channelId": str(current_channel.id),
            "categoryId": str(category.id) if category else "",
            "ticketChannelId": str(ticket_channel.id),
            "ownerUserId": str(owner.id),
            "ownerUsername": str(owner),
            "createdByUserId": str(interaction.user.id),
            "subject": subject,
        },
    )
    if not opened.ok:
        return False, f"Ticket channel created, but API save failed: {api_error(opened)}"

    intro = discord.Embed(
        title="Support Ticket Opened",
        description=(
            f"Owner: {owner.mention}\n"
            f"Category: **{subject}**\n\n"
            "A staff member will claim this ticket shortly."
        ),
        color=discord.Color.green(),
    )
    if details.strip():
        intro.add_field(name="Issue Details", value=details.strip()[:1024], inline=False)
    if system_context.strip():
        intro.add_field(name="System Context", value=system_context.strip()[:1024], inline=False)
    await ticket_channel.send(content=owner.mention, embed=intro)
    return True, ticket_channel.mention


TICKET_MODAL_HINTS: dict[str, dict[str, str]] = {
    "Billing & Subscription": {
        "title_label": "Billing issue title",
        "title_placeholder": "Example: Charged twice for Pro",
        "details_placeholder": "Tell us exactly what happened, when, and any transaction ID or email used.",
    },
    "Install & Setup": {
        "title_label": "Setup issue title",
        "title_placeholder": "Example: Screen recording permission not detected",
        "details_placeholder": "Share your macOS version, where setup fails, and what you've already tried.",
    },
    "Bug Report": {
        "title_label": "Bug summary",
        "title_placeholder": "Example: Clip save fails after hotkey",
        "details_placeholder": "List exact steps to reproduce, expected behavior, and what happened instead.",
    },
    "Account & Access": {
        "title_label": "Account access issue",
        "title_placeholder": "Example: Can't link app to website account",
        "details_placeholder": "Tell us your account email and what access step is failing.",
    },
    "Feature Request": {
        "title_label": "Feature request title",
        "title_placeholder": "Example: Add replay buffer presets",
        "details_placeholder": "Describe the feature, who benefits, and your ideal workflow.",
    },
    "Creator / Partnership": {
        "title_label": "Partnership request title",
        "title_placeholder": "Example: Creator spotlight collaboration",
        "details_placeholder": "Share your channel links, audience, and what collaboration you want.",
    },
}


class TicketRequestModal(discord.ui.Modal):
    def __init__(self, category: str) -> None:
        self.category = category
        hints = TICKET_MODAL_HINTS.get(category, {})
        super().__init__(title=f"{category} Ticket")

        self.issue_title = discord.ui.TextInput(
            label=hints.get("title_label", "Issue title"),
            placeholder=hints.get("title_placeholder", "Give this request a short title"),
            required=True,
            max_length=100,
        )
        self.issue_details = discord.ui.TextInput(
            label="What do you need help with?",
            placeholder=hints.get("details_placeholder", "Add details so staff can help quickly."),
            style=discord.TextStyle.paragraph,
            required=True,
            max_length=900,
        )
        self.system_context = discord.ui.TextInput(
            label="System context (optional)",
            placeholder="macOS version, app version, server/channel, timestamps, screenshots info",
            style=discord.TextStyle.paragraph,
            required=False,
            max_length=500,
        )

        self.add_item(self.issue_title)
        self.add_item(self.issue_details)
        self.add_item(self.system_context)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        if not interaction.guild or not isinstance(interaction.user, discord.Member):
            await interaction.response.send_message("Tickets can only be opened inside a server.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True, thinking=True)
        subject = f"{self.category}: {self.issue_title.value.strip()}"
        created, message = await create_ticket_for_member(
            interaction,
            interaction.user,
            subject,
            details=self.issue_details.value,
            system_context=self.system_context.value,
        )
        if created:
            await interaction.followup.send(f"Your ticket is ready: {message}", ephemeral=True)
        else:
            await interaction.followup.send(message, ephemeral=True)


class TicketPanelSelect(discord.ui.Select):
    def __init__(self) -> None:
        options = [
            discord.SelectOption(label="Billing & Subscription", value="Billing & Subscription", emoji="💳", description="Charges, invoice questions, refunds, or plan upgrades"),
            discord.SelectOption(label="Install & Setup", value="Install & Setup", emoji="🧰", description="Install issues, permissions, capture setup, onboarding"),
            discord.SelectOption(label="Bug Report", value="Bug Report", emoji="🐞", description="Report crashes, lag, missing clips, or broken actions"),
            discord.SelectOption(label="Account & Access", value="Account & Access", emoji="🔐", description="Sign-in, account linking, or entitlement access"),
            discord.SelectOption(label="Feature Request", value="Feature Request", emoji="✨", description="Suggest improvements and future MacClipper features"),
            discord.SelectOption(label="Creator / Partnership", value="Creator / Partnership", emoji="🎥", description="Creator support, promo, or partnership inquiries"),
        ]
        super().__init__(
            custom_id="mc_ticket_panel_select",
            placeholder="Select a support category...",
            min_values=1,
            max_values=1,
            options=options,
        )

    async def callback(self, interaction: discord.Interaction) -> None:
        if not interaction.guild or not isinstance(interaction.user, discord.Member):
            await interaction.response.send_message("This panel only works in a server.", ephemeral=True)
            return

        subject = self.values[0]
        await interaction.response.send_modal(TicketRequestModal(subject))


class TicketPanelView(discord.ui.View):
    def __init__(self) -> None:
        super().__init__(timeout=None)
        self.add_item(TicketPanelSelect())


def ticket_panel_embed(guild: Optional[discord.Guild]) -> discord.Embed:
    embed = discord.Embed(
        title=bot_config.ticket_panel_title,
        description=bot_config.ticket_panel_description,
        color=discord.Color.gold(),
    )
    embed.add_field(name="How it works", value="1) Pick a dropdown category\n2) We create a private ticket channel\n3) A staff member claims and helps you", inline=False)
    embed.add_field(name="Expected response", value="Most tickets get a first response within 5-30 minutes during active support hours.", inline=False)
    if guild:
        embed.set_footer(text=f"{guild.name} Support")
    if bot_config.ticket_panel_banner_url:
        embed.set_image(url=bot_config.ticket_panel_banner_url)
    return embed


@bot.tree.command(name="mc-config-set", description="Set bot config values (roles, ticket category, and panel style)")
@app_commands.describe(
    staff_role="Role allowed to handle tickets",
    admin_role="Role allowed to run admin commands",
    ticket_category="Category where ticket channels are created",
    panel_banner_url="Optional image URL shown on the ticket panel",
    panel_title="Panel embed title",
    panel_description="Panel embed description",
)
async def mc_config_set(
    interaction: discord.Interaction,
    staff_role: Optional[discord.Role] = None,
    admin_role: Optional[discord.Role] = None,
    ticket_category: Optional[discord.CategoryChannel] = None,
    panel_banner_url: Optional[str] = None,
    panel_title: Optional[str] = None,
    panel_description: Optional[str] = None,
) -> None:
    guard = admin_guard(interaction)
    if guard:
        await interaction.response.send_message(guard, ephemeral=True)
        return

    updates: dict[str, str] = {}

    if staff_role is not None:
        bot_config.staff_role_id = staff_role.id
        updates["DISCORD_STAFF_ROLE_ID"] = str(staff_role.id)
    if admin_role is not None:
        bot_config.admin_role_id = admin_role.id
        updates["DISCORD_ADMIN_ROLE_ID"] = str(admin_role.id)
    if ticket_category is not None:
        bot_config.ticket_category_id = ticket_category.id
        updates["DISCORD_TICKET_CATEGORY_ID"] = str(ticket_category.id)
    if panel_banner_url is not None:
        normalized = panel_banner_url.strip()
        if normalized and not (normalized.startswith("http://") or normalized.startswith("https://")):
            await interaction.response.send_message("Banner URL must start with http:// or https://", ephemeral=True)
            return
        bot_config.ticket_panel_banner_url = normalized
        updates["DISCORD_TICKET_PANEL_BANNER_URL"] = normalized
    if panel_title is not None:
        bot_config.ticket_panel_title = panel_title.strip() or "MacClipper Support Center"
        updates["DISCORD_TICKET_PANEL_TITLE"] = bot_config.ticket_panel_title
    if panel_description is not None:
        bot_config.ticket_panel_description = (
            panel_description.strip() or "Pick a category below to open a private ticket. A team member will claim it and help you quickly."
        )
        updates["DISCORD_TICKET_PANEL_DESCRIPTION"] = bot_config.ticket_panel_description

    if not updates:
        await interaction.response.send_message("Nothing to update. Provide at least one config option.", ephemeral=True)
        return

    update_env_file(updates)

    summary = discord.Embed(title="Bot Config Updated", color=discord.Color.green())
    summary.add_field(name="Staff Role ID", value=str(bot_config.staff_role_id or "Not set"), inline=True)
    summary.add_field(name="Admin Role ID", value=str(bot_config.admin_role_id or "Not set"), inline=True)
    summary.add_field(name="Ticket Category ID", value=str(bot_config.ticket_category_id or "Not set"), inline=True)
    summary.add_field(name="Panel Banner", value=bot_config.ticket_panel_banner_url or "Not set", inline=False)
    await interaction.response.send_message("Config saved to bot/.env and applied immediately.", embed=summary, ephemeral=True)


@bot.tree.command(name="mc-ticket-panel-send", description="Send the ticket support panel with category dropdown")
@app_commands.describe(channel="Where to send the ticket panel (defaults to current channel)")
async def mc_ticket_panel_send(interaction: discord.Interaction, channel: Optional[discord.TextChannel] = None) -> None:
    guard = admin_guard(interaction)
    if guard:
        await interaction.response.send_message(guard, ephemeral=True)
        return

    target_channel = channel or interaction.channel
    if not isinstance(target_channel, discord.TextChannel):
        await interaction.response.send_message("Use this command in a text channel or select one explicitly.", ephemeral=True)
        return

    embed = ticket_panel_embed(interaction.guild)
    await target_channel.send(embed=embed, view=TicketPanelView())
    await interaction.response.send_message(f"Ticket panel sent in {target_channel.mention}.", ephemeral=True)


@bot.tree.command(name="mc-health", description="Check MacClipper API health")
async def mc_health(interaction: discord.Interaction) -> None:
    await interaction.response.defer(ephemeral=True)
    result = await bot.api_get("/health")
    await interaction.followup.send("API healthy." if result.ok else f"API issue: {api_error(result)}", ephemeral=True)


@bot.tree.command(name="mc-ticket-open", description="Open a support ticket for a user")
@app_commands.describe(user="Ticket owner", subject="Ticket subject")
async def mc_ticket_open(interaction: discord.Interaction, user: discord.Member, subject: Optional[str] = None) -> None:
    guard = staff_guard(interaction)
    if guard:
        await interaction.response.send_message(guard, ephemeral=True)
        return

    if not interaction.guild or not isinstance(interaction.channel, discord.TextChannel):
        await interaction.response.send_message("Use this command in a server text channel.", ephemeral=True)
        return

    if not bot_config.staff_role_id:
        await interaction.response.send_message("Set DISCORD_STAFF_ROLE_ID to enable ticket claiming permissions.", ephemeral=True)
        return

    await interaction.response.defer(ephemeral=True)

    overwrites: dict[discord.abc.Snowflake, discord.PermissionOverwrite] = {
        interaction.guild.default_role: discord.PermissionOverwrite(view_channel=False),
    }
    # Always ensure user is a discord.Member and gets explicit permissions
    if isinstance(user, discord.Member):
        overwrites[user] = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True, attach_files=True)
    else:
        print(f"[WARN] Ticket owner {user} is not a discord.Member; cannot set channel permissions.")

    staff_role = interaction.guild.get_role(bot_config.staff_role_id)
    if staff_role:
        overwrites[staff_role] = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True)

    if bot_config.admin_role_id:
        admin_role = interaction.guild.get_role(bot_config.admin_role_id)
        if admin_role:
            overwrites[admin_role] = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True, manage_channels=True)

    me = bot_member(interaction.guild)
    if me:
        overwrites[me] = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True, manage_channels=True)

    category = interaction.guild.get_channel(bot_config.ticket_category_id) if bot_config.ticket_category_id else None
    channel_name = f"ticket-{user.name}".lower().replace(" ", "-")[:90]
    ticket_channel = await interaction.guild.create_text_channel(channel_name, category=category, overwrites=overwrites)
    # Re-apply owner permissions after creation in case Discord overwrites failed
    if isinstance(user, discord.Member):
        try:
            await ticket_channel.set_permissions(user, view_channel=True, send_messages=True, read_message_history=True, attach_files=True)
        except Exception as e:
            print(f"[ERROR] Failed to set ticket owner permissions: {e}")
    else:
        print(f"[WARN] Ticket owner {user} is not a discord.Member after channel creation.")

    opened = await bot.api_post("/bot/tickets/open", {
        "guildId": str(interaction.guild.id),
        "channelId": str(interaction.channel.id),
        "categoryId": str(category.id) if category else "",
        "ticketChannelId": str(ticket_channel.id),
        "ownerUserId": str(user.id),
        "ownerUsername": str(user),
        "createdByUserId": str(interaction.user.id),
        "subject": subject or "",
    })

    if not opened.ok:
        await interaction.followup.send(f"Ticket opened, but API save failed: {api_error(opened)}", ephemeral=True)
        return

    await ticket_channel.send(f"{user.mention} ticket opened. Staff can claim with `/mc-ticket-claim`.")
    await interaction.followup.send(f"Ticket created: {ticket_channel.mention}", ephemeral=True)


@bot.tree.command(name="mc-ticket-claim", description="Claim a ticket so only you and the owner can see it")
@app_commands.describe(channel="Ticket channel (defaults to current channel)")
async def mc_ticket_claim(interaction: discord.Interaction, channel: Optional[discord.TextChannel] = None) -> None:
    guard = staff_guard(interaction)
    if guard:
        await interaction.response.send_message(guard, ephemeral=True)
        return

    ticket_channel = channel or interaction.channel
    if not interaction.guild or not isinstance(ticket_channel, discord.TextChannel):
        await interaction.response.send_message("Use this command in a server ticket channel.", ephemeral=True)
        return

    await interaction.response.defer(ephemeral=True)
    claimed = await bot.api_post("/bot/tickets/claim", {
        "ticketChannelId": str(ticket_channel.id),
        "claimerUserId": str(interaction.user.id),
        "claimerUsername": str(interaction.user),
    })
    if not claimed.ok:
        await interaction.followup.send(f"Claim failed: {api_error(claimed)}", ephemeral=True)
        return

    ticket = claimed.data.get("ticket", {})
    owner_id = int(str(ticket.get("ownerUserId") or "0") or "0")
    owner_member = interaction.guild.get_member(owner_id) if owner_id else None

    overwrites: dict[discord.abc.Snowflake, discord.PermissionOverwrite] = {
        interaction.guild.default_role: discord.PermissionOverwrite(view_channel=False),
    }

    if owner_member:
        overwrites[owner_member] = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True, attach_files=True)

    if isinstance(interaction.user, discord.Member):
        overwrites[interaction.user] = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True, attach_files=True, manage_channels=True)

    if bot_config.staff_role_id:
        staff_role = interaction.guild.get_role(bot_config.staff_role_id)
        if staff_role:
            overwrites[staff_role] = discord.PermissionOverwrite(view_channel=False)

    if bot_config.admin_role_id:
        admin_role = interaction.guild.get_role(bot_config.admin_role_id)
        if admin_role:
            overwrites[admin_role] = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True, manage_channels=True)

    me = bot_member(interaction.guild)
    if me:
        overwrites[me] = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True, manage_channels=True)

    await ticket_channel.edit(overwrites=overwrites)
    await ticket_channel.send(f"Ticket claimed by {interaction.user.mention}.")
    await interaction.followup.send("Ticket claimed and locked.", ephemeral=True)


@bot.tree.command(name="mc-ticket-close", description="Close a ticket")
@app_commands.describe(channel="Ticket channel (defaults to current channel)", reason="Close reason", delete="Delete channel after closing")
async def mc_ticket_close(
    interaction: discord.Interaction,
    channel: Optional[discord.TextChannel] = None,
    reason: Optional[str] = None,
    delete: Optional[bool] = False,
) -> None:
    guard = staff_guard(interaction)
    if guard:
        await interaction.response.send_message(guard, ephemeral=True)
        return

    ticket_channel = channel or interaction.channel
    if not interaction.guild or not isinstance(ticket_channel, discord.TextChannel):
        await interaction.response.send_message("Use this command in a server ticket channel.", ephemeral=True)
        return

    await interaction.response.defer(ephemeral=True)
    closed = await bot.api_post("/bot/tickets/close", {
        "ticketChannelId": str(ticket_channel.id),
        "closedByUserId": str(interaction.user.id),
        "closedByUsername": str(interaction.user),
        "reason": reason or "",
    })
    if not closed.ok:
        await interaction.followup.send(f"Close failed: {api_error(closed)}", ephemeral=True)
        return

    await ticket_channel.send(f"Ticket closed by {interaction.user.mention}.{f' Reason: {reason}' if reason else ''}")
    if delete:
        await ticket_channel.delete(reason=f"Closed by {interaction.user}")
        await interaction.followup.send("Ticket closed and channel deleted.", ephemeral=True)
        return

    await interaction.followup.send("Ticket closed.", ephemeral=True)


@bot.tree.command(name="mc-giveaway-create", description="Create a giveaway")
@app_commands.describe(prize="Prize", duration="Duration in minutes", winners="Number of winners")
async def mc_giveaway_create(interaction: discord.Interaction, prize: str, duration: int, winners: int) -> None:
    guard = staff_guard(interaction)
    if guard:
        await interaction.response.send_message(guard, ephemeral=True)
        return

    if not interaction.guild or not isinstance(interaction.channel, discord.TextChannel):
        await interaction.response.send_message("Use this command in a server text channel.", ephemeral=True)
        return

    await interaction.response.defer(ephemeral=True)
    message = await interaction.channel.send(
        f"Giveaway started by {interaction.user.mention}\nPrize: **{prize}**\nDuration: `{duration}` minute(s)\nWinners: `{winners}`\nUse `/mc-giveaway-enter {interaction.channel.id}-{interaction.id}` after setup posts the message ID."
    )

    created = await bot.api_post("/bot/giveaways/create", {
        "guildId": str(interaction.guild.id),
        "channelId": str(interaction.channel.id),
        "messageId": str(message.id),
        "prize": prize,
        "durationMinutes": duration,
        "winnerCount": winners,
        "createdByUserId": str(interaction.user.id),
        "createdByUsername": str(interaction.user),
    })
    if not created.ok:
        await interaction.followup.send(f"Giveaway post created, but API save failed: {api_error(created)}", ephemeral=True)
        return

    await interaction.followup.send(f"Giveaway created. Message ID: `{message.id}`. Users enter with `/mc-giveaway-enter {message.id}`", ephemeral=True)


@bot.tree.command(name="mc-giveaway-enter", description="Enter a giveaway")
@app_commands.describe(messageid="Giveaway message ID")
async def mc_giveaway_enter(interaction: discord.Interaction, messageid: str) -> None:
    await interaction.response.defer(ephemeral=True)
    entered = await bot.api_post("/bot/giveaways/enter", {
        "messageId": messageid,
        "userId": str(interaction.user.id),
        "username": str(interaction.user),
    })
    if not entered.ok:
        await interaction.followup.send(f"Entry failed: {api_error(entered)}", ephemeral=True)
        return

    await interaction.followup.send(f"You entered the giveaway. Total entrants: {entered.data.get('participantCount', 0)}", ephemeral=True)


@bot.tree.command(name="mc-giveaway-draw", description="Draw giveaway winners")
@app_commands.describe(messageid="Giveaway message ID", force="Force redraw")
async def mc_giveaway_draw(interaction: discord.Interaction, messageid: str, force: Optional[bool] = False) -> None:
    guard = staff_guard(interaction)
    if guard:
        await interaction.response.send_message(guard, ephemeral=True)
        return

    await interaction.response.defer(ephemeral=True)
    drawn = await bot.api_post("/bot/giveaways/draw", {
        "messageId": messageid,
        "force": bool(force),
        "endedByUserId": str(interaction.user.id),
        "endedByUsername": str(interaction.user),
    })
    if not drawn.ok:
        await interaction.followup.send(f"Draw failed: {api_error(drawn)}", ephemeral=True)
        return

    winners = drawn.data.get("winners") or []
    if winners:
        mentions = " ".join(f"<@{winner}>" for winner in winners)
        await interaction.channel.send(f"Giveaway winners: {mentions}")
    else:
        await interaction.channel.send("Giveaway ended with no valid entries.")

    await interaction.followup.send("Giveaway draw complete.", ephemeral=True)


@bot.tree.command(name="mc-poll-create", description="Create a poll")
@app_commands.describe(question="Poll question", option1="Option 1", option2="Option 2", option3="Option 3", option4="Option 4")
async def mc_poll_create(
    interaction: discord.Interaction,
    question: str,
    option1: str,
    option2: str,
    option3: Optional[str] = None,
    option4: Optional[str] = None,
) -> None:
    guard = staff_guard(interaction)
    if guard:
        await interaction.response.send_message(guard, ephemeral=True)
        return

    options = [option1, option2] + [value for value in [option3, option4] if value]
    if len(options) < 2:
        await interaction.response.send_message("You need at least two options.", ephemeral=True)
        return

    await interaction.response.defer(ephemeral=True)
    embed = poll_embed(question, options, [0] * len(options))
    message = await interaction.channel.send(embed=embed)
    created = await bot.api_post("/bot/polls/create", {
        "guildId": str(interaction.guild.id) if interaction.guild else "",
        "channelId": str(interaction.channel.id) if interaction.channel else "",
        "messageId": str(message.id),
        "question": question,
        "options": options,
        "createdByUserId": str(interaction.user.id),
        "createdByUsername": str(interaction.user),
    })
    if not created.ok:
        await interaction.followup.send(f"Poll posted, but API save failed: {api_error(created)}", ephemeral=True)
        return

    await interaction.followup.send(f"Poll created. Users vote with `/mc-poll-vote {message.id} <option>`.", ephemeral=True)


@bot.tree.command(name="mc-poll-vote", description="Vote in a poll")
@app_commands.describe(messageid="Poll message ID", option="Option number (1-based)")
async def mc_poll_vote(interaction: discord.Interaction, messageid: str, option: int) -> None:
    await interaction.response.defer(ephemeral=True)
    voted = await bot.api_post("/bot/polls/vote", {
        "messageId": messageid,
        "userId": str(interaction.user.id),
        "username": str(interaction.user),
        "optionIndex": max(0, option - 1),
    })
    if not voted.ok:
        await interaction.followup.send(f"Vote failed: {api_error(voted)}", ephemeral=True)
        return

    poll = voted.data.get("poll") or {}
    options = poll.get("options") or []
    counts = voted.data.get("voteCounts") or [0] * len(options)
    question = str(poll.get("question") or "Poll")
    embed = poll_embed(question, [str(value) for value in options], [int(value) for value in counts])

    if interaction.guild and poll.get("channelId"):
        channel = interaction.guild.get_channel(int(str(poll.get("channelId"))))
        if isinstance(channel, discord.TextChannel):
            try:
                message = await channel.fetch_message(int(str(messageid)))
                await message.edit(embed=embed)
            except Exception:
                pass

    await interaction.followup.send("Vote saved.", ephemeral=True)


# --- Discord Unlink ---

@bot.tree.command(name="unlink", description="Unlink your Discord from your MacClipper account")
async def unlink_command(interaction: discord.Interaction) -> None:
    await interaction.response.defer(ephemeral=True)
    result = await bot.api_post("/bot/unlink-discord", {"discordUserId": str(interaction.user.id)})
    if not result.ok:
        await interaction.followup.send(f"Failed to unlink: {api_error(result)}", ephemeral=True)
        return
    await interaction.followup.send("✅ Discord unlinked from your MacClipper account.", ephemeral=True)


# --- Feature & Subscription Management ---

@bot.tree.command(name="unlockfeature", description="Grant a feature to a user (staff only)")
@app_commands.describe(user="Discord user to unlock for", feature="Feature key (e.g. 4k-pro)")
async def unlockfeature_command(interaction: discord.Interaction, user: discord.Member, feature: str) -> None:
    guard = staff_guard(interaction)
    if guard:
        await interaction.response.send_message(guard, ephemeral=True)
        return
    await interaction.response.defer(ephemeral=True)
    result = await bot.api_post("/bot/users/grant-feature", {
        "discordUserId": str(user.id),
        "feature": feature,
    })
    if not result.ok:
        await interaction.followup.send(f"Failed to unlock: {api_error(result)}", ephemeral=True)
        return
    await interaction.followup.send(f"✅ Feature **{feature}** unlocked for {user.mention}.", ephemeral=True)


@bot.tree.command(name="removepro", description="Remove Pro subscription from a user (staff only)")
@app_commands.describe(user="Discord user to remove Pro from")
async def removepro_command(interaction: discord.Interaction, user: discord.Member) -> None:
    guard = staff_guard(interaction)
    if guard:
        await interaction.response.send_message(guard, ephemeral=True)
        return
    await interaction.response.defer(ephemeral=True)
    result = await bot.api_post("/bot/users/subscription", {
        "discordUserId": str(user.id),
        "subscriptionTier": "free",
    })
    if not result.ok:
        await interaction.followup.send(f"Failed to remove Pro: {api_error(result)}", ephemeral=True)
        return
    await interaction.followup.send(f"✅ Pro removed from {user.mention}.", ephemeral=True)


async def main() -> None:
    require_env()

    health_app = web.Application()

    async def health_handler(_request: web.Request) -> web.Response:
        return web.json_response({
            "ok": True,
            "service": "macclipper-discord-bot",
            "discordReady": bot.is_ready(),
            "discordUser": str(bot.user) if bot.user else None,
            "latencyMs": round(bot.latency * 1000, 2) if bot.is_ready() else None,
        })

    async def ready_handler(_request: web.Request) -> web.Response:
        ready = bot.is_ready() and bot.user is not None
        return web.json_response({
            "ok": ready,
            "service": "macclipper-discord-bot",
            "discordReady": ready,
        }, status=200 if ready else 503)

    async def discord_linked_webhook(request: web.Request) -> web.Response:
        auth = request.headers.get("Authorization", "")
        if auth != f"Bearer {BOT_SECRET}":
            return web.json_response({"error": "Unauthorized"}, status=401)
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "Bad request"}, status=400)
        discord_user_id = str(body.get("discordUserId") or "")
        if not discord_user_id:
            return web.json_response({"error": "discordUserId is required"}, status=400)
        user = bot.get_user(int(discord_user_id))
        if user:
            try:
                await user.send(
                    "🎉 **Discord Linked!** 🎉\n\n"
                    "Your Discord has been successfully linked to your MacClipper account.\n"
                    "Run `/link` in any server with me to get your **Pro role** assigned!"
                )
            except Exception:
                pass
        return web.json_response({"ok": True})

    health_app.router.add_get("/", health_handler)
    health_app.router.add_get("/health", health_handler)
    health_app.router.add_get("/ready", ready_handler)
    health_app.router.add_post("/webhook/discord-linked", discord_linked_webhook)

    health_runner = web.AppRunner(health_app)
    await health_runner.setup()
    health_site = web.TCPSite(health_runner, host="0.0.0.0", port=HEALTH_PORT)
    await health_site.start()
    print(f"Bot health server listening on 0.0.0.0:{HEALTH_PORT}")

    try:
        await bot.start(TOKEN)
    finally:
        await health_runner.cleanup()


if __name__ == "__main__":
    asyncio.run(main())