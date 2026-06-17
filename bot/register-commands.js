import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

const commands = [
  new SlashCommandBuilder()
    .setName('mc-health')
    .setDescription('Check the MacClipper API health'),

  new SlashCommandBuilder()
    .setName('mc-lookup')
    .setDescription('Look up a MacClipper user')
    .addStringOption(o => o.setName('appuuid').setDescription('App UUID'))
    .addStringOption(o => o.setName('email').setDescription('Email address'))
    .addStringOption(o => o.setName('userid').setDescription('MacClipper user ID'))
    .addStringOption(o => o.setName('discordid').setDescription('Discord user ID')),

  new SlashCommandBuilder()
    .setName('mc-ban')
    .setDescription('Ban, unban, or terminate a MacClipper account')
    .addStringOption(o =>
      o.setName('status')
        .setDescription('New account status')
        .setRequired(true)
        .addChoices(
          { name: 'active', value: 'active' },
          { name: 'banned', value: 'banned' },
          { name: 'terminated', value: 'terminated' }
        )
    )
    .addStringOption(o => o.setName('appuuid').setDescription('App UUID'))
    .addStringOption(o => o.setName('email').setDescription('Email address'))
    .addStringOption(o => o.setName('userid').setDescription('MacClipper user ID'))
    .addStringOption(o => o.setName('discordid').setDescription('Discord user ID')),

  new SlashCommandBuilder()
    .setName('mc-admin')
    .setDescription('Toggle admin role for a MacClipper user')
    .addBooleanOption(o => o.setName('enabled').setDescription('Grant or revoke admin').setRequired(true))
    .addStringOption(o => o.setName('appuuid').setDescription('App UUID'))
    .addStringOption(o => o.setName('email').setDescription('Email address'))
    .addStringOption(o => o.setName('userid').setDescription('MacClipper user ID'))
    .addStringOption(o => o.setName('discordid').setDescription('Discord user ID')),

  new SlashCommandBuilder()
    .setName('mc-link')
    .setDescription('Link a Discord account to a MacClipper user')
    .addUserOption(o => o.setName('user').setDescription('Discord user to link').setRequired(true))
    .addStringOption(o => o.setName('appuuid').setDescription('App UUID'))
    .addStringOption(o => o.setName('email').setDescription('Email address'))
    .addStringOption(o => o.setName('userid').setDescription('MacClipper user ID')),

  new SlashCommandBuilder()
    .setName('mc-installations')
    .setDescription('List recent MacClipper installations'),

  new SlashCommandBuilder()
    .setName('mc-ticket-open')
    .setDescription('Open a support ticket channel for a user')
    .addUserOption(o => o.setName('user').setDescription('User to open the ticket for').setRequired(true))
    .addStringOption(o => o.setName('subject').setDescription('Ticket subject').setRequired(false)),

  new SlashCommandBuilder()
    .setName('mc-ticket-claim')
    .setDescription('Claim a ticket so only you can see it')
    .addChannelOption(o => o.setName('channel').setDescription('Ticket channel (defaults to current channel)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('mc-ticket-close')
    .setDescription('Close a ticket')
    .addChannelOption(o => o.setName('channel').setDescription('Ticket channel (defaults to current channel)').setRequired(false))
    .addStringOption(o => o.setName('reason').setDescription('Close reason').setRequired(false))
    .addBooleanOption(o => o.setName('delete').setDescription('Delete channel after close').setRequired(false)),

  new SlashCommandBuilder()
    .setName('mc-giveaway-create')
    .setDescription('Create a giveaway with join button')
    .addStringOption(o => o.setName('prize').setDescription('Prize text').setRequired(true))
    .addIntegerOption(o => o.setName('duration').setDescription('Duration in minutes').setRequired(true))
    .addIntegerOption(o => o.setName('winners').setDescription('Number of winners').setRequired(true)),

  new SlashCommandBuilder()
    .setName('mc-giveaway-draw')
    .setDescription('Draw winners for a giveaway')
    .addStringOption(o => o.setName('messageid').setDescription('Giveaway message ID').setRequired(true))
    .addBooleanOption(o => o.setName('force').setDescription('Re-draw even if already ended').setRequired(false)),

  new SlashCommandBuilder()
    .setName('mc-poll-create')
    .setDescription('Create a poll with vote buttons')
    .addStringOption(o => o.setName('question').setDescription('Poll question').setRequired(true))
    .addStringOption(o => o.setName('option1').setDescription('Option 1').setRequired(true))
    .addStringOption(o => o.setName('option2').setDescription('Option 2').setRequired(true))
    .addStringOption(o => o.setName('option3').setDescription('Option 3').setRequired(false))
    .addStringOption(o => o.setName('option4').setDescription('Option 4').setRequired(false)),

  // ---- Appeal System Commands ---- //

  new SlashCommandBuilder()
    .setName('apeal-setup')
    .setDescription('Create the complete appeal server structure (channels, roles, categories)'),

  new SlashCommandBuilder()
    .setName('apeal-jail')
    .setDescription('Jail a user (restrict to appeals channels only)')
    .addUserOption(o => o.setName('user').setDescription('User to jail').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for jailing').setRequired(true)),

  new SlashCommandBuilder()
    .setName('apeal-unjail')
    .setDescription('Release a user from jail')
    .addUserOption(o => o.setName('user').setDescription('User to unjail').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for unjailing').setRequired(false)),

  new SlashCommandBuilder()
    .setName('apeal-jail-list')
    .setDescription('List all currently jailed users'),

  new SlashCommandBuilder()
    .setName('apeal-list')
    .setDescription('List open appeals')
    .addStringOption(o => o.setName('status').setDescription('Filter by status (open/approved/denied)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('apeal-close')
    .setDescription('Close an appeal (approve or deny)')
    .addStringOption(o => o.setName('appeal_id').setDescription('Appeal ID (e.g. AP-001)').setRequired(true))
    .addStringOption(o => o.setName('outcome').setDescription('Approve or deny').setRequired(true)
      .addChoices(
        { name: 'Approved', value: 'approved' },
        { name: 'Denied', value: 'denied' },
      ))
    .addStringOption(o => o.setName('notes').setDescription('Staff notes (optional)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('apeal-setup-reset')
    .setDescription('Reset the appeal system config (keeps channels, just clears stored IDs)'),

  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Get a link to connect your Discord to your MacClipper account'),

  new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Unlink your Discord from your MacClipper account'),

  new SlashCommandBuilder()
    .setName('unlockfeature')
    .setDescription('Grant a feature to a user (staff only)')
    .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true))
    .addStringOption(o => o.setName('feature').setDescription('Feature key (e.g. 4k-pro)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('removepro')
    .setDescription('Remove Pro subscription from a user (staff only)')
    .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true)),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('Registering slash commands globally...');
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('Done — commands registered globally. They may take up to 1 hour to appear in all servers.');
  } catch (error) {
    console.error('Failed to register commands:', error);
    process.exit(1);
  }
})();
