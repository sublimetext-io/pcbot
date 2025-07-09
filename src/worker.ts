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
    custom_id?: string;
    values?: string[];
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
      author?: {
        name: string;
        url: string;
        icon_url: string;
      };
    }>;
    flags?: number;
    components?: Array<{
      type: number;
      components: Array<{
        type: number;
        custom_id: string;
        label?: string;
        style?: number;
        options?: Array<{
          label: string;
          value: string;
          description?: string;
        }>;
      }>;
    }>;
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
  last_modified?: string;
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
  MESSAGE_COMPONENT: 3,
};

const INTERACTION_RESPONSE_TYPE = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  UPDATE_MESSAGE: 7,
};

const COMPONENT_TYPE = {
  ACTION_ROW: 1,
  BUTTON: 2,
  SELECT_MENU: 3,
};

// Environment variables interface
interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
  PACKAGE_CACHE: KVNamespace;
}

// Advanced search filter interface
interface SearchFilters {
  author?: string;
  label?: string;
  textQuery: string;
}

class PackageService {
  private static readonly CHANNEL_URL =
    "https://github.com/packagecontrol/thecrawl/releases/download/the-channel/channel.json";

  constructor(private env: Env) {}

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

  private getLatestRelease(releases: Release[]): Release | null {
    if (releases.length === 0) return null;
    
    // Sort releases by date (newest first)
    const sortedReleases = releases.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateB - dateA;
    });
    
    return sortedReleases[0];
  }

  parseSearchQuery(query: string): SearchFilters {
    const filters: SearchFilters = { textQuery: '' };
    
    // Regex to match filter patterns like "author:value" or "label:value"
    const filterRegex = /(\w+):(\S+)/g;
    let match;
    let remainingQuery = query;
    
    // Extract filters
    while ((match = filterRegex.exec(query)) !== null) {
      const [fullMatch, filterType, filterValue] = match;
      
      switch (filterType.toLowerCase()) {
        case 'author':
          filters.author = filterValue;
          break;
        case 'label':
          filters.label = filterValue;
          break;
        // Add more filter types as needed
      }
      
      // Remove the filter from the remaining query
      remainingQuery = remainingQuery.replace(fullMatch, '').trim();
    }
    
    filters.textQuery = remainingQuery.trim();
    return filters;
  }

  private matchesFilters(
    pkg: Package | Library,
    filters: SearchFilters
  ): boolean {
    // Check author filter
    if (filters.author) {
      const authors = Array.isArray(pkg.author) ? pkg.author : [pkg.author];
      const authorMatch = authors.some(author => 
        author.toLowerCase().includes(filters.author!.toLowerCase())
      );
      if (!authorMatch) return false;
    }

    // Check label filter (only applicable to packages)
    if (filters.label && 'labels' in pkg) {
      const labelMatch = pkg.labels?.some(label => 
        label.toLowerCase().includes(filters.label!.toLowerCase())
      );
      if (!labelMatch) return false;
    }

    return true;
  }

  async searchPackages(query: string): Promise<SearchResult[]> {
    if (!query || query.trim().length === 0) {
      throw new Error("Please provide a search query.");
    }

    const channelData = await this.fetchChannelData();
    const results: SearchResult[] = [];
    const filters = this.parseSearchQuery(query.trim());

    // Check if the text query is a regex pattern
    const isRegexQuery = filters.textQuery ? this.isRegexPattern(filters.textQuery) : false;
    let regexPattern: RegExp | null = null;

    if (isRegexQuery && filters.textQuery) {
      try {
        // Remove surrounding slashes if present
        const cleanPattern = filters.textQuery.replace(/^\/|\/$/g, "");
        regexPattern = new RegExp(cleanPattern, "i"); // Case insensitive
      } catch (error) {
        throw new Error(`Invalid regex pattern: ${filters.textQuery}`);
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

        // First check if it matches the filters
        if (!this.matchesFilters(pkg, filters)) {
          continue;
        }

        let relevanceScore = 0;

        // If there's a text query, calculate relevance for it
        if (filters.textQuery) {
          relevanceScore = this.calculateRelevance(
            pkg.name,
            pkg.description,
            filters.textQuery,
            regexPattern,
          );
        } else {
          // If no text query but filters match, give a base score
          relevanceScore = 20;
        }

        // Boost score for filter matches
        if (filters.author) {
          relevanceScore += 30;
        }
        if (filters.label) {
          relevanceScore += 25;
        }

        if (relevanceScore > 0) {
          const latestRelease = this.getLatestRelease(pkg.releases);

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

        // First check if it matches the filters
        if (!this.matchesFilters(lib, filters)) {
          continue;
        }

        let relevanceScore = 0;

        // If there's a text query, calculate relevance for it
        if (filters.textQuery) {
          relevanceScore = this.calculateRelevance(
            lib.name,
            lib.description,
            filters.textQuery,
            regexPattern,
          );
        } else {
          // If no text query but filters match, give a base score
          relevanceScore = 20;
        }

        // Boost score for filter matches
        if (filters.author) {
          relevanceScore += 30;
        }

        if (relevanceScore > 0) {
          const latestRelease = this.getLatestRelease(lib.releases);

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

  async storeSearchResults(searchId: string, results: SearchResult[]): Promise<void> {
    // Store results in KV with 15-minute expiration (Discord component timeout)
    await this.env.PACKAGE_CACHE.put(
      `search_${searchId}`,
      JSON.stringify(results),
      { expirationTtl: 900 } // 15 minutes
    );
  }

  async getSearchResults(searchId: string): Promise<SearchResult[] | null> {
    const data = await this.env.PACKAGE_CACHE.get(`search_${searchId}`);
    return data ? JSON.parse(data) : null;
  }

  async getPackageDetails(packageName: string, repository: string): Promise<Package | Library | null> {
    const channelData = await this.fetchChannelData();
    
    // Search in packages
    for (const [repo, packages] of Object.entries(channelData.packages_cache)) {
      if (repo === repository) {
        const pkg = packages.find(p => p.name === packageName);
        if (pkg) return pkg;
      }
    }
    
    // Search in libraries
    for (const [repo, libraries] of Object.entries(channelData.libraries_cache)) {
      if (repo === repository) {
        const lib = libraries.find(l => l.name === packageName);
        if (lib) return lib;
      }
    }
    
    return null;
  }
}

// Create detailed package embed with full information
function createPackageDetailEmbed(pkg: Package | Library, result: SearchResult): any {
  const authorText = Array.isArray(pkg.author) ? pkg.author.join(", ") : pkg.author;
  const isPackage = 'labels' in pkg;

  const embed = {
    title: `${pkg.name} by ${authorText}`,
    description: pkg.description || "No description available",
    color: isPackage ? 0x3498db : 0xe67e22,
    fields: [] as Array<{
      name: string;
      value: string;
      inline?: boolean;
    }>,
    author: {
      name: isPackage ? "📦 Package" : "📚 Library",
      icon_url: "https://packages.sublimetext.io/static/logo.webp",
    },
    footer: {
      text: "Package Control Search",
    },
    timestamp: pkg.last_modified || new Date().toISOString(),
  };

  // Add Latest Version field
  if (result.latest_version) {
    embed.fields.push({
      name: "Latest Version",
      value: result.latest_version,
      inline: true,
    });
  }

  // Add Type field
  embed.fields.push({
    name: "Type",
    value: isPackage ? "📦 Package" : "📚 Library",
    inline: true,
  });

  // Add Repository field
  if (result.repository) {
    embed.fields.push({
      name: "Repository",
      value: result.repository,
      inline: true,
    });
  }

  // Add Labels field (packages only)
  if (isPackage && pkg.labels && pkg.labels.length > 0) {
    embed.fields.push({
      name: "Labels",
      value: pkg.labels.join(", "),
      inline: false,
    });
  }

  // Add Previous Names field (packages only)
  if (isPackage && pkg.previous_names && pkg.previous_names.length > 0) {
    embed.fields.push({
      name: "Previous Names",
      value: pkg.previous_names.join(", "),
      inline: false,
    });
  }

  // Add Homepage field
  if (result.homepage) {
    embed.fields.push({
      name: "Homepage",
      value: result.homepage,
      inline: false,
    });
  }

  // Add Issues field
  if (pkg.issues) {
    embed.fields.push({
      name: "Issues",
      value: pkg.issues,
      inline: false,
    });
  }

  // Add Readme field (packages only)
  if (isPackage && pkg.readme) {
    embed.fields.push({
      name: "Documentation",
      value: pkg.readme,
      inline: false,
    });
  }

  // Add Donate field (packages only)
  if (isPackage && pkg.donate) {
    embed.fields.push({
      name: "Support",
      value: pkg.donate,
      inline: true,
    });
  }

  // Add Buy field (packages only)
  if (isPackage && pkg.buy) {
    embed.fields.push({
      name: "Purchase",
      value: pkg.buy,
      inline: true,
    });
  }

  return embed;
}

// Create search results embeds with interactive components
function createSearchResultsEmbeds(
  query: string,
  results: SearchResult[],
  filters: SearchFilters,
  isRegex: boolean = false,
  userId?: string,
) {
  // Create filter description
  const filterParts: string[] = [];
  if (filters.author) filterParts.push(`**Author:** ${filters.author}`);
  if (filters.label) filterParts.push(`**Label:** ${filters.label}`);
  
  const filterText = filterParts.length > 0 
    ? `\n**Active Filters:** ${filterParts.join(', ')}`
    : '';

  if (results.length === 0) {
    const searchType = isRegex ? "regex pattern" : "query";
    const queryText = filters.textQuery || "filter-only search";
    
    return {
      embeds: [{
        title: `🔍 No Results`,
        color: 0xe74c3c,
        description: `No packages found matching ${searchType} "${queryText}"${filterText}\n\nTry:\n• Different search terms\n• \`author:username\` to filter by author\n• \`label:labelname\` to filter by label\n• Combine filters: \`author:FichteFoll label:snippets Package\``,
        footer: {
          text: "Package Control Search",
        },
        timestamp: new Date().toISOString(),
      }],
      components: []
    };
  }

  // Check for exact name match (only for non-regex queries)
  const exactMatch = !isRegex && filters.textQuery
    ? results.find(
        (result) => result.name.toLowerCase() === filters.textQuery.toLowerCase(),
      )
    : null;

  // If exact match exists, show only that one
  const resultsToShow = exactMatch ? [exactMatch] : results.slice(0, 3);

  const embeds = resultsToShow.map((result) => {
    const authorText = Array.isArray(result.author)
      ? result.author.join(", ")
      : result.author || "Unknown";

    const embed = {
      description: result.description || "No description available",
      color: 0x3498db,
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

  // Add filter info to the first embed if filters are active
  if (filterParts.length > 0 && embeds.length > 0) {
    embeds[0].description = `${filterText}\n\n${embeds[0].description}`;
  }

  // Create interactive components if we have multiple results
  const components: Array<{
    type: number;
    components: Array<{
      type: number;
      custom_id: string;
      label?: string;
      style?: number;
      options?: Array<{
        label: string;
        value: string;
        description?: string;
      }>;
    }>;
  }> = [];
  
  if (results.length > 1) {
    // Generate a shorter, more reliable search ID with user prefix
    const searchId = `${userId ? userId.substring(0, 8) : 'anon'}_${Math.random().toString(36).substring(2, 15)}`;
    
    // Create select menu with package options
    const selectMenu = {
      type: COMPONENT_TYPE.ACTION_ROW,
      components: [{
        type: COMPONENT_TYPE.SELECT_MENU,
        custom_id: `package_select_${searchId}`,
        placeholder: `Select a package to view details (${results.length} found)`,
        options: results.slice(0, 25).map((result, index) => ({
          label: result.name,
          value: `${result.name}|${result.repository}|${index}`,
          description: `${Array.isArray(result.author) ? result.author.join(", ") : result.author} - ${result.description?.substring(0, 50)}...`,
        })),
      }],
    };
    components.push(selectMenu);

    // Store the search ID for later retrieval
    return { embeds, components, searchId };
  }

  return { embeds, components };
}

// Create a single embed that can be updated with package details
function createUpdatableSearchEmbed(
  query: string,
  results: SearchResult[],
  filters: SearchFilters,
  selectedIndex?: number
) {
  // Create filter description
  const filterParts: string[] = [];
  if (filters.author) filterParts.push(`**Author:** ${filters.author}`);
  if (filters.label) filterParts.push(`**Label:** ${filters.label}`);
  
  const filterText = filterParts.length > 0 
    ? `\n**Active Filters:** ${filterParts.join(', ')}`
    : '';

  if (results.length === 0) {
    return {
      title: `🔍 No Results`,
      color: 0xe74c3c,
      description: `No packages found matching "${query}"${filterText}\n\nTry:\n• Different search terms\n• \`author:username\` to filter by author\n• \`label:labelname\` to filter by label`,
      footer: {
        text: "Package Control Search",
      },
      timestamp: new Date().toISOString(),
    };
  }

  // If a specific package is selected, show its details
  if (selectedIndex !== undefined && results[selectedIndex]) {
    const result = results[selectedIndex];
    const authorText = Array.isArray(result.author)
      ? result.author.join(", ")
      : result.author || "Unknown";

    return {
      title: `${result.name} by ${authorText}`,
      description: result.description || "No description available",
      color: result.type === "package" ? 0x3498db : 0xe67e22,
      fields: [
        ...(result.latest_version ? [{
          name: "Latest Version",
          value: result.latest_version,
          inline: true,
        }] : []),
        {
          name: "Type",
          value: result.type === "package" ? "📦 Package" : "📚 Library",
          inline: true,
        },
        ...(result.repository ? [{
          name: "Repository",
          value: result.repository,
          inline: true,
        }] : []),
        ...(result.labels && result.labels.length > 0 ? [{
          name: "Labels",
          value: result.labels.join(", "),
          inline: false,
        }] : []),
        ...(result.homepage ? [{
          name: "Homepage",
          value: result.homepage,
          inline: false,
        }] : []),
        ...(result.issues ? [{
          name: "Issues",
          value: result.issues,
          inline: false,
        }] : []),
      ],
      author: {
        name: result.type === "package" ? "📦 Package" : "📚 Library",
        url: result.homepage || `https://packages.sublimetext.io/packages/${result.name}/`,
        icon_url: "https://packages.sublimetext.io/static/logo.webp",
      },
      footer: {
        text: `Showing ${selectedIndex + 1} of ${results.length} results`,
      },
      timestamp: result.last_modified || new Date().toISOString(),
    };
  }

  // Show overview of all results
  const resultCount = results.length;
  const topResults = results.slice(0, 5);
  
  const resultList = topResults.map((result, index) => {
    const authorText = Array.isArray(result.author)
      ? result.author.join(", ")
      : result.author || "Unknown";
    return `${index + 1}. **${result.name}** by ${authorText}\n   ${result.description?.substring(0, 100)}...`;
  }).join('\n\n');

  return {
    title: `🔍 Search Results for "${query}"`,
    description: `${filterText}\n\n**Found ${resultCount} packages:**\n\n${resultList}${resultCount > 5 ? `\n\n...and ${resultCount - 5} more` : ''}`,
    color: 0x3498db,
    footer: {
      text: "Use the dropdown below to view detailed information",
    },
    timestamp: new Date().toISOString(),
  };
}

// Create help embed
function createHelpEmbed() {
  return {
    title: "📖 Package Control Search Help",
    color: 0x9b59b6,
    description: "Search through Sublime Text packages and libraries with powerful filters and queries.",
    fields: [
      {
        name: "🔍 Basic Search",
        value: "`/packages LSP` - Search for packages containing 'LSP'",
        inline: false,
      },
      {
        name: "👤 Author Filter",
        value: "`/packages author:FichteFoll` - Find packages by specific author\n`/packages author:FichteFoll Package` - Combine with text search",
        inline: false,
      },
      {
        name: "🏷️ Label Filter", 
        value: "`/packages label:snippets` - Find packages with specific label\n`/packages label:lsp completion` - Combine with text search",
        inline: false,
      },
      {
        name: "🔧 Advanced Search",
        value: "`/packages author:FichteFoll label:syntax theme` - Multiple filters + text",
        inline: false,
      },
      {
        name: "🔀 Regex Search",
        value: "`/packages /^LSP/` - Use regex patterns (wrap in forward slashes)",
        inline: false,
      },
      {
        name: "📊 Other Commands",
        value: "`/stats` - View package database statistics",
        inline: false,
      },
    ],
    footer: {
      text: "Package Control Search • Case-insensitive matching",
    },
    timestamp: new Date().toISOString(),
  };
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
  env: Env,
): Promise<DiscordResponse> {
  const packageService = new PackageService(env);

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
        const filters = packageService.parseSearchQuery(query.trim());
        const isRegex = filters.textQuery ? packageService.isRegexPattern(filters.textQuery) : false;
        
        // Get user ID for user-specific search results
        const userId = interaction.member?.user?.id;
        const response = createSearchResultsEmbeds(query, results, filters, isRegex, userId);

        // Store results for interactive selection
        if (results.length > 1 && response.searchId) {
          console.log(`Storing search results with ID: ${response.searchId} for user: ${userId}`);
          await packageService.storeSearchResults(response.searchId, results);
        }

        // If we have multiple results, show the first package directly with navigation
        if (results.length > 1) {
          const firstPackageEmbed = createUpdatableSearchEmbed(query, results, filters, 0);
          
          const navigationComponents = [
            {
              type: COMPONENT_TYPE.ACTION_ROW,
              components: [
                {
                  type: COMPONENT_TYPE.BUTTON,
                  custom_id: `prev_package_${response.searchId}_0`,
                  label: "← Previous",
                  style: 2, // Secondary button
                  disabled: true, // First package, so previous is disabled
                },
                {
                  type: COMPONENT_TYPE.BUTTON,
                  custom_id: `next_package_${response.searchId}_0`,
                  label: "Next →",
                  style: 2, // Secondary button
                  disabled: results.length === 1,
                },
                {
                  type: COMPONENT_TYPE.BUTTON,
                  custom_id: `package_list_${response.searchId}`,
                  label: "📋 All Packages",
                  style: 1, // Primary button
                },
              ],
            },
          ];

          return {
            type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              embeds: [firstPackageEmbed],
              components: navigationComponents,
            },
          };
        }

        return {
          type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: response.embeds,
            components: response.components,
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

    if (commandName === "help") {
      const embed = createHelpEmbed();
      return {
        type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [embed],
          components: [],
        },
      };
    }

    if (commandName === "stats") {
      try {
        const stats = await packageService.getStats();
        const embed = createStatsEmbed(stats);

        return {
          type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [embed],
            components: [],
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

  if (interaction.type === INTERACTION_TYPE.MESSAGE_COMPONENT) {
    const customId = interaction.data?.custom_id;
    
    if (customId?.startsWith('package_select_')) {
      const selectedValue = interaction.data?.values?.[0];
      
      if (selectedValue) {
        const [packageName, repository, indexStr] = selectedValue.split('|');
        const index = parseInt(indexStr);
        
        try {
          // Extract search ID more reliably
          const searchId = customId.replace('package_select_', '');
          console.log(`Retrieving search results with ID: ${searchId}`);
          
          const results = await packageService.getSearchResults(searchId);
          
          if (!results || !results[index]) {
            console.log(`No results found for search ID: ${searchId}, index: ${index}`);
            return {
              type: INTERACTION_RESPONSE_TYPE.UPDATE_MESSAGE,
              data: {
                embeds: [{
                  title: "❌ Error",
                  description: "Search results have expired or are no longer available. Please search again.",
                  color: 0xe74c3c,
                  footer: {
                    text: "Package Control Search",
                  },
                  timestamp: new Date().toISOString(),
                }],
                components: [],
              },
            };
          }

          // Create updated embed with the selected package details
          const filters = packageService.parseSearchQuery(""); // Empty for now
          const updatedEmbed = createUpdatableSearchEmbed("", results, filters, index);

          // Create navigation buttons
          const navigationComponents = [
            {
              type: COMPONENT_TYPE.ACTION_ROW,
              components: [
                {
                  type: COMPONENT_TYPE.BUTTON,
                  custom_id: `prev_package_${searchId}_${index}`,
                  label: "← Previous",
                  style: 2, // Secondary button
                  disabled: index === 0,
                },
                {
                  type: COMPONENT_TYPE.BUTTON,
                  custom_id: `next_package_${searchId}_${index}`,
                  label: "Next →",
                  style: 2, // Secondary button
                  disabled: index === results.length - 1,
                },
                {
                  type: COMPONENT_TYPE.BUTTON,
                  custom_id: `package_list_${searchId}`,
                  label: "📋 All Packages",
                  style: 1, // Primary button
                },
              ],
            },
          ];

          return {
            type: INTERACTION_RESPONSE_TYPE.UPDATE_MESSAGE,
            data: {
              embeds: [updatedEmbed],
              components: navigationComponents,
            },
          };
        } catch (error) {
          console.error("Error handling package selection:", error);
          return {
            type: INTERACTION_RESPONSE_TYPE.UPDATE_MESSAGE,
            data: {
              embeds: [{
                title: "❌ Error",
                description: "An error occurred while retrieving package details.",
                color: 0xe74c3c,
                footer: {
                  text: "Package Control Search",
                },
                timestamp: new Date().toISOString(),
              }],
              components: [],
            },
          };
        }
      }
    }

    // Handle navigation buttons
    if (customId?.startsWith('prev_package_') || customId?.startsWith('next_package_')) {
      // Extract search ID and index from custom_id format: prev_package_12345678_abc123def_0
      const prefix = customId.startsWith('prev_package_') ? 'prev_package_' : 'next_package_';
      const remaining = customId.replace(prefix, '');
      const lastUnderscoreIndex = remaining.lastIndexOf('_');
      const searchId = remaining.substring(0, lastUnderscoreIndex);
      const currentIndex = parseInt(remaining.substring(lastUnderscoreIndex + 1));
      const newIndex = customId.startsWith('prev_package_') ? currentIndex - 1 : currentIndex + 1;
      
      console.log(`Navigation: customId=${customId}, searchId=${searchId}, currentIndex=${currentIndex}, newIndex=${newIndex}`);
      
      const results = await packageService.getSearchResults(searchId);
      if (!results || !results[newIndex]) {
        return {
          type: INTERACTION_RESPONSE_TYPE.UPDATE_MESSAGE,
          data: {
            embeds: [{
              title: "❌ Error",
              description: "Search results have expired. Please search again.",
              color: 0xe74c3c,
              footer: { text: "Package Control Search" },
              timestamp: new Date().toISOString(),
            }],
            components: [],
          },
        };
      }

      const filters = packageService.parseSearchQuery("");
      const updatedEmbed = createUpdatableSearchEmbed("", results, filters, newIndex);

      const navigationComponents = [
        {
          type: COMPONENT_TYPE.ACTION_ROW,
          components: [
            {
              type: COMPONENT_TYPE.BUTTON,
              custom_id: `prev_package_${searchId}_${newIndex}`,
              label: "← Previous",
              style: 2,
              disabled: newIndex === 0,
            },
            {
              type: COMPONENT_TYPE.BUTTON,
              custom_id: `next_package_${searchId}_${newIndex}`,
              label: "Next →",
              style: 2,
              disabled: newIndex === results.length - 1,
            },
            {
              type: COMPONENT_TYPE.BUTTON,
              custom_id: `package_list_${searchId}`,
              label: "📋 All Packages",
              style: 1,
            },
          ],
        },
      ];

      return {
        type: INTERACTION_RESPONSE_TYPE.UPDATE_MESSAGE,
        data: {
          embeds: [updatedEmbed],
          components: navigationComponents,
        },
      };
    }

    if (customId?.startsWith('package_list_')) {
      const searchId = customId.replace('package_list_', '');
      const results = await packageService.getSearchResults(searchId);
      
      if (!results) {
        return {
          type: INTERACTION_RESPONSE_TYPE.UPDATE_MESSAGE,
          data: {
            embeds: [{
              title: "❌ Error",
              description: "Search results have expired. Please search again.",
              color: 0xe74c3c,
              footer: { text: "Package Control Search" },
              timestamp: new Date().toISOString(),
            }],
            components: [],
          },
        };
      }

      // Show overview with dropdown
      const filters = packageService.parseSearchQuery("");
      const overviewEmbed = createUpdatableSearchEmbed("", results, filters);
      
      // Recreate the select menu
      const selectMenu = {
        type: COMPONENT_TYPE.ACTION_ROW,
        components: [{
          type: COMPONENT_TYPE.SELECT_MENU,
          custom_id: `package_select_${searchId}`,
          placeholder: `Select a package to view details (${results.length} found)`,
          options: results.slice(0, 25).map((result, index) => ({
            label: result.name,
            value: `${result.name}|${result.repository}|${index}`,
            description: `${Array.isArray(result.author) ? result.author.join(", ") : result.author} - ${result.description?.substring(0, 50)}...`,
          })),
        }],
      };

      return {
        type: INTERACTION_RESPONSE_TYPE.UPDATE_MESSAGE,
        data: {
          embeds: [overviewEmbed],
          components: [selectMenu],
        },
      };
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
      const response = await handleDiscordInteraction(interaction, env);

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
