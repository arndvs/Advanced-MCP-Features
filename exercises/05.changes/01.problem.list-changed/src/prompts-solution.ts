import { invariant } from '@epic-web/invariant'
import { completable } from '@modelcontextprotocol/sdk/server/completable.js'
import { z } from 'zod'
import { type EpicMeMCP } from './index.ts'

/**
 * Initialize dynamic prompts for the EpicMe MCP server
 * 
 * This function demonstrates the core concept of dynamic MCP capabilities:
 * prompts that are conditionally available based on the current state of the database.
 * 
 * Dynamic Prompt Behavior:
 * - The "suggest_tags" prompt is only available when there are journal entries
 * - When entries exist, the prompt is enabled and clients can use it
 * - When no entries exist, the prompt is disabled to prevent confusion
 * - Database changes automatically trigger prompt state updates
 * 
 * Implementation Flow:
 * 1. Register the prompt with the server (initially disabled)
 * 2. Create an update function that checks database state
 * 3. Subscribe to database changes to trigger updates
 * 4. Run initial update to set correct state
 * 
 * When the database changes (entries added/removed), the subscription callback
 * runs, which enables/disables the prompt as needed. The MCP server then
 * automatically sends a "listChanged" notification to connected clients,
 * informing them that the available prompts have changed.
 * 
 * This approach ensures users never see irrelevant options (like "suggest tags"
 * when no entries exist), creating a smooth, context-aware experience that
 * eliminates confusion from stale UI elements.
 */
export async function initializePrompts(agent: EpicMeMCP) {
	// Register the suggest_tags prompt with the server
	// This prompt helps users add relevant tags to their journal entries
	// The prompt uses completable() for the entryId parameter to provide
	// autocomplete suggestions based on existing entry IDs
	const suggestTagsPrompt = agent.server.registerPrompt(
		'suggest_tags',
		{
			title: 'Suggest Tags',
			description: 'Suggest tags for a journal entry',
			argsSchema: {
				entryId: completable(
					z
						.string()
						.describe('The ID of the journal entry to suggest tags for'),
					async (value) => {
						// Provide autocomplete suggestions for entry IDs
						// This makes it easier for users to select the right entry
						const entries = await agent.db.getEntries()
						return entries
							.map((entry) => entry.id.toString())
							.filter((id) => id.includes(value))
					},
				),
			},
		},
		// Prompt handler function that executes when the prompt is invoked
		// This function validates the entry ID, retrieves the entry and available tags,
		// then constructs a conversation that helps the AI suggest relevant tags
		async ({ entryId }) => {
			invariant(entryId, 'entryId is required')
			const entryIdNum = Number(entryId)
			invariant(!Number.isNaN(entryIdNum), 'entryId must be a valid number')

			const entry = await agent.db.getEntry(entryIdNum)
			invariant(entry, `entry with the ID "${entryId}" not found`)

			const tags = await agent.db.listTags()
			
			// Return a structured conversation that provides context to the AI
			// The AI will receive the entry content and available tags, then
			// can suggest appropriate tags and even create new ones if needed
			return {
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: `
Below is my EpicMe journal entry with ID "${entryId}" and the tags I have available.

Please suggest some tags to add to it. Feel free to suggest new tags I don't have yet.

For each tag I approve, if it does not yet exist, create it with the EpicMe "create_tag" tool. Then add approved tags to the entry with the EpicMe "add_tag_to_entry" tool.
								`.trim(),
						},
					},
					{
						role: 'user',
						content: {
							type: 'resource',
							resource: {
								uri: 'epicme://tags',
								mimeType: 'application/json',
								text: JSON.stringify(tags),
							},
						},
					},
					{
						role: 'user',
						content: {
							type: 'resource',
							resource: {
								uri: `epicme://entries/${entryId}`,
								mimeType: 'application/json',
								text: JSON.stringify(entry),
							},
						},
					},
				],
			}
		},
	)

	/**
	 * Dynamic prompt state management function
	 * 
	 * This function implements the core logic for dynamic prompt availability:
	 * - When journal entries exist, enable the suggest_tags prompt
	 * - When no entries exist, disable the prompt to prevent confusion
	 * 
	 * The enable()/disable() methods on the prompt object automatically trigger
	 * MCP "listChanged" notifications to connected clients, informing them
	 * that the available prompts have changed. This is similar to how a smart
	 * vending machine would update its display when snack availability changes.
	 */
	async function updatePrompts() {
		const entries = await agent.db.getEntries()
		
		if (entries.length > 0) {
			// Enable the prompt when entries are available
			// This allows users to get tag suggestions for their entries
			if (!suggestTagsPrompt.enabled) suggestTagsPrompt.enable()
		} else {
			// Disable the prompt when no entries exist
			// This prevents users from trying to suggest tags for non-existent entries
			if (suggestTagsPrompt.enabled) suggestTagsPrompt.disable()
		}
	}
	
	// Subscribe to database changes to automatically update prompt availability
	// Whenever entries are added, removed, or modified, this callback will run
	// and update the prompt state accordingly
	agent.db.subscribe(updatePrompts)
	
	// Run the initial update to set the correct prompt state on startup
	// This ensures the prompt starts in the right state based on current data
	await updatePrompts()
	
	// Note: While the MCP Inspector supports list change notifications, it does not
	// currently automatically refresh the UI when lists change. For testing dynamic
	// behavior, rely on automated tests rather than manual inspection in the MCP Inspector.
}
