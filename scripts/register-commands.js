const { REST, Routes } = require("discord.js");

// Load environment variables
require("dotenv").config();

const commands = [
  {
    name: "packages",
    description: "Search for Sublime Text packages",
    options: [
      {
        name: "query",
        description: "Package name or search term",
        type: 3, // STRING type
        required: true,
      },
    ],
  },
  {
    name: "stats",
    description: "Show package database statistics",
  },
];

async function registerCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_APPLICATION_ID;
  const guildId = process.env.GUILD_ID; // Optional: for guild-specific commands

  if (!token) {
    console.error("DISCORD_TOKEN is required");
    process.exit(1);
  }

  if (!clientId) {
    console.error("DISCORD_APPLICATION_ID is required");
    process.exit(1);
  }

  const rest = new REST({ version: "10" }).setToken(token);

  try {
    console.log("Started refreshing application (/) commands.");

    // Choose between guild and global commands
    const route = guildId
      ? Routes.applicationGuildCommands(clientId, guildId)
      : Routes.applicationCommands(clientId);

    await rest.put(route, { body: commands });

    console.log("Successfully reloaded application (/) commands.");

    if (guildId) {
      console.log(`Commands registered for guild: ${guildId}`);
    } else {
      console.log(
        "Commands registered globally (may take up to 1 hour to appear)",
      );
    }
  } catch (error) {
    console.error("Error registering commands:", error);
    process.exit(1);
  }
}

registerCommands();
