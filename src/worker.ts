import { verifyKey } from "discord-interactions";

// Types for Discord interactions
interface DiscordInteraction {
  id: string;
  application_id: string;
  type: number;
  data?: {
    id: string;
    name: string;
    options?: Array<{
      name: string;
      type: number;
      value: string;
    }>;
  };
  channel_id: string;
  token: string;
  version: number;
  member?: {
    user: {
      id: string;
      username: string;
    };
  };
}

interface DiscordResponse {
  type: number;
  data?: {
    content?: string;
    embeds?: Array<{
      title?: string;
      description?: string;
      color?: number;
      fields?: Array<{
        name: string;
        value: string;
        inline?: boolean;
      }>;
      footer?: {
        text: string;
      };
      timestamp?: string;
    }>;
    flags?: number;
  };
}

// Types for Sublime Text package data
interface Release {
  sublime_text: string;
  platforms: string[];
  version: string;
  url: string;
  date: string;
  python_versions?: string[];
  sha256?: string;
}

interface Package {
  name: string;
  author: string[];
  last_modified: string;
  releases: Release[];
  homepage?: string;
  description: string;
  previous_names: string[];
  labels: string[];
  readme?: string;
  issues?: string;
  donate?: string;
  buy?: string;
}

interface Library {
  name: string;
  author: string;
  description: string;
  issues?: string;
  releases: Release[];
}

interface ChannelData {
  schema_version: string;
  repositories: string[];
  packages_cache: {
    [repository: string]: Package[];
  };
  libraries_cache: {
    [repository: string]: Library[];
  };
}

interface SearchResult {
  name: string;
  description: string;
  author: string[] | string;
  homepage?: string;
  type: "package" | "library";
  labels?: string[];
  latest_version?: string;
  repository: string;
  relevanceScore: number;
  issues?: string;
  last_modified?: string;
}

// Discord interaction types
const INTERACTION_TYPE = {
  PING: 1,
  APPLICATION_COMMAND: 2,
};

const INTERACTION_RESPONSE_TYPE = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
};

// Environment variables interface
interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
}

class PackageService {
  private static readonly CHANNEL_URL =
    "https://github.com/packagecontrol/thecrawl/releases/download/the-channel/channel.json";

