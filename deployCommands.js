const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('./config.json');

const commands = [

new SlashCommandBuilder()
.setName('battle')
.setDescription('Create a Flame Force battle reminder')
.addSubcommand(subcommand =>
subcommand
.setName('create')
.setDescription('Schedule a battle')
.addStringOption(option =>
option.setName('opponent')
.setDescription('Opponent creator name')
.setRequired(true))
.addStringOption(option =>
option.setName('date')
.setDescription('Date DD/MM/YYYY')
.setRequired(true))
.addStringOption(option =>
option.setName('time')
.setDescription('Time HH:MM UK')
.setRequired(true)))

].map(command => command.toJSON());


const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {

await rest.put(
Routes.applicationCommands(config.clientId),
{ body: commands }
);

console.log('🔥 Slash commands deployed');

})();