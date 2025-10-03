import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { DB } from './db/index.ts'
import { initializePrompts } from './prompts.ts'
import { initializeResources } from './resources.ts'
import { initializeTools } from './tools.ts'

/**
 * EpicMeMCP - A dynamic MCP server for journaling functionality
 * 
 * This server demonstrates dynamic MCP capabilities where tools, resources, and prompts
 * can be enabled/disabled based on the current state of the database. This creates a
 * more responsive user experience where only relevant functionality is available.
 * 
 * Real-world analogy: Like a smart vending machine that offers different snacks based on
 * the time of day (coffee in the morning, chips in the afternoon), this server dynamically
 * adjusts available prompts based on the current state of journal entries.
 * 
 * Key Dynamic Features:
 * - Prompts are conditionally enabled based on data availability
 * - The server announces "listChanged" capability to inform clients when
 *   the available prompts may change
 * - Database subscriptions trigger prompt state updates automatically
 * - Users never see irrelevant options (e.g., "suggest tags" when no entries exist)
 * 
 * Benefits:
 * - Eliminates confusion from stale UI elements
 * - Provides context-aware functionality
 * - Creates a smooth, up-to-date user experience
 * - Ensures users always see the right options for their current context
 */
export class EpicMeMCP {
	db: DB
	server = new McpServer(
		{
			name: 'epicme',
			title: 'EpicMe',
			version: '1.0.0',
		},
		{
			capabilities: {
				tools: {},
				resources: {},
				completions: {},
				logging: {},
				// Enable listChanged capability for prompts
				// This tells the client that the server may dynamically change
				// which prompts are available during runtime. The MCP SDK automatically
				// sends list_changed notifications when prompts are enabled/disabled,
				// so the client always knows when to refresh its list.
				prompts: { listChanged: true },
			},
			instructions: `
EpicMe is a journaling app that allows users to write about and review their experiences, thoughts, and reflections.

These tools are the user's window into their journal. With these tools and your help, they can create, read, and manage their journal entries and associated tags.

You can also help users add tags to their entries and get all tags for an entry.
			`.trim(),
		},
	)

	constructor(path: string) {
		this.db = DB.getInstance(path)
	}
	
	/**
	 * Initialize the MCP server with all components
	 * 
	 * This method sets up tools, resources, and prompts in the correct order.
	 * The prompts initialization is particularly important as it sets up
	 * the dynamic behavior and database subscriptions.
	 */
	async init() {
		await initializeTools(this)
		await initializeResources(this)
		await initializePrompts(this)
	}
}

/**
 * Main entry point for the EpicMe MCP server
 * 
 * This function creates the server instance, initializes all components
 * (including dynamic prompt subscriptions), and starts the stdio transport.
 * The server will now respond to MCP protocol messages and automatically
 * update available prompts based on database changes.
 */
async function main() {
	const agent = new EpicMeMCP(process.env.EPIC_ME_DB_PATH ?? './db.sqlite')
	await agent.init()
	const transport = new StdioServerTransport()
	await agent.server.connect(transport)
	console.error('EpicMe MCP Server running on stdio')
}

main().catch((error) => {
	console.error('Fatal error in main():', error)
	process.exit(1)
})
