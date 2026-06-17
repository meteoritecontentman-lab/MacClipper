import asyncio
import json
import os
import re
from datetime import datetime, timezone
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands

APPEAL_GUILD_ID = 1515741180913123411
APPEAL_GUILD = discord.Object(id=APPEAL_GUILD_ID)

APPEAL_DIR = os.path.join(os.path.dirname(__file__), "apeal_data")


def _ensure_dir():
    os.makedirs(APPEAL_DIR, exist_ok=True)


def _config_path(guild_id: int) -> str:
    return os.path.join(APPEAL_DIR, f"config_{guild_id}.json")


def _appeals_path(guild_id: int) -> str:
    return os.path.join(APPEAL_DIR, f"appeals_{guild_id}.json")


def _jail_path(guild_id: int) -> str:
    return os.path.join(APPEAL_DIR, f"jail_{guild_id}.json")


def load_config(guild_id: int) -> dict:
    _ensure_dir()
    path = _config_path(guild_id)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}


def save_config(guild_id: int, config: dict):
    _ensure_dir()
    with open(_config_path(guild_id), "w") as f:
        json.dump(config, f, indent=2)


def load_appeals(guild_id: int) -> list:
    _ensure_dir()
    path = _appeals_path(guild_id)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return []


def save_appeals(guild_id: int, appeals: list):
    _ensure_dir()
    with open(_appeals_path(guild_id), "w") as f:
        json.dump(appeals, f, indent=2)


def load_jailed(guild_id: int) -> list:
    _ensure_dir()
    path = _jail_path(guild_id)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return []


def save_jailed(guild_id: int, jailed: list):
    _ensure_dir()
    with open(_jail_path(guild_id), "w") as f:
        json.dump(jailed, f, indent=2)


def next_appeal_id(guild_id: int) -> str:
    appeals = load_appeals(guild_id)
    nums = []
    for a in appeals:
        try:
            nums.append(int(a.get("id", "AP-000").replace("AP-", "")))
        except (ValueError, AttributeError):
            pass
    n = max(nums) + 1 if nums else 1
    return f"AP-{n:03d}"


# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------

def require_appeal_staff(interaction: discord.Interaction) -> Optional[str]:
    guild = interaction.guild
    if not guild:
        return "Must be used in a server."
    config = load_config(guild.id)
    rid = config.get("roles", {}).get("appeal_staff")
    if not rid:
        return "Appeal system not set up yet. Run `/apeal-setup` first."
    if isinstance(interaction.user, discord.Member):
        if interaction.user.guild_permissions.administrator:
            return None
        if rid in {r.id for r in interaction.user.roles}:
            return None
    return "You need the Appeal Staff role."


def require_admin(interaction: discord.Interaction) -> Optional[str]:
    if isinstance(interaction.user, discord.Member):
        if interaction.user.guild_permissions.administrator or interaction.user.guild_permissions.manage_guild:
            return None
    return "You need Administrator permissions."


# ---------------------------------------------------------------------------
# Channel / role helpers
# ---------------------------------------------------------------------------

async def _get_or_create_role(
    guild: discord.Guild,
    name: str,
    color: discord.Color = discord.Color.default(),
    reason: str = "Appeal system setup",
) -> discord.Role:
    existing = discord.utils.get(guild.roles, name=name)
    if existing:
        return existing
    return await guild.create_role(name=name, color=color, reason=reason, mentionable=True)


async def _get_or_create_category(
    guild: discord.Guild, name: str, reason: str = "Appeal system setup"
) -> discord.CategoryChannel:
    existing = discord.utils.get(guild.categories, name=name)
    if existing:
        return existing
    return await guild.create_category(name=name, reason=reason)


async def _get_or_create_channel(
    guild: discord.Guild,
    name: str,
    category: Optional[discord.CategoryChannel] = None,
    topic: str = "",
    overwrites: Optional[dict] = None,
    reason: str = "Appeal system setup",
) -> discord.TextChannel:
    existing = discord.utils.get(guild.text_channels, name=name)
    if existing:
        return existing
    return await guild.create_text_channel(
        name, category=category, topic=topic, overwrites=overwrites or {}, reason=reason
    )


# ---------------------------------------------------------------------------
# UI Components
# ---------------------------------------------------------------------------