  async fetchChannelData(): Promise<ChannelData> {
    try {
      console.log("Fetching channel data from:", PackageService.CHANNEL_URL);

      const response = await fetch(PackageService.CHANNEL_URL, {
        cf: {
          cacheTtl: 300, // Cache for 5 minutes
          cacheEverything: true,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: ChannelData = await response.json();
      console.log("Channel data fetched successfully");
      return data;
    } catch (error) {
      console.error("Error fetching channel data:", error);
      throw new Error("Failed to fetch package data. Please try again later.");
    }
  }

  async searchPackages(query: string): Promise<SearchResult[]> {
    if (!query || query.trim().length === 0) {
      throw new Error("Please provide a search query.");
    }

    const channelData = await this.fetchChannelData();
    const results: SearchResult[] = [];
    const searchTerm = query.trim();

    // Check if query is a regex pattern
    const isRegexQuery = this.isRegexPattern(searchTerm);
    let regexPattern: RegExp | null = null;

    if (isRegexQuery) {
      try {
        // Remove surrounding slashes if present
        const cleanPattern = searchTerm.replace(/^\/|\/$/g, "");
        regexPattern = new RegExp(cleanPattern, "i"); // Case insensitive
      } catch (error) {
        throw new Error(`Invalid regex pattern: ${searchTerm}`);
      }
    }

    // Search through packages
    for (const [repository, packages] of Object.entries(
      channelData.packages_cache,
    )) {
      for (const pkg of packages) {
        if (!pkg.name || !pkg.description) {
          continue;
        }

        const relevanceScore = this.calculateRelevance(
          pkg.name,
          pkg.description,
          searchTerm,
          regexPattern,
        );

        if (relevanceScore > 0) {
          const latestRelease =
            pkg.releases.length > 0 ? pkg.releases[0] : null;

          results.push({
            name: pkg.name,
            description: pkg.description,
            author: pkg.author,
            homepage: pkg.homepage,
            type: "package",
            labels: pkg.labels,
            latest_version: latestRelease?.version,
            repository: repository,
            relevanceScore: relevanceScore,
            issues: pkg.issues,
            last_modified: pkg.last_modified,
          });
        }
      }
    }

    // Search through libraries
    for (const [repository, libraries] of Object.entries(
      channelData.libraries_cache,
    )) {
      for (const lib of libraries) {
        if (!lib.name || !lib.description) {
          continue;
        }

        const relevanceScore = this.calculateRelevance(
          lib.name,
          lib.description,
          searchTerm,
          regexPattern,
        );

        if (relevanceScore > 0) {
          const latestRelease =
            lib.releases.length > 0 ? lib.releases[0] : null;

          results.push({
            name: lib.name,
            description: lib.description,
            author: lib.author,
            type: "library",
            latest_version: latestRelease?.version,
            repository: repository,
            relevanceScore: relevanceScore,
            issues: lib.issues,
            last_modified: lib.last_modified,
          });
        }
      }
    }

    // Sort by relevance score (highest first) and return top 10
    return results
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 10);
  }

  public isRegexPattern(query: string): boolean {
    // Check if query is wrapped in forward slashes
    if (query.startsWith("/") && query.endsWith("/") && query.length > 2) {
      return true;
    }

    // Check if query contains regex special characters
    const regexChars = /[.*+?^${}()|[\]\\]/;
    return regexChars.test(query);
  }

  private calculateRelevance(
    name: string,
    description: string,
    searchTerm: string,
    regexPattern?: RegExp | null,
  ): number {
    if (!name || !description || !searchTerm) {
      return 0;
    }

    let score = 0;

    if (regexPattern) {
      // Use regex matching
      const nameMatch = regexPattern.test(name);
      const descriptionMatch = regexPattern.test(description);

      if (nameMatch) {
        // Check if it's a full match
        const fullMatch = regexPattern.exec(name);
        if (fullMatch && fullMatch[0] === name) {
          score += 100; // Full name match
        } else if (
          name.toLowerCase().startsWith(fullMatch?.[0]?.toLowerCase() || "")
        ) {
          score += 50; // Name starts with match
        } else {
          score += 25; // Name contains match
        }
      }

      if (descriptionMatch) {
        score += 10;
      }
    } else {
      // Use string matching (existing logic)
      const nameLower = name.toLowerCase();
      const descriptionLower = description.toLowerCase();
      const searchTermLower = searchTerm.toLowerCase();

      // Exact name match gets highest score
      if (nameLower === searchTermLower) {
        score += 100;
      }
      // Name starts with search term
      else if (nameLower.startsWith(searchTermLower)) {
        score += 50;
      }
      // Name contains search term
      else if (nameLower.includes(searchTermLower)) {
        score += 25;
      }

      // Description contains search term
      if (descriptionLower.includes(searchTermLower)) {
        score += 10;
      }
    }

    // Boost score for shorter names (more specific matches)
    if (score > 0 && name.length < 20) {
      score += 5;
    }

    return score;
  }

  async getStats(): Promise<{ packages: number; libraries: number }> {
    const channelData = await this.fetchChannelData();

    let packageCount = 0;
    let libraryCount = 0;

    for (const packages of Object.values(channelData.packages_cache)) {
      packageCount += packages.length;
    }

    for (const libraries of Object.values(channelData.libraries_cache)) {
      libraryCount += libraries.length;
    }

    return { packages: packageCount, libraries: libraryCount };
  }
}

// Create search results embeds (returns array of embeds)
function createSearchResultsEmbeds(
  query: string,
  results: SearchResult[],
  isRegex: boolean = false,
) {
  if (results.length === 0) {
    const searchType = isRegex ? "regex pattern" : "query";
    return [
      {
        title: `🔍 No Results for ${searchType} "${query}"`,
        color: 0xe74c3c,
        description: `No packages found matching ${searchType} "${query}". Try a different search term.`,
        footer: {
          text: "Package Control Search",
        },
        timestamp: new Date().toISOString(),
      },
    ];
  }

  // Check for exact name match (only for non-regex queries)
  const exactMatch = !isRegex
    ? results.find(
        (result) => result.name.toLowerCase() === query.toLowerCase(),
      )
    : null;

  // If exact match exists, show only that one
  const resultsToShow = exactMatch ? [exactMatch] : results.slice(0, 3);

  return resultsToShow.map((result) => {
    const authorText = Array.isArray(result.author)
      ? result.author.join(", ")
      : result.author || "Unknown";

    const embed = {
      description: result.description || "No description available",
      color: null,
      fields: [] as Array<{
        name: string;
        value: string;
        inline?: boolean;
      }>,
      author: {
        name: `${result.name} by ${authorText}`,
        url:
          result.homepage ||
          `https://packages.sublimetext.io/packages/${result.name}/`,
        icon_url: "https://packages.sublimetext.io/static/logo.webp",
      },
      footer: {
        text: isRegex
          ? "Regex search - Package updated at"
          : "Package updated at",
      },
      timestamp: result.last_modified || new Date().toISOString(),
    };

    // Add Latest Version field
    if (result.latest_version) {
      embed.fields.push({
        name: "Latest Version",
        value: result.latest_version,
      });
    }

    // Add Labels field
    if (result.labels && result.labels.length > 0) {
      embed.fields.push({
        name: "Labels",
        value: result.labels.join(", "),
      });
    }

    // Add Repository field
    if (result.homepage) {
      embed.fields.push({
        name: "Repository",
        value: result.homepage,
        inline: true,
      });
    }

    // Add Issues field
    if (result.issues) {
      embed.fields.push({
        name: "Issues",
        value: result.issues,
        inline: true,
      });
    }

    return embed;
  });
}

// Create stats embed
function createStatsEmbed(stats: { packages: number; libraries: number }) {
  return {
    title: "📊 Sublime Text Package Database Stats",
    color: 0x3498db,
    fields: [
      {
        name: "📦 Total Packages",
        value: stats.packages.toLocaleString(),
        inline: true,
      },
      {
        name: "📚 Total Libraries",
        value: stats.libraries.toLocaleString(),
        inline: true,
      },
      {
        name: "🔍 Search Command",
        value: "Use `/packages {query}` to search",
        inline: false,
      },
    ],
    footer: {
      text: "Data from Package Control",
    },
    timestamp: new Date().toISOString(),
  };
}

// Handle Discord interactions
async function handleDiscordInteraction(
  interaction: DiscordInteraction,
): Promise<DiscordResponse> {
  const packageService = new PackageService();

  if (interaction.type === INTERACTION_TYPE.PING) {
    return {
      type: INTERACTION_RESPONSE_TYPE.PONG,
    };
  }

  if (interaction.type === INTERACTION_TYPE.APPLICATION_COMMAND) {
    const commandName = interaction.data?.name;

    if (commandName === "packages") {
      const queryOption = interaction.data?.options?.find(
        (opt) => opt.name === "query",
      );
      const query = queryOption?.value as string;

      if (!query) {
        return {
          type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: "Please provide a search query.",
            flags: 64, // Ephemeral flag
          },
        };
      }

      try {
        const results = await packageService.searchPackages(query);

        if (results.length === 0) {
          return {
            type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `No packages found matching "${query}". Try a different search term.`,
            },
          };
        }

        const isRegex = packageService.isRegexPattern(query);
        const embeds = createSearchResultsEmbeds(query, results, isRegex);

        return {
          type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: embeds,
          },
        };
      } catch (error) {
        console.error("Error searching packages:", error);
        return {
          type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content:
              error instanceof Error
                ? error.message
                : "An error occurred while searching packages.",
            flags: 64, // Ephemeral flag
          },
        };
      }
    }

    if (commandName === "stats") {
      try {
        const stats = await packageService.getStats();
        const embed = createStatsEmbed(stats);

        return {
          type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [embed],
          },
        };
      } catch (error) {
        console.error("Error fetching stats:", error);
        return {
          type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: "An error occurred while fetching statistics.",
            flags: 64, // Ephemeral flag
          },
        };
      }
    }
  }

  return {
    type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: "Unknown command.",
      flags: 64, // Ephemeral flag
    },
  };
}

// Main Cloudflare Worker handler
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    try {
      // Only handle POST requests
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      // Verify request signature
      const signature = request.headers.get("X-Signature-Ed25519");
      const timestamp = request.headers.get("X-Signature-Timestamp");
      const body = await request.text();

      if (!signature || !timestamp) {
        return new Response("Missing signature headers", { status: 401 });
      }

      const isValid = await verifyKey(
        body,
        signature,
        timestamp,
        env.DISCORD_PUBLIC_KEY,
      );
      if (!isValid) {
        return new Response("Invalid signature", { status: 401 });
      }

      // Parse interaction
      const interaction: DiscordInteraction = JSON.parse(body);

      // Handle interaction
      const response = await handleDiscordInteraction(interaction);

      return new Response(JSON.stringify(response), {
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      console.error("Worker error:", error);
      return new Response("Internal server error", { status: 500 });
    }
  },
};