class AppealSubmitModal(discord.ui.Modal):
    def __init__(self):
        super().__init__(title="Submit a Ban Appeal")
        self._prev_discord_username = discord.ui.TextInput(
            label="Your Discord username (before ban)",
            placeholder="username#0000 or your user ID",
            required=True,
            max_length=100,
        )
        self._ban_reason = discord.ui.TextInput(
            label="Why were you banned?",
            placeholder="Explain what happened and the reason you were banned...",
            style=discord.TextStyle.paragraph,
            required=True,
            max_length=1000,
        )
        self._appeal_reason = discord.ui.TextInput(
            label="Why should you be unbanned?",
            placeholder="Explain why you deserve a second chance...",
            style=discord.TextStyle.paragraph,
            required=True,
            max_length=1000,
        )
        self._extra = discord.ui.TextInput(
            label="Additional info (optional)",
            placeholder="Screenshots, evidence, context staff should know...",
            style=discord.TextStyle.paragraph,
            required=False,
            max_length=1000,
        )
        self.add_item(self._prev_discord_username)
        self.add_item(self._ban_reason)
        self.add_item(self._appeal_reason)
        self.add_item(self._extra)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        if not interaction.guild:
            await interaction.response.send_message("This can only be used in a server.", ephemeral=True)
            return
        guild = interaction.guild
        config = load_config(guild.id)
        if not config.get("setup_complete"):
            await interaction.response.send_message("Appeal system not set up yet.", ephemeral=True)
            return

        await interaction.response.send_message("⏳ Creating your appeal ticket...", ephemeral=True)

        try:
            appeals = load_appeals(guild.id)
            uid = str(interaction.user.id)
            if any(a for a in appeals if a.get("user_id") == uid and a.get("status") == "open"):
                await interaction.edit_original_response(content="You already have an open appeal. Please wait for staff to respond.")
                return

            appeal_id = next_appeal_id(guild.id)
            cat_id = config.get("categories", {}).get("appeals")
            appeal_category = guild.get_channel(cat_id) if cat_id else None
            staff_rid = config.get("roles", {}).get("appeal_staff")

            overwrites = {
                guild.default_role: discord.PermissionOverwrite(view_channel=False),
            }
            if isinstance(interaction.user, discord.Member):
                overwrites[interaction.user] = discord.PermissionOverwrite(
                    view_channel=True, send_messages=True, read_message_history=True, attach_files=True
                )
            if staff_rid:
                sr = guild.get_role(staff_rid)
                if sr:
                    overwrites[sr] = discord.PermissionOverwrite(
                        view_channel=True, send_messages=True, read_message_history=True, manage_channels=True
                    )
            me = guild.me
            if me:
                overwrites[me] = discord.PermissionOverwrite(
                    view_channel=True, send_messages=True, read_message_history=True, manage_channels=True
                )

            slug = re.sub(r"[^a-z0-9]+", "-", interaction.user.name.lower()).strip("-")[:50]
            ch_name = f"appeal-{slug}-{appeal_id.lower()}"

            try:
                channel = await guild.create_text_channel(
                    ch_name, category=appeal_category, overwrites=overwrites, reason=f"Appeal {appeal_id}"
                )
            except discord.Forbidden:
                await interaction.edit_original_response(content="I don't have permission to create channels. Check my permissions.")
                return
            except Exception as e:
                await interaction.edit_original_response(content=f"Failed to create channel: {e}")
                return

            record = {
                "id": appeal_id,
                "user_id": uid,
                "username": str(interaction.user),
                "discord_username": self._prev_discord_username.value.strip(),
                "ban_reason": self._ban_reason.value.strip(),
                "appeal_reason": self._appeal_reason.value.strip(),
                "extra_info": self._extra.value.strip(),
                "status": "open",
                "channel_id": channel.id,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "closed_by": None,
                "closed_at": None,
                "outcome": None,
                "staff_notes": None,
            }
            appeals.append(record)
            save_appeals(guild.id, appeals)

            staff_ping = f"<@&{staff_rid}>" if staff_rid else "@Appeal Staff"
            embed = discord.Embed(
                title=f"Appeal {appeal_id} — Submitted",
                description=f"Thank you, {interaction.user.mention}. Staff will review your appeal shortly.",
                color=discord.Color.blue(),
            )
            embed.add_field(name="Previous Username", value=record["discord_username"], inline=False)
            embed.add_field(name="Ban Reason", value=record["ban_reason"][:1024], inline=False)
            embed.add_field(name="Appeal Reason", value=record["appeal_reason"][:1024], inline=False)
            if record.get("extra_info"):
                embed.add_field(name="Additional Info", value=record["extra_info"][:1024], inline=False)
            embed.set_footer(text=f"Appeal ID: {appeal_id}")

            await channel.send(content=staff_ping, embed=embed)

            log_ch_id = config.get("channels", {}).get("appeal_log")
            if log_ch_id:
                lch = guild.get_channel(log_ch_id)
                if isinstance(lch, discord.TextChannel):
                    le = discord.Embed(
                        title=f"New Appeal: {appeal_id}",
                        description=f"User: {interaction.user.mention} (`{uid}`)\nPrev: {record['discord_username']}\nStatus: **Open**",
                        color=discord.Color.blue(),
                        timestamp=datetime.now(timezone.utc),
                    )
                    await lch.send(embed=le)

            await interaction.edit_original_response(content=f"✅ Appeal submitted! Check your channel: {channel.mention}")

        except Exception as e:
            print(f"[AppealSubmitModal ERROR] {e}")
            try:
                await interaction.edit_original_response(content=f"❌ Failed to submit appeal: {e}")
            except Exception:
                pass


class AppealSubmitButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="Submit Appeal", style=discord.ButtonStyle.primary, emoji="📝", custom_id="apeal_submit")

    async def callback(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_modal(AppealSubmitModal())


class AppealSubmitView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(AppealSubmitButton())


# ---------------------------------------------------------------------------
# Command registration
# ---------------------------------------------------------------------------

def setup_appeal(bot: commands.Bot) -> None:
    """Register all appeal commands and persistent views."""

    bot.add_view(AppealSubmitView())

    # ---- apeal-setup -------------------------------------------------------

    @bot.tree.command(name="apeal-setup", description="Create the complete appeal server structure (channels, roles, categories)", guild=APPEAL_GUILD)
    async def apeal_setup(interaction: discord.Interaction) -> None:
        guard = require_admin(interaction)
        if guard:
            await interaction.response.send_message(guard, ephemeral=True)
            return

        guild = interaction.guild
        if not guild:
            return

        await interaction.response.send_message("⏳ Setting up the appeal server...", ephemeral=True)

        try:
            jailed_role = await _get_or_create_role(guild, "Jailed", color=discord.Color.dark_gray())
            await asyncio.sleep(0.25)
            staff_role = await _get_or_create_role(guild, "Appeal Staff", color=discord.Color.blue())
            await asyncio.sleep(0.25)
            appealing_role = await _get_or_create_role(guild, "Appealing", color=discord.Color.orange())
            await asyncio.sleep(0.25)

            info_cat = await _get_or_create_category(guild, "📋 INFORMATION")
            await asyncio.sleep(0.25)
            appeals_cat = await _get_or_create_category(guild, "🔒 APPEALS")
            await asyncio.sleep(0.25)
            staff_cat = await _get_or_create_category(guild, "⚖️ STAFF")
            await asyncio.sleep(0.25)

            await info_cat.set_permissions(guild.default_role, view_channel=True)
            await info_cat.set_permissions(jailed_role, view_channel=True)
            await info_cat.set_permissions(staff_role, view_channel=True)
            await asyncio.sleep(0.25)

            await appeals_cat.set_permissions(guild.default_role, view_channel=False)
            await appeals_cat.set_permissions(jailed_role, view_channel=True)
            await appeals_cat.set_permissions(staff_role, view_channel=True)
            await asyncio.sleep(0.25)

            await staff_cat.set_permissions(guild.default_role, view_channel=False)
            await staff_cat.set_permissions(staff_role, view_channel=True)
            await asyncio.sleep(0.25)

            welcome_ch = await _get_or_create_channel(
                guild, "👋-welcome", category=info_cat,
                topic="Welcome to the MacClipper Appeal Server."
            )
            await asyncio.sleep(0.25)
            rules_ch = await _get_or_create_channel(
                guild, "📜-rules", category=info_cat,
                topic="Server rules."
            )
            await asyncio.sleep(0.25)

            submit_ch = await _get_or_create_channel(
                guild, "📝-submit-appeal", category=appeals_cat,
                topic="Click the button to submit a ban appeal.",
                overwrites={guild.default_role: discord.PermissionOverwrite(view_channel=False), jailed_role: discord.PermissionOverwrite(view_channel=True, send_messages=False, read_message_history=True), staff_role: discord.PermissionOverwrite(view_channel=True, send_messages=True)},
            )
            await asyncio.sleep(0.25)
            appeal_chat_ch = await _get_or_create_channel(
                guild, "💬-appeal-chat", category=appeals_cat,
                topic="Chat about appeals and discuss cases.",
                overwrites={guild.default_role: discord.PermissionOverwrite(view_channel=False), jailed_role: discord.PermissionOverwrite(view_channel=True, send_messages=False, read_message_history=True), staff_role: discord.PermissionOverwrite(view_channel=True, send_messages=True)},
            )
            await asyncio.sleep(0.25)

            staff_ch = await _get_or_create_channel(
                guild, "🔐-staff-chat", category=staff_cat,
                topic="Staff discussion.",
                overwrites={guild.default_role: discord.PermissionOverwrite(view_channel=False), staff_role: discord.PermissionOverwrite(view_channel=True, send_messages=True), jailed_role: discord.PermissionOverwrite(view_channel=False)},
            )
            await asyncio.sleep(0.25)
            log_ch = await _get_or_create_channel(
                guild, "📋-appeal-log", category=staff_cat,
                topic="Log of appeal actions.",
                overwrites={guild.default_role: discord.PermissionOverwrite(view_channel=False), staff_role: discord.PermissionOverwrite(view_channel=True, send_messages=True), jailed_role: discord.PermissionOverwrite(view_channel=False)},
            )
            await asyncio.sleep(0.25)
            jail_log_ch = await _get_or_create_channel(
                guild, "👥-jail-log", category=staff_cat,
                topic="Log of jail/unjail actions.",
                overwrites={guild.default_role: discord.PermissionOverwrite(view_channel=False), staff_role: discord.PermissionOverwrite(view_channel=True, send_messages=True), jailed_role: discord.PermissionOverwrite(view_channel=False)},
            )
            await asyncio.sleep(0.25)

            await welcome_ch.send(
                "Welcome to the **MacClipper Appeal Server**!\n\n"
                "If you've been banned from MacClipper, you can submit an appeal here. "
                "Please read the rules first, then use the submit button below."
            )
            await rules_ch.send(
                "**Server Rules**\n\n"
                "1. **Be respectful** — Harassment, threats, and abuse will not be tolerated.\n"
                "2. **One appeal per ban** — Do not create multiple appeals.\n"
                "3. **Be honest** — Lying will result in immediate denial.\n"
                "4. **No ban evasion** — Creating alt accounts while banned will extend your ban.\n"
                "5. **Staff decisions are final** — Appeals are reviewed at staff discretion.\n\n"
                "Click the button in #submit-appeal to begin."
            )
            submit_embed = discord.Embed(
                title="Submit a Ban Appeal",
                description="Click the button below to open an appeal ticket. A staff member will review your case.",
                color=discord.Color.blue(),
            )
            submit_embed.add_field(name="What happens?", value="1) Fill out the form\n2) A private channel is created\n3) Staff reviews and responds", inline=False)
            await submit_ch.send(embed=submit_embed, view=AppealSubmitView())

            save_config(guild.id, {
                "setup_complete": True,
                "guild_id": guild.id,
                "roles": {
                    "jailed": jailed_role.id,
                    "appeal_staff": staff_role.id,
                    "appealing": appealing_role.id,
                },
                "channels": {
                    "welcome": welcome_ch.id,
                    "rules": rules_ch.id,
                    "submit_appeal": submit_ch.id,
                    "appeal_chat": appeal_chat_ch.id,
                    "staff_chat": staff_ch.id,
                    "appeal_log": log_ch.id,
                    "jail_log": jail_log_ch.id,
                },
                "categories": {
                    "information": info_cat.id,
                    "appeals": appeals_cat.id,
                    "staff": staff_cat.id,
                },
            })

            embed = discord.Embed(
                title="✅ Appeal Server Setup Complete",
                description="All channels, roles, and categories have been created.",
                color=discord.Color.green(),
            )
            embed.add_field(name="Roles", value="`Appeal Staff`, `Jailed`, `Appealing`", inline=True)
            embed.add_field(name="Categories", value="`INFORMATION`, `APPEALS`, `STAFF`", inline=True)
            embed.add_field(name="Channels", value="welcome, rules, submit-appeal, appeal-chat, staff-chat, appeal-log, jail-log", inline=False)
            await interaction.edit_original_response(content="✅ Setup complete!", embed=embed)

        except Exception as e:
            print(f"[apeal-setup ERROR] {e}")
            try:
                await interaction.edit_original_response(content=f"❌ Setup failed: {e}")
            except Exception:
                pass

    # ---- apeal-jail --------------------------------------------------------

    @bot.tree.command(name="apeal-jail", description="Jail a user (restrict to appeals channels only)", guild=APPEAL_GUILD)
    @app_commands.describe(user="User to jail", reason="Reason for jailing")
    async def apeal_jail(interaction: discord.Interaction, user: discord.Member, reason: str) -> None:
        guard = require_appeal_staff(interaction)
        if guard:
            await interaction.response.send_message(guard, ephemeral=True)
            return
        guild = interaction.guild
        if not guild:
            return
        await interaction.response.send_message("⏳", ephemeral=True)

        config = load_config(guild.id)
        jailed_rid = config.get("roles", {}).get("jailed")
        if not jailed_rid:
            await interaction.edit_original_response(content="Appeal system not set up. Run `/apeal-setup` first.")
            return

        jailed_role = guild.get_role(jailed_rid)
        if not jailed_role:
            await interaction.edit_original_response(content="Jailed role not found. Run `/apeal-setup` again.")
            return

        if jailed_role in user.roles:
            await interaction.edit_original_response(content=f"{user.mention} is already jailed.")
            return

        await user.add_roles(jailed_role, reason=f"Jailed by {interaction.user}: {reason}")

        jailed = load_jailed(guild.id)
        jailed.append({
            "user_id": str(user.id),
            "username": str(user),
            "reason": reason,
            "jailed_by": str(interaction.user),
            "jailed_at": datetime.now(timezone.utc).isoformat(),
            "unjailed_at": None,
            "unjailed_by": None,
        })
        save_jailed(guild.id, jailed)

        jail_log_id = config.get("channels", {}).get("jail_log")
        if jail_log_id:
            lch = guild.get_channel(jail_log_id)
            if isinstance(lch, discord.TextChannel):
                le = discord.Embed(
                    title="User Jailed",
                    description=f"User: {user.mention} (`{user.id}`)\nReason: {reason}\nBy: {interaction.user.mention}",
                    color=discord.Color.red(),
                    timestamp=datetime.now(timezone.utc),
                )
                await lch.send(embed=le)

        await interaction.edit_original_response(content=f"🔒 {user.mention} has been jailed. Reason: {reason}")

    # ---- apeal-unjail ------------------------------------------------------

    @bot.tree.command(name="apeal-unjail", description="Release a user from jail", guild=APPEAL_GUILD)
    @app_commands.describe(user="User to unjail", reason="Reason for unjailing")
    async def apeal_unjail(interaction: discord.Interaction, user: discord.Member, reason: str = "Released") -> None:
        guard = require_appeal_staff(interaction)
        if guard:
            await interaction.response.send_message(guard, ephemeral=True)
            return
        guild = interaction.guild
        if not guild:
            return
        await interaction.response.send_message("⏳", ephemeral=True)

        config = load_config(guild.id)
        jailed_rid = config.get("roles", {}).get("jailed")
        if not jailed_rid:
            await interaction.edit_original_response(content="Appeal system not set up. Run `/apeal-setup` first.")
            return

        jailed_role = guild.get_role(jailed_rid)
        if not jailed_role:
            await interaction.edit_original_response(content="Jailed role not found.")
            return

        if jailed_role not in user.roles:
            await interaction.edit_original_response(content=f"{user.mention} is not currently jailed.")
            return

        await user.remove_roles(jailed_role, reason=f"Unjailed by {interaction.user}: {reason}")

        jailed = load_jailed(guild.id)
        for j in jailed:
            if j.get("user_id") == str(user.id) and not j.get("unjailed_at"):
                j["unjailed_at"] = datetime.now(timezone.utc).isoformat()
                j["unjailed_by"] = str(interaction.user)
        save_jailed(guild.id, jailed)

        jail_log_id = config.get("channels", {}).get("jail_log")
        if jail_log_id:
            lch = guild.get_channel(jail_log_id)
            if isinstance(lch, discord.TextChannel):
                le = discord.Embed(
                    title="User Unjailed",
                    description=f"User: {user.mention} (`{user.id}`)\nReason: {reason}\nBy: {interaction.user.mention}",
                    color=discord.Color.green(),
                    timestamp=datetime.now(timezone.utc),
                )
                await lch.send(embed=le)

        await interaction.edit_original_response(content=f"🔓 {user.mention} has been unjailed. Reason: {reason}")

    # ---- apeal-jail-list ---------------------------------------------------

    @bot.tree.command(name="apeal-jail-list", description="List all currently jailed users", guild=APPEAL_GUILD)
    async def apeal_jail_list(interaction: discord.Interaction) -> None:
        guard = require_appeal_staff(interaction)
        if guard:
            await interaction.response.send_message(guard, ephemeral=True)
            return
        guild = interaction.guild
        if not guild:
            return

        jailed = load_jailed(guild.id)
        active = [j for j in jailed if not j.get("unjailed_at")]

        if not active:
            await interaction.response.send_message("No users are currently jailed.", ephemeral=True)
            return

        lines = []
        for j in active:
            uid = j.get("user_id", "?")
            lines.append(f"• <@{uid}> — {j.get('reason', 'No reason')} (by {j.get('jailed_by', '?')})")
        embed = discord.Embed(
            title=f"Jailed Users ({len(active)})",
            description="\n".join(lines),
            color=discord.Color.red(),
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)

    # ---- apeal-list --------------------------------------------------------

    @bot.tree.command(name="apeal-list", description="List all open appeals", guild=APPEAL_GUILD)
    @app_commands.describe(status="Filter by status (open/approved/denied)")
    async def apeal_list(interaction: discord.Interaction, status: Optional[str] = None) -> None:
        guard = require_appeal_staff(interaction)
        if guard:
            await interaction.response.send_message(guard, ephemeral=True)
            return
        guild = interaction.guild
        if not guild:
            return

        all_appeals = load_appeals(guild.id)
        if status:
            filtered = [a for a in all_appeals if a.get("status") == status.lower()]
        else:
            filtered = [a for a in all_appeals if a.get("status") == "open"]

        if not filtered:
            await interaction.response.send_message("No appeals found with that filter.", ephemeral=True)
            return

        chunk_size = 10
        chunks = [filtered[i:i + chunk_size] for i in range(0, len(filtered), chunk_size)]
        embeds = []
        for chunk in chunks:
            lines = []
            for a in chunk:
                aid = a.get("id", "?")
                uid = a.get("user_id", "?")
                s = a.get("status", "?").upper()
                lines.append(f"• **{aid}** — <@{uid}> [{s}]")
            embeds.append(lines)

        first = discord.Embed(
            title=f"Appeals ({len(filtered)} total)",
            description="\n".join(embeds[0]),
            color=discord.Color.blue(),
        )
        first.set_footer(text=f"Page 1/{len(embeds)}")
        await interaction.response.send_message(embed=first, ephemeral=True)

        for i, chunk_lines in enumerate(embeds[1:], start=2):
            e = discord.Embed(
                description="\n".join(chunk_lines),
                color=discord.Color.blue(),
            )
            e.set_footer(text=f"Page {i}/{len(embeds)}")
            await interaction.followup.send(embed=e, ephemeral=True)

    # ---- apeal-close -------------------------------------------------------

    @bot.tree.command(name="apeal-close", description="Close an appeal (approve or deny)", guild=APPEAL_GUILD)
    @app_commands.describe(appeal_id="Appeal ID (e.g. AP-001)", outcome="Approve or deny", notes="Staff notes (optional)")
    @app_commands.choices(outcome=[
        app_commands.Choice(name="Approved", value="approved"),
        app_commands.Choice(name="Denied", value="denied"),
    ])
    async def apeal_close(
        interaction: discord.Interaction,
        appeal_id: str,
        outcome: str,
        notes: Optional[str] = None,
    ) -> None:
        guard = require_appeal_staff(interaction)
        if guard:
            await interaction.response.send_message(guard, ephemeral=True)
            return
        guild = interaction.guild
        if not guild:
            return
        await interaction.response.send_message("⏳", ephemeral=True)

        try:
            appeals = load_appeals(guild.id)
            appeal = next((a for a in appeals if a.get("id", "").upper() == appeal_id.upper() and a.get("status") == "open"), None)
            if not appeal:
                await interaction.edit_original_response(content=f"Appeal `{appeal_id}` not found or already closed.")
                return

            appeal["status"] = outcome
            appeal["closed_by"] = str(interaction.user)
            appeal["closed_at"] = datetime.now(timezone.utc).isoformat()
            appeal["outcome"] = outcome
            appeal["staff_notes"] = notes or ""
            save_appeals(guild.id, appeals)

            config = load_config(guild.id)
            channel_id = appeal.get("channel_id")
            if channel_id:
                ch = guild.get_channel(channel_id)
                if isinstance(ch, discord.TextChannel):
                    color = discord.Color.green() if outcome == "approved" else discord.Color.red()
                    e = discord.Embed(
                        title=f"Appeal {appeal_id} — {outcome.upper()}",
                        description=f"Appeal has been **{outcome}** by {interaction.user.mention}.",
                        color=color,
                    )
                    if notes:
                        e.add_field(name="Staff Notes", value=notes[:1024], inline=False)
                    await ch.send(embed=e)

                    if outcome == "denied":
                        await ch.edit(name=f"closed-{ch.name[:82]}")
                        uid = appeal.get("user_id")
                        if uid:
                            member = guild.get_member(int(uid))
                            if member:
                                await ch.set_permissions(member, view_channel=False, send_messages=False)

                    if outcome == "approved":
                        await ch.edit(name=f"resolved-{ch.name[:80]}")

            if outcome == "approved":
                jailed_rid = config.get("roles", {}).get("jailed")
                if jailed_rid:
                    jailed_role = guild.get_role(jailed_rid)
                    uid = appeal.get("user_id")
                    if jailed_role and uid:
                        member = guild.get_member(int(uid))
                        if member and jailed_role in member.roles:
                            await member.remove_roles(jailed_role, reason="Appeal approved")

                jailed = load_jailed(guild.id)
                for j in jailed:
                    if j.get("user_id") == appeal.get("user_id") and not j.get("unjailed_at"):
                        j["unjailed_at"] = datetime.now(timezone.utc).isoformat()
                        j["unjailed_by"] = str(interaction.user)
                save_jailed(guild.id, jailed)

            log_id = config.get("channels", {}).get("appeal_log")
            if log_id:
                lch = guild.get_channel(log_id)
                if isinstance(lch, discord.TextChannel):
                    color = discord.Color.green() if outcome == "approved" else discord.Color.red()
                    le = discord.Embed(
                        title=f"Appeal {appeal_id} — {outcome.upper()}",
                        description=f"User: <@{appeal.get('user_id', '?')}>\nReviewed by: {interaction.user.mention}",
                        color=color,
                        timestamp=datetime.now(timezone.utc),
                    )
                    if notes:
                        le.add_field(name="Staff Notes", value=notes[:1024], inline=False)
                    await lch.send(embed=le)

            emoji = "✅" if outcome == "approved" else "❌"
            await interaction.edit_original_response(content=f"{emoji} Appeal `{appeal_id}` has been **{outcome}**.")

        except Exception as e:
            print(f"[apeal-close ERROR] {e}")
            try:
                await interaction.edit_original_response(content=f"❌ Failed to close appeal: {e}")
            except Exception:
                pass

    # ---- apeal-setup-reset -------------------------------------------------

    @bot.tree.command(name="apeal-setup-reset", description="Reset the appeal system config (keeps channels, just clears stored IDs)", guild=APPEAL_GUILD)
    async def apeal_setup_reset(interaction: discord.Interaction) -> None:
        guard = require_admin(interaction)
        if guard:
            await interaction.response.send_message(guard, ephemeral=True)
            return
        guild = interaction.guild
        if not guild:
            return
        save_config(guild.id, {})
        await interaction.response.send_message("Appeal config has been reset. Run `/apeal-setup` to set up again.", ephemeral=True)
